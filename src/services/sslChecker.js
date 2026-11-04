import tls from 'node:tls';
import { normalizeTargetUrl, assertSafeAddress, TargetInputError } from './urlGuard.js';
import { classifyConnectionError } from './uptimeChecker.js';

const SSL_TIMEOUT_MS = 15_000;

const ISSUE_MESSAGES = {
  expired: 'گواهی SSL منقضی شده است.',
  hostname_mismatch: 'نام دامنه با گواهی SSL مطابقت ندارد (hostname mismatch).',
  self_signed: 'گواهی self-signed است و مورد اعتماد نیست.',
  untrusted_chain: 'زنجیره گواهی معتبر نیست (issuer ناشناخته).',
  chain_invalid: 'اعتبارسنجی زنجیره گواهی شکست خورد.',
  handshake_failed: 'دست‌دهی TLS (handshake) شکست خورد.',
  tls_old: 'نسخه TLS قدیمی و ناامن است.',
};

const BLOCKING_ISSUES = new Set(['expired', 'hostname_mismatch', 'self_signed', 'untrusted_chain', 'chain_invalid', 'handshake_failed']);

function issuerText(cert) {
  const issuer = cert?.issuer || {};
  const parts = [];
  for (const value of [issuer.O, issuer.CN]) {
    if (value && !parts.includes(value)) parts.push(value);
  }
  return parts.join(' - ') || 'نامشخص';
}

function mapAuthorizationError(raw) {
  const text = String(raw?.code || raw?.message || raw || '');
  if (/CERT_HAS_EXPIRED|CERT_NOT_YET_VALID/i.test(text)) return 'expired';
  if (/ALTNAME_INVALID|HOSTNAME_MISMATCH/i.test(text)) return 'hostname_mismatch';
  if (/SELF_SIGNED/i.test(text)) return 'self_signed';
  if (/UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER|CERT_UNTRUSTED|CERT_SIGNATURE_FAILURE/i.test(text)) return 'untrusted_chain';
  return 'chain_invalid';
}

/**
 * تحلیل خالص اطلاعات گواهی؛ برای تست واحد جدا شده است.
 */
export function classifyCertificate({ hostname, cert, authorized, authorizationError, protocol, now = new Date() }) {
  if (!cert || !cert.valid_to) {
    return {
      status: 'invalid',
      issues: ['handshake_failed'],
      errorType: 'handshake_failed',
      errorMessage: ISSUE_MESSAGES.handshake_failed,
      expiresAt: null,
      daysLeft: null,
      issuer: null,
      tlsVersion: protocol || null,
    };
  }

  const expiresAt = new Date(cert.valid_to);
  const daysLeft = Number.isNaN(expiresAt.getTime())
    ? null
    : Math.floor((expiresAt.getTime() - now.getTime()) / 86_400_000);

  const issues = [];
  const addIssue = (code) => {
    if (code && !issues.includes(code)) issues.push(code);
  };

  if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime()) {
    addIssue('expired');
  } else if (!authorized) {
    addIssue(mapAuthorizationError(authorizationError));
  }

  try {
    if (tls.checkServerIdentity(hostname, cert)) addIssue('hostname_mismatch');
  } catch {
    addIssue('hostname_mismatch');
  }

  let protocolVersion = null;
  if (protocol) {
    protocolVersion = String(protocol).replace(/^TLSv/i, '');
    const major = Number(protocolVersion.split('.')[0]);
    const minor = Number(protocolVersion.split('.')[1] || 0);
    if (Number.isFinite(major) && (major < 1 || (major === 1 && minor < 2))) addIssue('tls_old');
  }

  const blocking = issues.filter((issue) => BLOCKING_ISSUES.has(issue));
  let status = 'ok';
  if (blocking.length) status = 'invalid';
  else if ((daysLeft !== null && daysLeft <= 30) || issues.includes('tls_old')) status = 'expiring';

  const primary = blocking[0] || (issues.includes('tls_old') ? 'tls_old' : null);
  const messages = issues.map((issue) => ISSUE_MESSAGES[issue]).filter(Boolean);

  return {
    status,
    issues,
    errorType: primary,
    errorMessage: messages.length ? messages.join(' ') : null,
    expiresAt: Number.isNaN(expiresAt.getTime()) ? null : expiresAt,
    daysLeft,
    issuer: issuerText(cert),
    tlsVersion: protocol || null,
  };
}

function connectOnce(info, address, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const socket = tls.connect({
      host: address.address,
      port: info.port,
      servername: info.isIpLiteral ? undefined : info.hostname,
      rejectUnauthorized: false,
      timeout: timeoutMs,
      ALPNProtocols: ['http/1.1'],
    });

    socket.once('secureConnect', () => {
      try {
        const cert = socket.getPeerCertificate(true);
        const protocol = socket.getProtocol();
        const authorized = socket.authorized;
        const authorizationError = socket.authorizationError;
        finish(resolve, { cert, protocol, authorized, authorizationError });
      } catch (err) {
        finish(reject, err);
      } finally {
        socket.destroy();
      }
    });

    socket.once('timeout', () => {
      const err = new Error('timeout');
      err.code = 'ETIMEDOUT';
      socket.destroy(err);
    });

    socket.once('error', (err) => finish(reject, err));
  });
}

function classifySslFailure(err) {
  const code = String(err?.code || '');
  if (['EPROTO', 'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_PACKET_LENGTH_MISMATCH'].includes(code)) {
    return { errorType: 'handshake_failed', errorMessage: 'دست‌دهی TLS شکست خورد (پروتکل/الگوریتم ناسازگار).' };
  }
  const classified = classifyConnectionError(err);
  return { errorType: classified.type, errorMessage: classified.message };
}

/**
 * بررسی کامل گواهی SSL؛ اتصال به IP اعتبارسنجی‌شده با SNI صحیح انجام می‌شود.
 */
export async function checkSsl(target) {
  const started = new Date();
  try {
    const info = normalizeTargetUrl(target.url);
    const allowPrivate = Boolean(target.allow_private);
    let addresses;
    try {
      addresses = await assertSafeAddress(info, allowPrivate, { requireResolution: true });
    } catch (err) {
      if (err instanceof TargetInputError) {
        const blocked = ['private_address', 'local_host'].includes(err.code);
        return {
          ok: false,
          status: 'invalid',
          errorType: blocked ? 'blocked' : 'dns',
          errorMessage: err.message,
          expiresAt: null,
          daysLeft: null,
          issuer: null,
          tlsVersion: null,
          checkedAt: started,
        };
      }
      throw err;
    }

    let lastError = null;
    for (const address of addresses.slice(0, 3)) {
      try {
        const handshake = await connectOnce(info, address, SSL_TIMEOUT_MS);
        const analysis = classifyCertificate({
          hostname: info.hostname,
          cert: handshake.cert,
          authorized: handshake.authorized,
          authorizationError: handshake.authorizationError,
          protocol: handshake.protocol,
          now: started,
        });
        return { ok: analysis.status !== 'invalid', checkedAt: started, ...analysis };
      } catch (err) {
        lastError = err;
      }
    }

    const classified = classifySslFailure(lastError || new Error('handshake failed'));
    return {
      ok: false,
      status: 'invalid',
      errorType: classified.errorType,
      errorMessage: classified.errorMessage,
      expiresAt: null,
      daysLeft: null,
      issuer: null,
      tlsVersion: null,
      checkedAt: started,
    };
  } catch (err) {
    const classified = classifySslFailure(err);
    return {
      ok: false,
      status: 'invalid',
      errorType: classified.errorType,
      errorMessage: classified.errorMessage,
      expiresAt: null,
      daysLeft: null,
      issuer: null,
      tlsVersion: null,
      checkedAt: started,
    };
  }
}

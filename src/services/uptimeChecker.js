import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { normalizeTargetUrl, assertSafeAddress, TargetInputError } from './urlGuard.js';
import { isStatusAccepted, parseAcceptedStatusCodes } from '../lib/statusCodes.js';

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const USER_AGENT = 'DidehbanMonitor/1.0';

export function classifyConnectionError(err) {
  const code = String(err?.code || err?.cause?.code || '');
  const message = String(err?.message || '');

  if (['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME', 'EAI_FAIL', 'EAI_NODATA'].includes(code)) {
    return { type: 'dns', message: `نام دامنه قابل resolve نیست (${code}).` };
  }
  if (code === 'ECONNREFUSED') {
    return { type: 'connection_refused', message: 'اتصال توسط سرور رد شد (connection refused).' };
  }
  if (code === 'ECONNRESET' || code === 'EPIPE') {
    return { type: 'connection_reset', message: 'اتصال توسط سرور قطع شد (connection reset).' };
  }
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || /timed?\s*out/i.test(message)) {
    return { type: 'timeout', message: 'زمان انتظار برای پاسخ به پایان رسید (timeout).' };
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return { type: 'network_unreachable', message: 'شبکه یا میزبان در دسترس نیست.' };
  }
  if (code === 'EACCES') {
    return { type: 'connection_error', message: 'دسترسی به مقصد مجاز نیست.' };
  }
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
    return { type: 'tls_error', message: 'نام دامنه با گواهی SSL مطابقت ندارد.' };
  }
  if (/certificate|tls|ssl/i.test(code) || /certificate|tls|ssl/i.test(message)) {
    return { type: 'tls_error', message: 'خطای TLS/SSL در اتصال رخ داد.' };
  }
  return { type: 'connection_error', message: `خطای اتصال (${code || 'unknown'}).` };
}

function requestOnce(info, addresses, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const mod = info.protocol === 'https:' ? https : http;
    const hostHeader = info.port === (info.protocol === 'https:' ? 443 : 80) ? info.hostname : `${info.hostname}:${info.port}`;

    const options = {
      protocol: info.protocol,
      hostname: info.hostname,
      port: info.port,
      path: info.path,
      method: 'GET',
      headers: {
        Host: hostHeader,
        'User-Agent': USER_AGENT,
        Accept: '*/*',
        Connection: 'close',
      },
      agent: false,
      timeout: timeoutMs,
      lookup: (hostname, opts, callback) => {
        // آدرس‌ها قبل از اتصال اعتبارسنجی شده‌اند؛ برای جلوگیری از DNS rebinding همان IP پین می‌شود.
        if (opts && opts.all) {
          callback(null, addresses.map((item) => ({ address: item.address, family: item.family })));
        } else {
          callback(null, addresses[0].address, addresses[0].family);
        }
      },
    };
    if (info.protocol === 'https:') {
      options.rejectUnauthorized = false; // پایش uptime مستقل از وضعیت SSL است.
      options.servername = info.hostname;
    }

    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const req = mod.request(options, (res) => {
      const responseMs = Math.round(performance.now() - started);
      const statusCode = res.statusCode || 0;
      const location = typeof res.headers.location === 'string' ? res.headers.location : null;
      res.on('error', () => {});
      // بدنه پاسخ برای پایش لازم نیست؛ پس از دریافت هدرها بسته می‌شود.
      res.destroy();
      finish(resolve, { statusCode, location, responseMs });
    });

    req.on('error', (err) => finish(reject, err));
    req.setTimeout(timeoutMs, () => {
      const err = new Error('timeout');
      err.code = 'ETIMEDOUT';
      req.destroy(err);
    });
    req.end();
  });
}

/**
 * بررسی در دسترس بودن یک دامنه با پشتیبانی از ریدایرکت امن (هر مقصد دوباره اعتبارسنجی می‌شود).
 */
export async function checkUptime(target) {
  const started = performance.now();
  const timeoutMs = Math.max(1000, Number(target.timeout_seconds || 10) * 1000);
  const allowPrivate = Boolean(target.allow_private);
  let ranges;
  try {
    ranges = parseAcceptedStatusCodes(target.accepted_status_codes || '200-399');
  } catch {
    ranges = [[200, 399]];
  }

  let currentUrl = target.url;
  let redirects = 0;
  const seen = new Set();

  try {
    while (true) {
      if (seen.has(currentUrl) || redirects > MAX_REDIRECTS) {
        return {
          ok: false,
          statusCode: null,
          responseMs: Math.min(600000, Math.round(performance.now() - started)),
          errorType: 'redirect',
          errorMessage: 'تعداد ریدایرکت‌ها بیش از حد مجاز یا حلقه بی‌پایان است.',
          finalUrl: currentUrl,
          redirects,
        };
      }
      seen.add(currentUrl);

      const info = normalizeTargetUrl(currentUrl);
      let addresses = [];
      try {
        addresses = await assertSafeAddress(info, allowPrivate, { requireResolution: true });
      } catch (err) {
        if (err instanceof TargetInputError) {
          const blocked = ['private_address', 'local_host'].includes(err.code);
          return {
            ok: false,
            statusCode: null,
            responseMs: Math.min(600000, Math.round(performance.now() - started)),
            errorType: blocked ? 'blocked' : 'dns',
            errorMessage: err.message,
            finalUrl: currentUrl,
            redirects,
          };
        }
        throw err;
      }

      let response;
      let lastError;
      for (const address of addresses.slice(0, 3)) {
        try {
          response = await requestOnce(info, [address], timeoutMs);
          break;
        } catch (err) {
          lastError = err;
        }
      }
      if (!response) throw lastError || new Error('connection failed');

      if (REDIRECT_CODES.has(response.statusCode) && response.location) {
        const nextUrl = new URL(response.location, currentUrl).toString();
        redirects += 1;
        currentUrl = nextUrl;
        continue;
      }

      const ok = isStatusAccepted(response.statusCode, ranges);
      return {
        ok,
        statusCode: response.statusCode,
        responseMs: response.responseMs,
        errorType: ok ? null : 'http_status',
        errorMessage: ok
          ? null
          : `کد وضعیت ${response.statusCode} در محدوده قابل قبول (${target.accepted_status_codes}) نیست.`,
        finalUrl: currentUrl,
        redirects,
      };
    }
  } catch (err) {
    const classified = classifyConnectionError(err);
    return {
      ok: false,
      statusCode: null,
      responseMs: Math.min(600000, Math.round(performance.now() - started)),
      errorType: classified.type,
      errorMessage: classified.message,
      finalUrl: currentUrl,
      redirects,
    };
  }
}

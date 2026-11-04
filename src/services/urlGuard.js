import dns from 'node:dns/promises';
import net from 'node:net';
import ipaddr from 'ipaddr.js';

export class TargetInputError extends Error {
  constructor(message, code = 'invalid_target') {
    super(message);
    this.name = 'TargetInputError';
    this.code = code;
  }
}

const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa'];

export function isPublicIp(address) {
  try {
    let addr = ipaddr.parse(String(address));
    if (addr.kind() === 'ipv6' && addr.isIPv4MappedAddress()) addr = addr.toIPv4Address();
    return addr.range() === 'unicast';
  } catch {
    return false;
  }
}

export function stripIpv6Brackets(hostname) {
  if (hostname.startsWith('[') && hostname.endsWith(']')) return hostname.slice(1, -1);
  return hostname;
}

function isLocalHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost') return true;
  return LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * نرمال‌سازی و اعتبارسنجی ساختاری آدرس. آدرس‌های بدون scheme با https:// تکمیل می‌شوند.
 */
export function normalizeTargetUrl(raw) {
  if (typeof raw !== 'string') throw new TargetInputError('آدرس دامنه باید متن باشد.', 'invalid_url');
  let input = raw.trim();
  if (!input) throw new TargetInputError('آدرس دامنه خالی است.', 'invalid_url');
  if (input.length > 2048) throw new TargetInputError('آدرس دامنه بیش از حد طولانی است.', 'invalid_url');
  if (/[\r\n\t]/.test(input)) throw new TargetInputError('آدرس دامنه شامل کاراکتر غیرمجاز است.', 'invalid_url');

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) input = `https://${input}`;

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new TargetInputError('ساختار آدرس معتبر نیست.', 'invalid_url');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new TargetInputError('فقط آدرس‌های http و https مجاز هستند.', 'unsupported_scheme');
  }
  if (parsed.username || parsed.password) {
    throw new TargetInputError('آدرس نباید شامل نام کاربری یا رمز باشد.', 'credentials_not_allowed');
  }

  let hostname = stripIpv6Brackets(parsed.hostname.toLowerCase());
  if (!hostname) throw new TargetInputError('نام دامنه در آدرس وجود ندارد.', 'invalid_url');
  if (hostname.length > 253) throw new TargetInputError('نام دامنه بیش از حد طولانی است.', 'invalid_hostname');

  if (net.isIP(hostname) === 0) {
    if (!/^[a-z0-9.-]+$/.test(hostname) || hostname.includes('..') || hostname.startsWith('.') || hostname.endsWith('.')) {
      // نقطه پایانی ریشه را حذف می‌کنیم (مثل example.com.)
      const trimmed = hostname.replace(/\.$/, '');
      if (!/^[a-z0-9.-]+$/.test(trimmed) || trimmed.includes('..') || trimmed.startsWith('.')) {
        throw new TargetInputError('نام دامنه معتبر نیست.', 'invalid_hostname');
      }
      hostname = trimmed;
    }
  }

  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TargetInputError('پورت آدرس معتبر نیست.', 'invalid_port');
  }

  parsed.hash = '';
  const pathname = parsed.pathname || '/';
  const search = parsed.search || '';
  const url = `${parsed.protocol}//${parsed.host}${pathname === '/' && !search ? '' : pathname}${search}`;
  const urlKey = `${parsed.protocol}//${parsed.host}${pathname === '/' ? '' : pathname}${search}`;

  return {
    url,
    urlKey,
    hostname,
    port,
    protocol: parsed.protocol,
    pathname,
    search,
    path: `${pathname}${search}`,
    isIpLiteral: net.isIP(hostname) !== 0,
  };
}

export async function resolveHost(hostname, timeoutMs = 6000) {
  let timer;
  try {
    const result = await Promise.race([
      dns.lookup(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error('DNS resolution timed out');
          err.code = 'ETIMEDOUT';
          reject(err);
        }, timeoutMs);
      }),
    ]);
    if (!result?.length) {
      const err = new Error('DNS lookup returned no addresses');
      err.code = 'ENOTFOUND';
      throw err;
    }
    return result.map((item) => ({ address: item.address, family: item.family }));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * بررسی SSRF: آدرس‌های خصوصی/رزرو‌شده رد می‌شوند مگر ادمین صریحاً allowPrivate را فعال کند.
 * در زمان افزودن، خطای DNS مانع افزودن نیست؛ اما در زمان بررسی، خطای DNS گزارش می‌شود.
 */
export async function assertSafeAddress(info, allowPrivate, { requireResolution = true } = {}) {
  if (allowPrivate) {
    try {
      return await resolveHost(info.hostname);
    } catch {
      if (requireResolution) throw new TargetInputError('نام دامنه قابل resolve نیست.', 'dns_resolution_failed');
      return [];
    }
  }

  if (!info.isIpLiteral && isLocalHostname(info.hostname)) {
    throw new TargetInputError('آدرس‌های محلی (localhost/local) مجاز نیستند.', 'local_host');
  }

  if (info.isIpLiteral) {
    if (!isPublicIp(info.hostname)) {
      throw new TargetInputError('آدرس‌های IP خصوصی یا رزرو‌شده مجاز نیستند.', 'private_address');
    }
    return [{ address: info.hostname, family: net.isIP(info.hostname) }];
  }

  let addresses;
  try {
    addresses = await resolveHost(info.hostname);
  } catch (err) {
    if (requireResolution) {
      throw new TargetInputError(`نام دامنه قابل resolve نیست (${err.code || 'DNS'}).`, 'dns_resolution_failed');
    }
    return [];
  }

  const unsafe = addresses.filter((item) => !isPublicIp(item.address));
  if (unsafe.length) {
    throw new TargetInputError(
      `دامنه به آدرس خصوصی/رزرو‌شده (${unsafe[0].address}) اشاره می‌کند و مجاز نیست.`,
      'private_address',
    );
  }
  return addresses;
}

import { ValidationError } from './errors.js';

/**
 * رشته کدهای قابل قبول HTTP را پارس می‌کند؛ مثال: "200-399" یا "200, 301, 400-499".
 */
export function parseAcceptedStatusCodes(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new ValidationError('کدهای وضعیت قابل قبول نامعتبر است.');
  }
  const ranges = [];
  for (const tokenRaw of input.split(',')) {
    const token = tokenRaw.trim();
    if (!token) continue;
    const match = /^(\d{3})(?:\s*-\s*(\d{3}))?$/.exec(token);
    if (!match) {
      throw new ValidationError('کدهای وضعیت قابل قبول باید مثل "200-399" یا "200,301" باشند.');
    }
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (start < 100 || end > 599 || start > end) {
      throw new ValidationError('بازه کد وضعیت باید بین ۱۰۰ و ۵۹۹ باشد.');
    }
    ranges.push([start, end]);
  }
  if (!ranges.length) throw new ValidationError('حداقل یک کد وضعیت قابل قبول لازم است.');
  return ranges;
}

export function isStatusAccepted(statusCode, ranges) {
  if (!Number.isInteger(statusCode)) return false;
  return ranges.some(([start, end]) => statusCode >= start && statusCode <= end);
}

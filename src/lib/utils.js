export async function mapLimit(items, limit, fn) {
  const list = Array.from(items);
  const results = new Array(list.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, list.length || 1));

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      results[index] = await fn(list[index], index);
    }
  }

  await Promise.all(Array.from({ length: size }, worker));
  return results;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clampText(value, maxLength, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim().slice(0, maxLength);
}

export function parseTags(value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(/[,،]/);
  const tags = [];
  for (const item of raw) {
    const tag = String(item).trim();
    if (!tag) continue;
    if (tag.length > 40) continue;
    if (!tags.includes(tag)) tags.push(tag);
    if (tags.length >= 20) break;
  }
  return tags;
}

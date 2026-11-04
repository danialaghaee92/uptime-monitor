/**
 * پارسر ساده CSV با پشتیبانی از فیلدهای داخل کوتیشن، کاما و خط جدید داخل فیلد.
 */
export function parseCsv(text) {
  const input = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows.map((cells) => cells.map((cell) => cell.trim()));
}

/**
 * ورودی چسبانده‌شده را به ردیف‌های ساختاریافته تبدیل می‌کند.
 * هر خط: url | url,name | url,name,category,tags
 * جداکننده می‌تواند "|" یا "," باشد (در صورت وجود "|" اولویت دارد).
 */
export function parsePasteInput(text) {
  const entries = [];
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((line, index) => {
    const raw = line.trim();
    if (!raw || raw.startsWith('#')) return;
    const separator = raw.includes('|') ? '|' : ',';
    const parts = raw.split(separator).map((part) => part.trim());
    entries.push({
      line: index + 1,
      url: parts[0] || '',
      name: parts[1] || '',
      category: parts[2] || '',
      tags: parts[3] || '',
    });
  });
  return entries;
}

/**
 * فایل CSV را به ردیف تبدیل می‌کند. اگر سطر اول هدر باشد، ستون‌ها بر اساس نام شناسایی می‌شوند.
 */
export function parseTargetsCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((cell) => cell.toLowerCase().replace(/[\s-]+/g, '_'));
  const known = new Set(['url', 'name', 'display_name', 'category', 'tags', 'allow_private']);
  const hasHeader = header.some((cell) => known.has(cell));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const indexOf = (names) => header.findIndex((cell) => names.includes(cell));

  const idx = hasHeader
    ? {
        url: indexOf(['url', 'address', 'domain']),
        name: indexOf(['name', 'display_name', 'title']),
        category: indexOf(['category', 'group']),
        tags: indexOf(['tags', 'tag', 'labels']),
        allowPrivate: indexOf(['allow_private', 'private']),
      }
    : { url: 0, name: 1, category: 2, tags: 3, allowPrivate: -1 };

  const out = [];
  dataRows.forEach((cells, index) => {
    const pick = (position) => (position >= 0 ? cells[position] || '' : '');
    out.push({
      line: index + (hasHeader ? 2 : 1),
      url: pick(idx.url),
      name: pick(idx.name),
      category: pick(idx.category),
      tags: pick(idx.tags),
      allowPrivate: pick(idx.allowPrivate),
    });
  });
  return out.filter((entry) => entry.url.trim() !== '');
}

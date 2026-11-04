import {
  api,
  app,
  bothDates,
  daysBadge,
  debounce,
  esc,
  fmtDate,
  fmtNumber,
  initShell,
  markUpdated,
  normalizeText,
  relativeTime,
  sortRows,
  statusPill,
  summaryCard,
  updateSortHeaders,
  icons,
} from './common.js';

const state = {
  data: null,
  search: '',
  status: '',
  category: '',
  sort: { key: 'daysLeft', dir: 'asc' },
};

const els = {
  summary: document.getElementById('summary'),
  body: document.getElementById('ssl-body'),
  table: document.getElementById('ssl-table'),
  search: document.getElementById('search'),
  status: document.getElementById('filter-status'),
  category: document.getElementById('filter-category'),
  error: document.getElementById('error-banner'),
  empty: document.getElementById('empty-state'),
};

const STATUS_ORDER = { invalid: 0, expiring: 1, unknown: 2, ok: 3 };

function renderSummary() {
  const s = state.data?.summary || { total: 0, ok: 0, expiring: 0, invalid: 0, unknown: 0 };
  els.summary.innerHTML = [
    summaryCard('کل گواهی‌ها', s.total, 'info', icons.globe),
    summaryCard('سالم', s.ok, 'ok', icons.check),
    summaryCard('در خطر', s.expiring, 'warn', icons.clock),
    summaryCard('خراب', s.invalid, 'bad', icons.alert),
    summaryCard('بدون بررسی', s.unknown, 'muted', icons.shield),
  ].join('');
}

function fillCategories() {
  const categories = [...new Set((state.data?.targets || []).map((item) => item.category).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'fa'),
  );
  const selected = els.category.value;
  els.category.innerHTML =
    '<option value="">همه دسته‌ها</option>' +
    categories.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join('');
  if (categories.includes(selected)) els.category.value = selected;
}

function tlsBadge(version) {
  if (!version) return '<span class="muted">—</span>';
  const numeric = Number(String(version).replace(/^TLSv/i, ''));
  const old = Number.isFinite(numeric) && numeric < 1.2;
  return `<span class="tls-badge ${old ? 'old' : ''}" title="${old ? 'نسخه TLS قدیمی است' : 'نسخه TLS'}">${esc(version)}</span>`;
}

function rowHtml(target) {
  const tags = (target.tags || []).slice(0, 3).map((tag) => `<span class="tag">${esc(tag)}</span>`).join('');
  const error = target.error
    ? `<span title="${esc(target.error)}">${esc(target.error.length > 55 ? `${target.error.slice(0, 55)}…` : target.error)}</span>`
    : '<span class="muted">—</span>';
  const lastChecked = target.lastCheckedAt
    ? `<span title="${esc(bothDates(target.lastCheckedAt))}">${esc(relativeTime(target.lastCheckedAt))}</span>
       <div class="row-sub">${esc(fmtDate(target.lastCheckedAt))}</div>`
    : '<span class="muted">بررسی نشده</span>';
  const issuer = target.issuer || '—';

  return `<tr>
    <td data-label="نام / دامنه">
      <div class="target-name">
        <strong>${esc(target.displayName)}</strong>
        <a href="${esc(target.url)}" target="_blank" rel="noopener noreferrer" title="${esc(target.url)}">${esc(target.url)}</a>
        ${tags ? `<div class="tags">${tags}</div>` : ''}
      </div>
    </td>
    <td data-label="دسته"><span class="category-chip">${esc(target.category || '—')}</span></td>
    <td data-label="وضعیت">${statusPill(target.status, 'ssl')}</td>
    <td data-label="تاریخ انقضا">${
      target.expiresAt
        ? `<span title="${esc(bothDates(target.expiresAt))}">${esc(fmtDate(target.expiresAt, false))}</span>`
        : '<span class="muted">—</span>'
    }</td>
    <td data-label="روز باقی‌مانده">${daysBadge(target.daysLeft, target.status)}</td>
    <td data-label="صادرکننده"><span class="ltr-text" title="${esc(issuer)}">${esc(issuer.length > 42 ? `${issuer.slice(0, 42)}…` : issuer)}</span></td>
    <td data-label="نسخه TLS">${tlsBadge(target.tlsVersion)}</td>
    <td data-label="آخرین بررسی">${lastChecked}</td>
    <td data-label="خطا"><div class="row-error" title="${esc(target.error || '')}">${error}</div></td>
  </tr>`;
}

function render() {
  if (!state.data) return;
  const search = normalizeText(state.search);
  let rows = state.data.targets.filter((target) => {
    if (state.status && target.status !== state.status) return false;
    if (state.category && target.category !== state.category) return false;
    if (!search) return true;
    const haystack = normalizeText(
      [target.displayName, target.url, target.hostname, target.category, ...(target.tags || []), target.issuer || '', target.error || ''].join(' '),
    );
    return haystack.includes(search);
  });

  rows = sortRows(rows, state.sort.key, state.sort.dir, {
    status: (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
    daysLeft: (a, b) => (a.daysLeft ?? Number.MAX_SAFE_INTEGER) - (b.daysLeft ?? Number.MAX_SAFE_INTEGER),
    expiresAt: (a, b) => (new Date(a.expiresAt || 8640000000000000).getTime()) - (new Date(b.expiresAt || 8640000000000000).getTime()),
    lastCheckedAt: (a, b) => (new Date(a.lastCheckedAt || 0).getTime() || 0) - (new Date(b.lastCheckedAt || 0).getTime() || 0),
  });

  updateSortHeaders(els.table, state.sort);

  if (!rows.length) {
    els.body.innerHTML = '';
    els.table.hidden = true;
    els.empty.hidden = false;
    const hasAny = state.data.targets.length > 0;
    els.empty.innerHTML = hasAny
      ? '<strong>موردی پیدا نشد</strong>عبارت جستجو یا فیلترها را تغییر دهید.'
      : `<strong>هنوز دامنه‌ای برای پایش SSL ثبت نشده است</strong>${app.user?.role === 'admin' ? 'از بخش <a href="/admin">مدیریت</a> دامنه اضافه کنید.' : 'پس از افزودن دامنه توسط ادمین، وضعیت SSL اینجا نمایش داده می‌شود.'}`;
    return;
  }

  els.empty.hidden = true;
  els.table.hidden = false;
  els.body.innerHTML = rows.map(rowHtml).join('');
}

async function load(showErrors = false) {
  try {
    state.data = await api('/api/dashboard/ssl');
    els.error.hidden = true;
    fillCategories();
    renderSummary();
    render();
    markUpdated();
  } catch (err) {
    if (err.status === 401) return;
    els.error.textContent = err.message || 'دریافت وضعیت SSL ناموفق بود.';
    els.error.hidden = false;
    if (showErrors) throw err;
  }
}

els.search.addEventListener('input', debounce(() => {
  state.search = els.search.value;
  render();
}, 120));
els.status.addEventListener('change', () => {
  state.status = els.status.value;
  render();
});
els.category.addEventListener('change', () => {
  state.category = els.category.value;
  render();
});
els.table.querySelectorAll('[data-sort]').forEach((button) => {
  button.addEventListener('click', () => {
    const key = button.dataset.sort;
    if (state.sort.key === key) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
    else state.sort = { key, dir: 'asc' };
    render();
  });
});

initShell({ page: 'ssl', onRefresh: load })
  .then(() => load())
  .catch((err) => {
    els.error.textContent = err.message;
    els.error.hidden = false;
  });

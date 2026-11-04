import {
  api,
  app,
  bothDates,
  debounce,
  esc,
  fmtDate,
  fmtMs,
  fmtNumber,
  initShell,
  markUpdated,
  normalizeText,
  percentCell,
  relativeTime,
  sortRows,
  sparkline,
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
  sort: { key: 'displayName', dir: 'asc' },
};

const els = {
  summary: document.getElementById('summary'),
  body: document.getElementById('uptime-body'),
  table: document.getElementById('uptime-table'),
  search: document.getElementById('search'),
  status: document.getElementById('filter-status'),
  category: document.getElementById('filter-category'),
  error: document.getElementById('error-banner'),
  empty: document.getElementById('empty-state'),
  refresh: document.getElementById('refresh-btn'),
};

const STATUS_ORDER = { down: 0, degraded: 1, unknown: 2, up: 3 };

function renderSummary() {
  const s = state.data?.summary || { total: 0, up: 0, degraded: 0, down: 0, unknown: 0 };
  els.summary.innerHTML = [
    summaryCard('کل دامنه‌ها', s.total, 'info', icons.globe),
    summaryCard('Up', s.up, 'ok', icons.check),
    summaryCard('Degraded', s.degraded, 'warn', icons.clock),
    summaryCard('Down', s.down, 'bad', icons.x),
    summaryCard('بدون بررسی', s.unknown, 'muted', icons.alert),
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

function rowHtml(target) {
  const tags = (target.tags || []).slice(0, 3).map((tag) => `<span class="tag">${esc(tag)}</span>`).join('');
  const extraTags = (target.tags || []).length > 3 ? `<span class="tag">+${fmtNumber(target.tags.length - 3)}</span>` : '';
  const responseClass =
    target.responseMs === null
      ? ''
      : target.responseMs >= target.degradedThresholdMs
        ? 'very-slow'
        : target.responseMs >= target.degradedThresholdMs / 2
          ? 'slow'
          : '';
  const error = target.error
    ? `<div class="row-sub row-error" title="${esc(target.error)}">${esc(target.error.length > 70 ? `${target.error.slice(0, 70)}…` : target.error)}</div>`
    : '';
  const failures =
    target.consecutiveFailures > 0 && target.status !== 'down'
      ? `<div class="row-sub">${fmtNumber(target.consecutiveFailures)} شکست متوالی از ${fmtNumber(target.failureThreshold)}</div>`
      : '';
  const lastChecked = target.lastCheckedAt
    ? `<span title="${esc(bothDates(target.lastCheckedAt))}">${esc(relativeTime(target.lastCheckedAt))}</span>
       <div class="row-sub">${esc(fmtDate(target.lastCheckedAt))}</div>`
    : '<span class="muted">بررسی نشده</span>';

  return `<tr>
    <td data-label="نام / دامنه">
      <div class="target-name">
        <strong>${esc(target.displayName)}</strong>
        <a href="${esc(target.url)}" target="_blank" rel="noopener noreferrer" title="${esc(target.url)}">${esc(target.url)}</a>
        ${tags || extraTags ? `<div class="tags">${tags}${extraTags}</div>` : ''}
      </div>
    </td>
    <td data-label="دسته"><span class="category-chip">${esc(target.category || '—')}</span></td>
    <td data-label="وضعیت">
      ${statusPill(target.status)}
      ${failures}${error}
    </td>
    <td data-label="کد HTTP">${target.statusCode ? `<span class="http-code">${fmtNumber(target.statusCode, { useGrouping: false })}</span>` : '<span class="muted">—</span>'}</td>
    <td data-label="زمان پاسخ"><span class="response-ms ${responseClass}">${fmtMs(target.responseMs)}</span></td>
    <td data-label="Uptime ۲۴ ساعت">${percentCell(target.uptime.h24)}</td>
    <td data-label="Uptime ۷ روز">${percentCell(target.uptime.d7)}</td>
    <td data-label="Uptime ۳۰ روز">${percentCell(target.uptime.d30)}</td>
    <td data-label="آخرین بررسی">${lastChecked}</td>
    <td data-label="نمودار">${sparkline(target.sparkline)}</td>
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
      [target.displayName, target.url, target.hostname, target.category, ...(target.tags || []), target.error || ''].join(' '),
    );
    return haystack.includes(search);
  });

  rows = sortRows(rows, state.sort.key, state.sort.dir, {
    status: (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
    lastCheckedAt: (a, b) => (new Date(a.lastCheckedAt || 0).getTime() || 0) - (new Date(b.lastCheckedAt || 0).getTime() || 0),
    responseMs: (a, b) => (a.responseMs ?? -1) - (b.responseMs ?? -1),
    statusCode: (a, b) => (a.statusCode ?? -1) - (b.statusCode ?? -1),
  });

  updateSortHeaders(els.table, state.sort);

  if (!rows.length) {
    els.body.innerHTML = '';
    els.table.hidden = true;
    els.empty.hidden = false;
    const hasAny = state.data.targets.length > 0;
    els.empty.innerHTML = hasAny
      ? '<strong>موردی پیدا نشد</strong>عبارت جستجو یا فیلترها را تغییر دهید.'
      : `<strong>هنوز دامنه‌ای ثبت نشده است</strong>${app.user?.role === 'admin' ? 'از بخش <a href="/admin">مدیریت</a> دامنه‌ها را اضافه کنید.' : 'پس از افزودن دامنه توسط ادمین، وضعیت اینجا نمایش داده می‌شود.'}`;
    return;
  }

  els.empty.hidden = true;
  els.table.hidden = false;
  els.body.innerHTML = rows.map(rowHtml).join('');
}

async function load(showErrors = false) {
  try {
    state.data = await api('/api/dashboard/uptime');
    els.error.hidden = true;
    fillCategories();
    renderSummary();
    render();
    markUpdated();
  } catch (err) {
    if (err.status === 401) return;
    els.error.textContent = err.message || 'دریافت وضعیت سایت‌ها ناموفق بود.';
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
    else state.sort = { key, dir: key === 'status' ? 'asc' : 'asc' };
    render();
  });
});

initShell({ page: 'uptime', onRefresh: load })
  .then(() => load())
  .catch((err) => {
    els.error.textContent = err.message;
    els.error.hidden = false;
  });

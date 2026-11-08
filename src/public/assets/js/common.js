const DATE_MODE_KEY = 'didehban-date-mode';
const AUTO_REFRESH_KEY = 'didehban-auto-refresh';
const AUTO_REFRESH_MS = 20_000;

export const app = {
  user: null,
  csrfToken: null,
  timezone: 'Asia/Tehran',
  dateMode: localStorage.getItem(DATE_MODE_KEY) || 'jalali',
  autoRefresh: localStorage.getItem(AUTO_REFRESH_KEY) !== 'false',
  refreshHandlers: [],
};

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replaceAll('ي', 'ی')
    .replaceAll('ك', 'ک')
    .replaceAll('\u200c', ' ')
    .trim();
}

export async function api(path, options = {}) {
  const method = options.method || 'GET';
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  let body;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers['X-CSRF-Token'] = options.csrf || app.csrfToken || '';
  }

  let response;
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    const err = new Error('ارتباط با سرور برقرار نشد. اتصال شبکه را بررسی کنید.');
    err.status = 0;
    throw err;
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (response.status === 401 && !path.includes('/auth/login')) {
    const next = encodeURIComponent(location.pathname);
    location.href = `/login?next=${next}`;
    throw new Error('نشست منقضی شده است.');
  }

  if (!response.ok) {
    const err = new Error(data?.message || 'خطای غیرمنتظره رخ داد.');
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

const dateFormatters = new Map();

function getFormatter(calendar, options) {
  const key = `${calendar}:${app.timezone}:${JSON.stringify(options)}`;
  if (!dateFormatters.has(key)) {
    const locale = calendar === 'gregory' ? 'fa-IR-u-ca-gregory' : 'fa-IR-u-ca-persian';
    dateFormatters.set(key, new Intl.DateTimeFormat(locale, { timeZone: app.timezone, ...options }));
  }
  return dateFormatters.get(key);
}

function timeFormatter() {
  const key = `time:${app.timezone}`;
  if (!dateFormatters.has(key)) {
    dateFormatters.set(key, new Intl.DateTimeFormat('fa-IR', {
      timeZone: app.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }));
  }
  return dateFormatters.get(key);
}

export function fmtDate(iso, withTime = true) {
  if (!iso) return '—';
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const calendar = app.dateMode === 'gregory' ? 'gregory' : 'persian';
  const day = getFormatter(calendar, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  if (!withTime) return day;
  return `${day} - ${timeFormatter().format(date)}`;
}

export function fmtDateOnly(iso) {
  return fmtDate(iso, false);
}

export function bothDates(iso) {
  if (!iso) return '';
  const previous = app.dateMode;
  app.dateMode = 'jalali';
  const jalali = fmtDate(iso);
  app.dateMode = 'gregory';
  const gregory = fmtDate(iso);
  app.dateMode = previous;
  return `شمسی: ${jalali} | میلادی: ${gregory}`;
}

export function fmtNumber(value, options = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('fa-IR', { maximumFractionDigits: 1, ...options });
}

export function fmtMs(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  if (value >= 1000) return `${fmtNumber(Number(value) / 1000, { maximumFractionDigits: 2 })} ثانیه`;
  return `${fmtNumber(value)} میلی‌ثانیه`;
}

export function fmtDays(value) {
  if (value === null || value === undefined) return '—';
  return `${fmtNumber(value)} روز`;
}

export function fmtSeconds(value) {
  if (value === null || value === undefined) return '—';
  if (value < 60) return `${fmtNumber(value)} ثانیه`;
  if (value % 60 === 0 && value < 3600) return `${fmtNumber(value / 60)} دقیقه`;
  if (value % 3600 === 0) return `${fmtNumber(value / 3600)} ساعت`;
  return `${fmtNumber(value)} ثانیه`;
}

export function fmtDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${fmtNumber(Math.floor(seconds))} ثانیه`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${fmtNumber(minutes)} دقیقه`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${fmtNumber(hours)} ساعت و ${fmtNumber(minutes % 60)} دقیقه`;
  const days = Math.floor(hours / 24);
  return `${fmtNumber(days)} روز و ${fmtNumber(hours % 24)} ساعت`;
}

export function relativeTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);
  const formatter = new Intl.RelativeTimeFormat('fa', { numeric: 'auto' });
  if (abs < 60) return formatter.format(diffSeconds, 'second');
  if (abs < 3600) return formatter.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86400) return formatter.format(Math.round(diffSeconds / 3600), 'hour');
  return formatter.format(Math.round(diffSeconds / 86400), 'day');
}

const UPTIME_STATUS = {
  up: { label: 'Up', css: 'ok' },
  degraded: { label: 'Degraded', css: 'warn' },
  down: { label: 'Down', css: 'bad' },
  unknown: { label: 'نامشخص', css: 'muted' },
};

const SSL_STATUS = {
  ok: { label: 'سالم', css: 'ok' },
  expiring: { label: 'در خطر', css: 'warn' },
  invalid: { label: 'خراب', css: 'bad' },
  unknown: { label: 'نامشخص', css: 'muted' },
};

export function statusPill(status, kind = 'uptime') {
  const map = kind === 'ssl' ? SSL_STATUS : UPTIME_STATUS;
  const meta = map[status] || map.unknown;
  return `<span class="pill ${meta.css}"><span class="dot"></span>${meta.label}</span>`;
}

export function daysBadge(days, status) {
  if (status === 'invalid' && (days === null || days === undefined)) return '<span class="days bad">خراب</span>';
  if (days === null || days === undefined) return '<span class="muted">—</span>';
  let css = 'good';
  if (days <= 7) css = 'bad';
  else if (days <= 30) css = 'warn';
  const label = days < 0 ? 'منقضی' : `${fmtNumber(days)} روز`;
  return `<span class="days ${css}">${label}</span>`;
}

export function percentCell(value) {
  if (value === null || value === undefined) return '<span class="muted" title="بررسی‌ای ثبت نشده">—</span>';
  let css = 'good';
  if (value < 95) css = 'bad';
  else if (value < 99.5) css = 'warn';
  return `<span class="uptime-val ${css}">${fmtNumber(value)}٪</span>`;
}

export function sparkline(points) {
  if (!Array.isArray(points) || !points.length) return '<span class="muted">—</span>';
  const values = points.filter((point) => Number.isFinite(point.ms));
  if (!values.length) return '<span class="muted">—</span>';

  const width = 104;
  const height = 30;
  const pad = 3;
  const max = Math.max(1, ...values.map((point) => point.ms));
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const coords = values.map((point, index) => [
    pad + step * index,
    height - pad - (point.ms / max) * (height - pad * 2),
  ]);
  const path = coords.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const lastPoint = values[values.length - 1];
  const color = lastPoint.ok ? '#0f766e' : '#dc2626';
  const last = coords[coords.length - 1];
  const failures = coords
    .map(([x, y], index) => (values[index].ok ? '' : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.8" fill="#dc2626"/>`))
    .join('');
  const maxMs = Math.round(max);
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="نمودار زمان پاسخ">
    <title>حداکثر زمان پاسخ در ۳۰ بررسی اخیر: ${fmtNumber(maxMs)} میلی‌ثانیه</title>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    ${failures}
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.4" fill="${color}"/>
  </svg>`;
}

let toastContainer = null;
export function toast(message, type = 'info') {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toasts';
    toastContainer.id = 'toasts';
    document.body.append(toastContainer);
  }
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  toastContainer.append(item);
  setTimeout(() => {
    item.classList.add('out');
    setTimeout(() => item.remove(), 300);
  }, 4200);
}

export function openModal(modal) {
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add('modal-open');
  const focusable = modal.querySelector('input:not([type=hidden]), select, textarea, button');
  setTimeout(() => focusable?.focus(), 30);
}

export function closeModal(modal) {
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove('modal-open');
}

export function initModals() {
  document.addEventListener('click', (event) => {
    const closeTarget = event.target.closest('[data-close-modal]');
    if (closeTarget) {
      closeModal(closeTarget.closest('.modal'));
      return;
    }
    if (event.target.classList.contains('modal')) closeModal(event.target);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      document.querySelectorAll('.modal:not([hidden])').forEach((modal) => closeModal(modal));
    }
  });
}

export function debounce(fn, wait = 150) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function setBusy(button, busy, busyText = 'در حال انجام...') {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

export function sortRows(rows, key, direction, custom = {}) {
  const factor = direction === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (custom[key]) return custom[key](a, b) * factor;
    let av = a[key];
    let bv = b[key];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
    return String(av).localeCompare(String(bv), 'fa') * factor;
  });
}

export function updateSortHeaders(table, sort) {
  table.querySelectorAll('[data-sort]').forEach((button) => {
    button.classList.toggle('active', button.dataset.sort === sort.key);
    button.dataset.direction = button.dataset.sort === sort.key ? sort.dir : '';
  });
}

export function initShell({ page, onRefresh, requireAdmin = false } = {}) {
  initModals();

  const logout = document.getElementById('logout-btn');
  logout?.addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    location.href = '/login';
  });

  const dateToggle = document.getElementById('date-toggle');
  const updateDateLabel = () => {
    if (dateToggle) dateToggle.textContent = app.dateMode === 'jalali' ? 'نمایش میلادی' : 'نمایش شمسی';
  };
  updateDateLabel();
  dateToggle?.addEventListener('click', () => {
    app.dateMode = app.dateMode === 'jalali' ? 'gregory' : 'jalali';
    localStorage.setItem(DATE_MODE_KEY, app.dateMode);
    updateDateLabel();
    app.refreshHandlers.forEach((handler) => handler());
  });

  const refreshButton = document.getElementById('refresh-btn');
  refreshButton?.addEventListener('click', () => runRefresh(true));

  document.querySelectorAll('[data-nav]').forEach((link) => {
    link.classList.toggle('active', link.dataset.nav === page);
  });

  let timer = null;
  function startTimer() {
    clearInterval(timer);
    if (!app.autoRefresh) return;
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') runRefresh(false);
    }, AUTO_REFRESH_MS);
  }

  function runRefresh(showErrors = false) {
    return Promise.all(
      app.refreshHandlers.map((handler) =>
        Promise.resolve(handler(showErrors)).catch((err) => {
          if (showErrors) toast(err.message, 'error');
        }),
      ),
    );
  }

  const autoRefreshInput = document.querySelector('[data-auto-refresh]');
  if (autoRefreshInput) {
    autoRefreshInput.checked = app.autoRefresh;
    autoRefreshInput.addEventListener('change', () => {
      app.autoRefresh = autoRefreshInput.checked;
      localStorage.setItem(AUTO_REFRESH_KEY, String(app.autoRefresh));
      startTimer();
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && app.autoRefresh) runRefresh(false);
  });

  if (typeof onRefresh === 'function') app.refreshHandlers.push(onRefresh);

  return api('/api/auth/me').then((me) => {
    app.user = me.user;
    app.csrfToken = me.csrfToken;
    app.timezone = me.timezone || app.timezone;

    document.querySelectorAll('[data-user-name]').forEach((el) => { el.textContent = me.user.username; });
    document.querySelectorAll('[data-user-role]').forEach((el) => {
      el.textContent = me.user.role === 'admin' ? 'ادمین' : 'بیننده';
    });
    document.querySelectorAll('[data-admin-only]').forEach((el) => {
      el.hidden = me.user.role !== 'admin';
    });

    if (requireAdmin && me.user.role !== 'admin') {
      location.href = '/dashboard';
      throw new Error('دسترسی مجاز نیست.');
    }

    startTimer();
    return me;
  });
}

export function markUpdated() {
  const el = document.querySelector('[data-last-updated]');
  if (el) el.textContent = fmtDate(new Date());
}

export function summaryCard(label, value, css = '', icon = '', options = {}) {
  const { filter = null, active = false } = options;
  const body = `
    <span class="stat-icon" aria-hidden="true">${icon}</span>
    <span class="stat-body">
      <span class="stat-value">${fmtNumber(value)}</span>
      <span class="stat-label">${esc(label)}</span>
    </span>`;

  // کارت‌های خلاصه در داشبورد به‌عنوان دکمه فیلتر عمل می‌کنند.
  if (filter !== null) {
    return `<button type="button" class="stat-card ${css}${active ? ' is-active' : ''}" data-filter="${esc(filter)}" aria-pressed="${active}">${body}</button>`;
  }

  return `<div class="stat-card ${css}">${body}</div>`;
}

export const icons = {
  globe: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.8 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.8-3.8-9S9.5 5.7 12 3Z"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m5 12.5 4.2 4L19 7"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 7v5.3l3.4 2"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 7l10 10M17 7 7 17"/></svg>',
  shield: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3 5 6v5.5c0 4.4 2.9 7.6 7 9.5 4.1-1.9 7-5.1 7-9.5V6l-7-3Z"/><path d="m9 12 2 2 4-4.2"/></svg>',
  alert: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 4 3 20h18L12 4Z"/><path d="M12 9.5v4.2M12 17h.01"/></svg>',
};

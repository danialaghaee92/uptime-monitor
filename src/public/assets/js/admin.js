import {
  api,
  app,
  closeModal,
  debounce,
  esc,
  fmtDate,
  fmtDateOnly,
  fmtNumber,
  fmtSeconds,
  initShell,
  markUpdated,
  normalizeText,
  openModal,
  relativeTime,
  setBusy,
  statusPill,
  toast,
} from './common.js';

const state = {
  targets: [],
  users: [],
  settings: null,
  channels: null,
  targetSearch: '',
  usersLoaded: false,
};

const els = {
  targetBody: document.getElementById('targets-body'),
  targetTable: document.getElementById('targets-table'),
  targetEmpty: document.getElementById('targets-empty'),
  targetError: document.getElementById('targets-error'),
  targetSearch: document.getElementById('target-search'),
  usersBody: document.getElementById('users-body'),
  usersError: document.getElementById('users-error'),
  settingsForm: document.getElementById('settings-form'),
  settingsStatus: document.getElementById('settings-status'),
  channels: document.getElementById('channels-status'),
  passwordForm: document.getElementById('password-form'),
  passwordStatus: document.getElementById('password-status'),
};

const targetModal = document.getElementById('target-modal');
const targetForm = document.getElementById('target-form');
const targetFormError = document.getElementById('target-form-error');
const targetSaveButton = document.getElementById('target-save');

const bulkModal = document.getElementById('bulk-modal');
const bulkError = document.getElementById('bulk-error');
const bulkResult = document.getElementById('bulk-result');

const userModal = document.getElementById('user-modal');
const userForm = document.getElementById('user-form');
const userFormError = document.getElementById('user-form-error');
const userSaveButton = document.getElementById('user-save');

function showBox(box, message, isError = true) {
  box.textContent = message;
  box.className = `alert ${isError ? 'alert-error' : 'alert-success'}`;
  box.hidden = false;
}

function hideBox(box) {
  box.hidden = true;
  box.textContent = '';
}

/* ---------------- Tabs ---------------- */
function switchTab(name) {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    const active = button.dataset.tab === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  ['targets', 'users', 'settings'].forEach((tab) => {
    document.getElementById(`tab-${tab}`).hidden = tab !== name;
  });
  if (name === 'users' && !state.usersLoaded) loadUsers();
}

document.querySelectorAll('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
});

/* ---------------- Targets ---------------- */
function targetRow(target) {
  const tags = (target.tags || []).map((tag) => `<span class="tag">${esc(tag)}</span>`).join('');
  const last = [target.lastCheckedAt, target.sslLastCheckedAt].filter(Boolean).sort().pop();
  const uptimeConfig = target.uptimeEnabled
    ? `<span class="pill ok"><span class="dot"></span>فعال</span><div class="row-sub">هر ${esc(fmtSeconds(target.uptimeIntervalSeconds))}</div>`
    : '<span class="pill muted"><span class="dot"></span>غیرفعال</span>';
  const sslConfig = target.sslEnabled
    ? `<span class="pill ok"><span class="dot"></span>فعال</span><div class="row-sub">هر ${esc(fmtSeconds(target.effectiveSslIntervalSeconds))}${target.sslIntervalSeconds ? '' : ' (سراسری)'}</div>`
    : '<span class="pill muted"><span class="dot"></span>غیرفعال</span>';

  return `<tr>
    <td data-label="نام / دامنه">
      <div class="target-name">
        <strong>${esc(target.displayName)} ${target.isActive ? '' : '<span class="pill muted inactive-badge">غیرفعال</span>'}</strong>
        <a href="${esc(target.url)}" target="_blank" rel="noopener noreferrer" title="${esc(target.url)}">${esc(target.url)}</a>
        ${tags ? `<div class="tags">${tags}</div>` : ''}
      </div>
    </td>
    <td data-label="دسته"><span class="category-chip">${esc(target.category || '—')}</span></td>
    <td data-label="پایش سایت">${uptimeConfig}</td>
    <td data-label="پایش SSL">${sslConfig}</td>
    <td data-label="وضعیت فعلی">
      <div class="row-actions start">
        ${target.uptimeEnabled ? statusPill(target.uptimeStatus) : '<span class="pill muted"><span class="dot"></span>سایت غیرفعال</span>'}
        ${target.sslEnabled ? statusPill(target.sslStatus, 'ssl') : '<span class="pill muted"><span class="dot"></span>SSL غیرفعال</span>'}
      </div>
      ${target.lastError ? `<div class="row-sub row-error" title="${esc(target.lastError)}">${esc(target.lastError.slice(0, 45))}</div>` : ''}
    </td>
    <td data-label="آخرین بررسی">${
      last ? `<span title="${esc(fmtDate(last))}">${esc(relativeTime(last))}</span>` : '<span class="muted">—</span>'
    }</td>
    <td data-label="عملیات">
      <div class="row-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-action="edit-target" data-id="${target.id}">ویرایش</button>
        <button class="btn btn-ghost btn-sm btn-danger-ghost" type="button" data-action="delete-target" data-id="${target.id}">حذف</button>
      </div>
    </td>
  </tr>`;
}

function renderTargets() {
  const search = normalizeText(state.targetSearch);
  const rows = state.targets.filter((target) => {
    if (!search) return true;
    return normalizeText(
      [target.displayName, target.url, target.hostname, target.category, ...(target.tags || [])].join(' '),
    ).includes(search);
  });

  els.targetBody.innerHTML = '';
  if (!rows.length) {
    els.targetTable.hidden = true;
    els.targetEmpty.hidden = false;
    els.targetEmpty.innerHTML = state.targets.length
      ? '<strong>موردی پیدا نشد</strong>عبارت جستجو را تغییر دهید.'
      : '<strong>هنوز دامنه‌ای اضافه نشده است</strong>با دکمه «افزودن دامنه» یا «افزودن گروهی» شروع کنید.';
    return;
  }
  els.targetEmpty.hidden = true;
  els.targetTable.hidden = false;
  els.targetBody.innerHTML = rows.map(targetRow).join('');
}

async function loadTargets() {
  try {
    const data = await api('/api/admin/targets');
    state.targets = data.targets;
    hideBox(els.targetError);
    renderTargets();
    markUpdated();
  } catch (err) {
    if (err.status === 401) return;
    showBox(els.targetError, err.message || 'دریافت دامنه‌ها ناموفق بود.');
  }
}

function fillTargetForm(target) {
  const form = targetForm.elements;
  form.id.value = target?.id || '';
  form.url.value = target?.url || '';
  form.displayName.value = target?.displayName || '';
  form.category.value = target?.category || '';
  form.tags.value = (target?.tags || []).join('، ');
  form.uptimeIntervalSeconds.value = target?.uptimeIntervalSeconds ?? state.settings?.defaultUptimeIntervalSeconds ?? 60;
  form.timeoutSeconds.value = target?.timeoutSeconds ?? state.settings?.defaultTimeoutSeconds ?? 10;
  form.degradedThresholdMs.value = target?.degradedThresholdMs ?? state.settings?.defaultDegradedThresholdMs ?? 3000;
  form.failureThreshold.value = target?.failureThreshold ?? state.settings?.defaultFailureThreshold ?? 3;
  form.acceptedStatusCodes.value = target?.acceptedStatusCodes ?? state.settings?.defaultAcceptedStatusCodes ?? '200-399';
  form.sslIntervalSeconds.value = target?.sslIntervalSeconds ?? '';
  form.uptimeEnabled.checked = target?.uptimeEnabled ?? true;
  form.sslEnabled.checked = target?.sslEnabled ?? true;
  form.isActive.checked = target?.isActive ?? true;
  form.allowPrivate.checked = target?.allowPrivate ?? state.settings?.allowPrivateTargets ?? false;
}

function openTargetModal(target = null) {
  targetForm.reset();
  hideBox(targetFormError);
  fillTargetForm(target);
  document.getElementById('target-modal-title').textContent = target ? 'ویرایش دامنه' : 'افزودن دامنه';
  openModal(targetModal);
}

function numberOrNull(value) {
  return value === '' || value === null || value === undefined ? null : Number(value);
}

targetForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!targetForm.reportValidity()) return;
  hideBox(targetFormError);

  const form = targetForm.elements;
  const id = form.id.value;
  const sslInterval = numberOrNull(form.sslIntervalSeconds.value);
  const payload = {
    url: form.url.value.trim(),
    displayName: form.displayName.value.trim(),
    category: form.category.value.trim(),
    tags: form.tags.value,
    uptimeEnabled: form.uptimeEnabled.checked,
    sslEnabled: form.sslEnabled.checked,
    isActive: form.isActive.checked,
    allowPrivate: form.allowPrivate.checked,
    uptimeIntervalSeconds: Number(form.uptimeIntervalSeconds.value),
    timeoutSeconds: Number(form.timeoutSeconds.value),
    degradedThresholdMs: Number(form.degradedThresholdMs.value),
    failureThreshold: Number(form.failureThreshold.value),
    acceptedStatusCodes: form.acceptedStatusCodes.value.trim(),
    sslIntervalSeconds: sslInterval,
  };

  setBusy(targetSaveButton, true);
  try {
    if (id) {
      await api(`/api/admin/targets/${id}`, { method: 'PATCH', body: payload });
      toast('دامنه به‌روزرسانی شد.', 'success');
    } else {
      await api('/api/admin/targets', { method: 'POST', body: payload });
      toast('دامنه اضافه شد و هر دو پایش ساخته شد.', 'success');
    }
    closeModal(targetModal);
    await loadTargets();
  } catch (err) {
    showBox(targetFormError, err.message || 'ذخیره دامنه ناموفق بود.');
  } finally {
    setBusy(targetSaveButton, false);
  }
});

document.getElementById('target-add').addEventListener('click', () => openTargetModal());
els.targetSearch.addEventListener('input', debounce(() => {
  state.targetSearch = els.targetSearch.value;
  renderTargets();
}, 120));

els.targetBody.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const id = Number(button.dataset.id);
  const target = state.targets.find((item) => item.id === id);
  if (!target) return;

  if (button.dataset.action === 'edit-target') {
    openTargetModal(target);
    return;
  }

  if (button.dataset.action === 'delete-target') {
    if (!confirm(`دامنه «${target.displayName}» و تمام تاریخچه آن حذف شود؟`)) return;
    setBusy(button, true, '...');
    try {
      await api(`/api/admin/targets/${id}`, { method: 'DELETE' });
      toast('دامنه حذف شد.', 'success');
      await loadTargets();
    } catch (err) {
      showBox(els.targetError, err.message);
    } finally {
      setBusy(button, false);
    }
  }
});

/* ---------------- Bulk import ---------------- */
function openBulkModal() {
  document.getElementById('bulk-text').value = '';
  document.getElementById('bulk-category').value = '';
  document.getElementById('bulk-tags').value = '';
  document.getElementById('bulk-file').value = '';
  document.getElementById('bulk-private').checked = false;
  bulkResult.hidden = true;
  bulkResult.innerHTML = '';
  hideBox(bulkError);
  openModal(bulkModal);
}

document.getElementById('bulk-open').addEventListener('click', openBulkModal);

function bulkPayload() {
  return {
    category: document.getElementById('bulk-category').value.trim(),
    tags: document.getElementById('bulk-tags').value.trim(),
    allowPrivate: document.getElementById('bulk-private').checked,
  };
}

function renderBulkResult(result) {
  const chunks = [
    `<h4>نتیجه ورود: <span class="ok-text">${fmtNumber(result.addedCount)} افزوده</span>، ${fmtNumber(result.duplicateCount)} تکراری، ${fmtNumber(result.invalidCount)} نامعتبر</h4>`,
  ];
  if (result.added.length) {
    chunks.push(`<div class="ok-text">افزوده شد:</div><ul>${result.added
      .map((item) => `<li>${esc(item.displayName)} — <span class="mono">${esc(item.url)}</span></li>`)
      .join('')}</ul>`);
  }
  if (result.duplicates.length) {
    chunks.push(`<div>تکراری‌ها:</div><ul>${result.duplicates
      .map((item) => `<li><span class="mono">${esc(item.url)}</span> — ${esc(item.reason)}</li>`)
      .join('')}</ul>`);
  }
  if (result.invalid.length) {
    chunks.push(`<div class="bad-text">نامعتبر:</div><ul>${result.invalid
      .map((item) => `<li>خط ${fmtNumber(item.line)}: <span class="mono">${esc(item.url || '—')}</span> — ${esc(item.reason)}</li>`)
      .join('')}</ul>`);
  }
  if (result.truncated) chunks.push('<p class="bad-text">فقط ۲۰۰۰ ردیف اول پردازش شد.</p>');
  bulkResult.innerHTML = chunks.join('');
  bulkResult.hidden = false;
}

document.getElementById('bulk-text-submit').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const text = document.getElementById('bulk-text').value;
  if (!text.trim()) {
    showBox(bulkError, 'لیست دامنه‌ها خالی است.');
    return;
  }
  hideBox(bulkError);
  setBusy(button, true, 'در حال افزودن...');
  try {
    const result = await api('/api/admin/targets/import', {
      method: 'POST',
      body: { text, ...bulkPayload() },
    });
    renderBulkResult(result);
    await loadTargets();
    toast(`${fmtNumber(result.addedCount)} دامنه افزوده شد.`, 'success');
  } catch (err) {
    showBox(bulkError, err.message || 'افزودن گروهی ناموفق بود.');
  } finally {
    setBusy(button, false);
  }
});

document.getElementById('bulk-file-submit').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const fileInput = document.getElementById('bulk-file');
  const file = fileInput.files?.[0];
  if (!file) {
    showBox(bulkError, 'ابتدا یک فایل CSV انتخاب کنید.');
    return;
  }
  hideBox(bulkError);
  setBusy(button, true, 'در حال آپلود...');
  try {
    const formData = new FormData();
    formData.append('file', file);
    const payload = bulkPayload();
    formData.append('category', payload.category);
    formData.append('tags', payload.tags);
    formData.append('allowPrivate', String(payload.allowPrivate));
    const result = await api('/api/admin/targets/import-csv', { method: 'POST', formData });
    renderBulkResult(result);
    await loadTargets();
    toast(`${fmtNumber(result.addedCount)} دامنه از فایل افزوده شد.`, 'success');
  } catch (err) {
    showBox(bulkError, err.message || 'آپلود فایل ناموفق بود.');
  } finally {
    setBusy(button, false);
  }
});

/* ---------------- Users ---------------- */
function userRow(user) {
  const rolePill = user.role === 'admin'
    ? '<span class="pill warn"><span class="dot"></span>ادمین</span>'
    : '<span class="pill muted"><span class="dot"></span>بیننده</span>';
  const activePill = user.isActive
    ? '<span class="pill ok"><span class="dot"></span>فعال</span>'
    : '<span class="pill bad"><span class="dot"></span>غیرفعال</span>';
  const locked = user.lockedUntil && new Date(user.lockedUntil) > new Date();

  return `<tr>
    <td data-label="نام کاربری"><strong>${esc(user.username)}</strong>${locked ? '<div class="row-sub">موقتاً قفل است</div>' : ''}</td>
    <td data-label="نقش">${rolePill}</td>
    <td data-label="وضعیت">${activePill}</td>
    <td data-label="آخرین ورود">${user.lastLoginAt ? `<span title="${esc(fmtDate(user.lastLoginAt))}">${esc(relativeTime(user.lastLoginAt))}</span>` : '<span class="muted">هرگز</span>'}</td>
    <td data-label="تاریخ ساخت">${esc(fmtDateOnly(user.createdAt))}</td>
    <td data-label="عملیات">
      <div class="row-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-action="edit-user" data-id="${user.id}">ویرایش</button>
        ${user.id === app.user?.id ? '' : `<button class="btn btn-ghost btn-sm btn-danger-ghost" type="button" data-action="delete-user" data-id="${user.id}">حذف</button>`}
      </div>
    </td>
  </tr>`;
}

function renderUsers() {
  if (!state.users.length) {
    els.usersBody.innerHTML = '<tr><td colspan="6" class="empty-state">کاربری یافت نشد.</td></tr>';
    return;
  }
  els.usersBody.innerHTML = state.users.map(userRow).join('');
}

async function loadUsers() {
  try {
    const data = await api('/api/admin/users');
    state.users = data.users;
    state.usersLoaded = true;
    hideBox(els.usersError);
    renderUsers();
    markUpdated();
  } catch (err) {
    if (err.status === 401) return;
    showBox(els.usersError, err.message || 'دریافت کاربران ناموفق بود.');
  }
}

function openUserModal(user = null) {
  userForm.reset();
  hideBox(userFormError);
  const form = userForm.elements;
  form.id.value = user?.id || '';
  form.username.value = user?.username || '';
  form.username.disabled = Boolean(user);
  form.password.value = '';
  form.password.required = !user;
  form.role.value = user?.role || 'viewer';
  form.isActive.checked = user?.isActive ?? true;
  document.getElementById('user-modal-title').textContent = user ? 'ویرایش کاربر' : 'افزودن کاربر';
  document.getElementById('password-optional').textContent = user ? '(خالی = بدون تغییر)' : '';
  openModal(userModal);
}

document.getElementById('user-add').addEventListener('click', () => openUserModal());

userForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!userForm.reportValidity()) return;
  hideBox(userFormError);

  const form = userForm.elements;
  const id = form.id.value;
  const password = form.password.value;
  if (!id && password.length < 10) {
    showBox(userFormError, 'رمز عبور باید حداقل ۱۰ کاراکتر باشد.');
    return;
  }

  setBusy(userSaveButton, true);
  try {
    if (id) {
      const body = { role: form.role.value, isActive: form.isActive.checked };
      if (password) body.password = password;
      await api(`/api/admin/users/${id}`, { method: 'PATCH', body });
      toast('کاربر به‌روزرسانی شد.', 'success');
    } else {
      await api('/api/admin/users', {
        method: 'POST',
        body: {
          username: form.username.value.trim(),
          password,
          role: form.role.value,
          isActive: form.isActive.checked,
        },
      });
      toast('کاربر اضافه شد.', 'success');
    }
    closeModal(userModal);
    await loadUsers();
  } catch (err) {
    showBox(userFormError, err.message || 'ذخیره کاربر ناموفق بود.');
  } finally {
    setBusy(userSaveButton, false);
  }
});

els.usersBody.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const id = Number(button.dataset.id);
  const user = state.users.find((item) => item.id === id);
  if (!user) return;

  if (button.dataset.action === 'edit-user') {
    openUserModal(user);
    return;
  }
  if (button.dataset.action === 'delete-user') {
    if (!confirm(`کاربر «${user.username}» حذف شود؟`)) return;
    setBusy(button, true, '...');
    try {
      await api(`/api/admin/users/${id}`, { method: 'DELETE' });
      toast('کاربر حذف شد.', 'success');
      await loadUsers();
    } catch (err) {
      showBox(els.usersError, err.message);
    } finally {
      setBusy(button, false);
    }
  }
});

/* ---------------- Settings ---------------- */
function renderChannels(channels) {
  if (!channels) {
    els.channels.textContent = 'اطلاعات کانال‌ها در دسترس نیست.';
    return;
  }
  const cards = [
    {
      title: 'ایمیل (SMTP)',
      enabled: channels.email?.enabled,
      details: [
        channels.email?.host ? `میزبان: ${channels.email.host}` : 'SMTP_HOST تنظیم نشده',
        channels.email?.from ? `فرستنده: ${channels.email.from}` : 'SMTP_FROM تنظیم نشده',
        channels.email?.to ? `گیرنده: ${channels.email.to}` : 'ALERT_EMAIL_TO تنظیم نشده',
      ],
    },
    {
      title: 'تلگرام',
      enabled: channels.telegram?.enabled,
      details: ['توکن و chat id فقط از متغیرهای محیطی خوانده می‌شوند.'],
    },
    {
      title: 'وب‌هوک عمومی',
      enabled: channels.webhook?.enabled,
      details: [channels.webhook?.url ? `مقصد: ${channels.webhook.url}` : 'WEBHOOK_URL تنظیم نشده'],
    },
  ];

  els.channels.innerHTML = cards
    .map(
      (card) => `<div class="channel-card">
        <div class="channel-head">
          <strong>${esc(card.title)}</strong>
          ${card.enabled
            ? '<span class="pill ok"><span class="dot"></span>فعال</span>'
            : '<span class="pill muted"><span class="dot"></span>غیرفعال</span>'}
        </div>
        <div class="channel-detail">${card.details.map((line) => esc(line)).join('<br>')}</div>
      </div>`,
    )
    .join('');
}

function fillSettingsForm(settings) {
  const form = els.settingsForm.elements;
  form.globalSslIntervalSeconds.value = settings.globalSslIntervalSeconds;
  form.defaultUptimeIntervalSeconds.value = settings.defaultUptimeIntervalSeconds;
  form.defaultTimeoutSeconds.value = settings.defaultTimeoutSeconds;
  form.defaultFailureThreshold.value = settings.defaultFailureThreshold;
  form.defaultDegradedThresholdMs.value = settings.defaultDegradedThresholdMs;
  form.defaultAcceptedStatusCodes.value = settings.defaultAcceptedStatusCodes;
  form.historyRetentionDays.value = settings.historyRetentionDays;
  form.allowPrivateTargets.checked = settings.allowPrivateTargets;
}

async function loadSettings() {
  try {
    const data = await api('/api/admin/settings');
    state.settings = data.settings;
    state.channels = data.channels;
    fillSettingsForm(data.settings);
    renderChannels(data.channels);
  } catch (err) {
    if (err.status === 401) return;
    toast(err.message || 'دریافت تنظیمات ناموفق بود.', 'error');
  }
}

els.settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!els.settingsForm.reportValidity()) return;
  const form = els.settingsForm.elements;
  const payload = {
    globalSslIntervalSeconds: Number(form.globalSslIntervalSeconds.value),
    defaultUptimeIntervalSeconds: Number(form.defaultUptimeIntervalSeconds.value),
    defaultTimeoutSeconds: Number(form.defaultTimeoutSeconds.value),
    defaultFailureThreshold: Number(form.defaultFailureThreshold.value),
    defaultDegradedThresholdMs: Number(form.defaultDegradedThresholdMs.value),
    defaultAcceptedStatusCodes: form.defaultAcceptedStatusCodes.value.trim(),
    historyRetentionDays: Number(form.historyRetentionDays.value),
    allowPrivateTargets: form.allowPrivateTargets.checked,
  };
  const button = event.submitter || document.getElementById('settings-save');
  setBusy(button, true);
  els.settingsStatus.textContent = '';
  try {
    const data = await api('/api/admin/settings', { method: 'PATCH', body: payload });
    state.settings = data.settings;
    state.channels = data.channels;
    renderChannels(data.channels);
    els.settingsStatus.textContent = 'ذخیره شد.';
    toast('تنظیمات ذخیره شد.', 'success');
    setTimeout(() => { els.settingsStatus.textContent = ''; }, 3000);
    await loadTargets();
  } catch (err) {
    els.settingsStatus.textContent = err.message;
    toast(err.message || 'ذخیره تنظیمات ناموفق بود.', 'error');
  } finally {
    setBusy(button, false);
  }
});

els.passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!els.passwordForm.reportValidity()) return;
  const form = els.passwordForm.elements;
  const button = event.submitter;
  setBusy(button, true);
  els.passwordStatus.textContent = '';
  try {
    await api('/api/auth/password', {
      method: 'POST',
      body: {
        currentPassword: form.currentPassword.value,
        newPassword: form.newPassword.value,
      },
    });
    els.passwordForm.reset();
    els.passwordStatus.textContent = 'رمز عبور تغییر کرد.';
    toast('رمز عبور با موفقیت تغییر کرد.', 'success');
  } catch (err) {
    els.passwordStatus.textContent = err.message;
    toast(err.message || 'تغییر رمز ناموفق بود.', 'error');
  } finally {
    setBusy(button, false);
  }
});

/* ---------------- Init ---------------- */
initShell({
  page: 'admin',
  requireAdmin: true,
  onRefresh: async () => {
    await loadTargets();
    if (state.usersLoaded) await loadUsers();
  },
})
  .then(async () => {
    await loadSettings();
    await loadTargets();
    switchTab('targets');
  })
  .catch((err) => {
    showBox(els.targetError, err.message || 'بارگذاری صفحه مدیریت ناموفق بود.');
  });

import { api } from './common.js';

const form = document.getElementById('login-form');
const errorBox = document.getElementById('login-error');
const submitButton = document.getElementById('login-submit');
const passwordInput = document.getElementById('password');
const toggleButton = document.getElementById('toggle-password');

let preCsrfToken = null;

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function hideError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
}

async function refreshCsrf() {
  const data = await api('/api/auth/csrf');
  preCsrfToken = data.token;
}

refreshCsrf().catch(() => {
  showError('ارتباط با سرور برقرار نشد. صفحه را دوباره بارگذاری کنید.');
});

toggleButton?.addEventListener('click', () => {
  const visible = passwordInput.type === 'text';
  passwordInput.type = visible ? 'password' : 'text';
  toggleButton.setAttribute('aria-label', visible ? 'نمایش رمز عبور' : 'پنهان کردن رمز عبور');
  toggleButton.title = visible ? 'نمایش رمز عبور' : 'پنهان کردن رمز عبور';
  passwordInput.focus();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideError();

  const username = document.getElementById('username').value.trim();
  const password = passwordInput.value;
  if (!username || !password) {
    showError('نام کاربری و رمز عبور را وارد کنید.');
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'در حال ورود...';
  try {
    if (!preCsrfToken) await refreshCsrf();
    await api('/api/auth/login', {
      method: 'POST',
      csrf: preCsrfToken,
      body: { username, password },
    });

    const params = new URLSearchParams(location.search);
    const next = params.get('next');
    const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
    location.href = target;
  } catch (err) {
    showError(err.message || 'ورود ناموفق بود.');
    submitButton.disabled = false;
    submitButton.textContent = 'ورود';
    passwordInput.select();
    refreshCsrf().catch(() => {});
  }
});

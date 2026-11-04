import { config } from '../config.js';

const dateFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: config.timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const timeFormatter = new Intl.DateTimeFormat('fa-IR', {
  timeZone: config.timezone,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const gregorianFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-gregory', {
  timeZone: config.timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const gregorianFullFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-gregory', {
  timeZone: config.timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatJalali(iso, withTime = true) {
  if (!iso) return '—';
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return withTime ? `${dateFormatter.format(date)} ${timeFormatter.format(date)}` : dateFormatter.format(date);
}

export function formatGregorian(iso, withTime = true) {
  if (!iso) return '—';
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return withTime ? gregorianFullFormatter.format(date) : gregorianFormatter.format(date);
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} ثانیه`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} دقیقه`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ساعت و ${minutes % 60} دقیقه`;
  const days = Math.floor(hours / 24);
  return `${days} روز و ${hours % 24} ساعت`;
}

export function nowIso() {
  return new Date().toISOString();
}

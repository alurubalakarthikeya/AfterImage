import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind-aware className joiner used by every component. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 1.4 MB — never more than one decimal, never "1.44 MB". */
export function formatBytes(bytes: number, precision = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const digits = exponent === 0 ? 0 : value >= 100 ? 0 : precision;
  return `${value.toFixed(digits)} ${UNITS[exponent]}`;
}

/** "1.4 GB" for storage widgets where decimals are noise. */
export function formatStorage(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 100) return `${Math.round(gb)} GB`;
  if (gb >= 1) return `${gb.toFixed(gb < 10 ? 1 : 0)} GB`;
  return formatBytes(bytes, 0);
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  return `${Math.floor(days / 365)} year${Math.floor(days / 365) === 1 ? '' : 's'} ago`;
}

/** "19 Sep 2026, 09:34 AM" — the dense, unambiguous metadata format. */
export function formatAbsolute(iso: string): string {
  const date = new Date(iso);
  const day = date.getDate();
  const month = date.toLocaleString('en-US', { month: 'short' });
  const year = date.getFullYear();
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${day} ${month} ${year}, ${String(hour12).padStart(2, '0')}:${minutes} ${suffix}`;
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const suffix = hours >= 12 ? 'PM' : 'AM';
  return `${String(hours % 12 === 0 ? 12 : hours % 12).padStart(2, '0')}:${minutes} ${suffix}`;
}

export function formatDayLabel(iso: string, now: number = Date.now()): string {
  const date = new Date(iso);
  const today = new Date(now);
  const isSameDay = date.toDateString() === today.toDateString();
  if (isSameDay) return 'Today';
  const yesterday = new Date(now - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Structured pieces for the hero's oversized date lockup. */
export function dateParts(now: Date = new Date()) {
  return {
    month: now.toLocaleString('en-US', { month: 'short' }).toUpperCase(),
    day: String(now.getDate()),
    weekday: now.toLocaleString('en-US', { weekday: 'long' }),
    year: String(now.getFullYear()),
  };
}

export function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function formatResolution(width?: number, height?: number): string | null {
  if (!width || !height) return null;
  return `${formatCount(width)} × ${formatCount(height)}`;
}

/** Splits a filename so the extension can be dimmed while the stem stays strong. */
export function splitExtension(name: string): { stem: string; ext: string } {
  const match = /^(.*?)(\.[a-z0-9]{1,8})$/i.exec(name);
  if (!match) return { stem: name, ext: '' };
  return { stem: match[1], ext: match[2] };
}

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

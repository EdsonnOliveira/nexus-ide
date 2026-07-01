import type { CSSProperties } from 'react';
import type { CalendarEventItem } from '@/types';
import { stripTrailingUrlChars } from '@/utils/terminalUrlExtract';

export const CALENDAR_EVENT_HIDE_AFTER_MS = 2 * 60 * 60 * 1000;

export const CALENDAR_URGENT_BEFORE_MS = 5 * 60 * 1000;
export const CALENDAR_URGENT_AFTER_MS = 10 * 60 * 1000;
export const CALENDAR_ALERT_1H_MS = 60 * 60 * 1000;
export const CALENDAR_ALERT_30M_MS = 30 * 60 * 1000;
export const CALENDAR_ALERT_15M_MS = 15 * 60 * 1000;

export function getCalendarEventKey(event: Pick<CalendarEventItem, 'id' | 'startAt'>): string {
  return `${event.id}-${event.startAt}`;
}

export function isCalendarEventInUrgentWindow(event: CalendarEventItem, now: number): boolean {
  if (event.allDay) {
    return false;
  }

  const msUntilStart = event.startAt - now;
  const msSinceStart = now - event.startAt;

  return msUntilStart <= CALENDAR_URGENT_BEFORE_MS && msSinceStart <= CALENDAR_URGENT_AFTER_MS;
}

export type CalendarTextSegment =
  | { kind: 'text'; value: string }
  | { kind: 'link'; value: string; label: string };

const CALENDAR_TEXT_URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

export function isCalendarEventStillVisible(event: CalendarEventItem, now: number): boolean {
  if (!Number.isFinite(event.endAt) || event.endAt <= 0) {
    return true;
  }

  return now <= event.endAt + CALENDAR_EVENT_HIDE_AFTER_MS;
}

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim().replace('#', '');

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

export function buildCalendarEventStyle(colorHex: string): CSSProperties {
  const rgb = parseHexColor(colorHex) ?? { r: 255, g: 204, b: 0 };
  const background = `rgb(${Math.round(rgb.r * 0.18)}, ${Math.round(rgb.g * 0.18)}, ${Math.round(rgb.b * 0.12)})`;
  const stripe = `rgba(0, 0, 0, 0.22)`;
  const title = `rgb(${Math.min(255, Math.round(rgb.r * 0.95 + 20))}, ${Math.min(255, Math.round(rgb.g * 0.95 + 20))}, ${Math.min(255, Math.round(rgb.b * 0.85))})`;
  const muted = `rgb(${Math.round(rgb.r * 0.55 + 40)}, ${Math.round(rgb.g * 0.55 + 35)}, ${Math.round(rgb.b * 0.4 + 20)})`;

  return {
    '--sidebar-calendar-accent': colorHex,
    '--sidebar-calendar-bg': background,
    '--sidebar-calendar-stripe': stripe,
    '--sidebar-calendar-title': title,
    '--sidebar-calendar-muted': muted,
  } as CSSProperties;
}

export function formatCalendarEventTime(timestamp: number, allDay: boolean): string {
  if (allDay) {
    return 'Dia inteiro';
  }

  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '';
  }

  return new Date(timestamp).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatCalendarEventDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '';
  }

  return new Date(timestamp).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });
}

export function formatCalendarEventSchedule(event: CalendarEventItem): string {
  if (event.allDay) {
    return 'Dia inteiro';
  }

  const startLabel = formatCalendarEventTime(event.startAt, false);
  const endLabel = formatCalendarEventTime(event.endAt, false);

  if (!startLabel || !endLabel) {
    return startLabel || endLabel;
  }

  return `${startLabel} – ${endLabel}`;
}

export function resolveCalendarExternalUrl(raw: string): string | null {
  const trimmed = raw.trim();

  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return stripTrailingUrlChars(trimmed);
  }

  let decoded = trimmed;

  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    decoded = trimmed;
  }

  const match = decoded.match(CALENDAR_TEXT_URL_REGEX);

  if (!match?.[0]) {
    return null;
  }

  return stripTrailingUrlChars(match[0]);
}

export function normalizeCalendarEventNotes(text: string): string {
  let normalized = text.replace(/\r\n?/g, '\n');
  normalized = normalized.replace(/<(https?:\/\/[^>\s]+)>/gi, '$1');
  normalized = normalized.replace(/>\s*\|\s*/g, '\n');
  normalized = normalized.replace(/[ \t]+\n/g, '\n');
  normalized = normalized.replace(/\n{3,}/g, '\n\n');

  return normalized.trim();
}

export function splitCalendarTextLinks(text: string): CalendarTextSegment[] {
  const regex = new RegExp(CALENDAR_TEXT_URL_REGEX.source, CALENDAR_TEXT_URL_REGEX.flags);
  const segments: CalendarTextSegment[] = [];
  let lastIndex = 0;
  let match = regex.exec(text);

  while (match) {
    const start = match.index;

    if (start > lastIndex) {
      segments.push({ kind: 'text', value: text.slice(lastIndex, start) });
    }

    const label = match[0];
    const url = stripTrailingUrlChars(label);
    segments.push({ kind: 'link', value: url, label });
    lastIndex = start + label.length;
    match = regex.exec(text);
  }

  if (lastIndex < text.length) {
    segments.push({ kind: 'text', value: text.slice(lastIndex) });
  }

  if (segments.length === 0) {
    return [{ kind: 'text', value: text }];
  }

  return segments;
}

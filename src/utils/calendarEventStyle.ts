import type { CSSProperties } from 'react';
import type { CalendarEventItem } from '@/types';
import { stripTrailingUrlChars } from '@/utils/terminalUrlExtract';

export const CALENDAR_EVENT_HIDE_AFTER_MS = 30 * 60 * 1000;

export const CALENDAR_URGENT_BEFORE_MS = 5 * 60 * 1000;
export const CALENDAR_URGENT_AFTER_MS = 10 * 60 * 1000;
export const CALENDAR_ALERT_1H_MS = 60 * 60 * 1000;
export const CALENDAR_ALERT_30M_MS = 30 * 60 * 1000;
export const CALENDAR_ALERT_15M_MS = 15 * 60 * 1000;
export const MAX_VISIBLE_CALENDAR_EVENTS = 3;

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

function resolveCalendarEventEndAt(event: Pick<CalendarEventItem, 'startAt' | 'endAt'>): number {
  if (Number.isFinite(event.endAt) && event.endAt > event.startAt) {
    return event.endAt;
  }

  return event.startAt + 30 * 60_000;
}

export function isCalendarEventLive(event: CalendarEventItem, now: number): boolean {
  if (event.allDay) {
    return false;
  }

  if (!Number.isFinite(event.startAt) || event.startAt <= 0) {
    return false;
  }

  const endAt = resolveCalendarEventEndAt(event);

  return now >= event.startAt && now < endAt;
}

export function shouldShowCalendarEventLivePing(event: CalendarEventItem, now: number): boolean {
  if (isCalendarEventLive(event, now)) {
    return true;
  }

  if (event.allDay || !Number.isFinite(event.startAt)) {
    return false;
  }

  const msUntilStart = event.startAt - now;

  return msUntilStart > 0 && msUntilStart <= CALENDAR_URGENT_BEFORE_MS;
}

export function formatCalendarEventStartsInLabel(event: CalendarEventItem, now: number): string | null {
  if (event.allDay || !Number.isFinite(event.startAt)) {
    return null;
  }

  const msUntilStart = event.startAt - now;

  if (msUntilStart <= 0) {
    return null;
  }

  if (msUntilStart <= 60_000) {
    return 'Em instantes...';
  }

  const minutes = Math.ceil(msUntilStart / 60_000);

  if (minutes < 60) {
    return minutes === 1 ? 'Em 1 minuto...' : `Em ${minutes} minutos...`;
  }

  const hours = Math.ceil(msUntilStart / 3_600_000);

  if (hours < 24) {
    return hours === 1 ? 'Em 1 hora...' : `Em ${hours} horas...`;
  }

  const days = Math.ceil(msUntilStart / 86_400_000);

  return days === 1 ? 'Em 1 dia...' : `Em ${days} dias...`;
}

export type CalendarTextSegment =
  | { kind: 'text'; value: string }
  | { kind: 'link'; value: string; label: string };

const CALENDAR_TEXT_URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

export function isCalendarEventStillVisible(event: CalendarEventItem, now: number): boolean {
  if (!Number.isFinite(event.startAt) || event.startAt <= 0) {
    return true;
  }

  return now <= event.startAt + CALENDAR_EVENT_HIDE_AFTER_MS;
}

function dedupeCalendarEvents(events: CalendarEventItem[]): CalendarEventItem[] {
  const seen = new Set<string>();
  const result: CalendarEventItem[] = [];

  for (const event of events) {
    const key = `${event.title.trim().toLowerCase()}|${event.startAt}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(event);
  }

  return result;
}

export function getVisibleCalendarEvents(events: CalendarEventItem[], now: number): CalendarEventItem[] {
  return dedupeCalendarEvents(events)
    .filter((event) => isCalendarEventStillVisible(event, now))
    .sort((left, right) => left.startAt - right.startAt)
    .slice(0, MAX_VISIBLE_CALENDAR_EVENTS);
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

export type CalendarMeetingProvider = 'teams' | 'meet' | 'zoom' | 'webex' | 'generic';

export interface CalendarMeetingInfo {
  provider: CalendarMeetingProvider;
  url: string | null;
}

const CALENDAR_MEETING_PROVIDER_ORDER: CalendarMeetingProvider[] = ['teams', 'meet', 'zoom', 'webex'];

function classifyCalendarMeetingUrl(url: string): CalendarMeetingProvider | null {
  const lower = url.toLowerCase();

  if (
    lower.includes('teams.microsoft.com') ||
    lower.includes('teams.live.com') ||
    lower.includes('aka.ms/jointeam')
  ) {
    return 'teams';
  }

  if (lower.includes('meet.google.com')) {
    return 'meet';
  }

  if (lower.includes('zoom.us') || lower.includes('zoom.com')) {
    return 'zoom';
  }

  if (lower.includes('webex.com')) {
    return 'webex';
  }

  return null;
}

function classifyCalendarMeetingText(text: string): CalendarMeetingProvider | null {
  const lower = text.toLowerCase();

  if (lower.includes('microsoft teams') || lower.includes('reuniões do microsoft teams') || lower.includes('teams meeting')) {
    return 'teams';
  }

  if (lower.includes('google meet')) {
    return 'meet';
  }

  if (lower.includes('zoom meeting') || /\bzoom\b/.test(lower)) {
    return 'zoom';
  }

  if (lower.includes('webex') || lower.includes('cisco webex')) {
    return 'webex';
  }

  return null;
}

function extractCalendarTextUrls(text: string): string[] {
  const variants = [
    text,
    normalizeCalendarEventNotes(text),
    text.replace(/\r\n?/g, '\n').replace(/(?<=[/%\w.:=?&-])\n(?=[/%\w.:=?&-])/g, ''),
    text.replace(/\s+/g, ''),
  ];
  const found = new Set<string>();

  for (const variant of variants) {
    const regex = new RegExp(CALENDAR_TEXT_URL_REGEX.source, CALENDAR_TEXT_URL_REGEX.flags);
    let match = regex.exec(variant);

    while (match) {
      const resolved = resolveCalendarExternalUrl(match[0]);

      if (resolved) {
        found.add(resolved);
      }

      match = regex.exec(variant);
    }
  }

  return [...found];
}

export function resolveCalendarMeetingInfo(
  event: Pick<CalendarEventItem, 'url' | 'location' | 'notes'>,
): CalendarMeetingInfo | null {
  const sources = [event.url, event.location, event.notes].filter((value) => value.trim().length > 0);
  const meetingUrls: Partial<Record<CalendarMeetingProvider, string>> = {};
  let fallbackUrl: string | null = null;

  for (const source of sources) {
    const urls = extractCalendarTextUrls(source);

    for (const url of urls) {
      const provider = classifyCalendarMeetingUrl(url);

      if (provider && !meetingUrls[provider]) {
        meetingUrls[provider] = url;
        continue;
      }

      if (!fallbackUrl) {
        fallbackUrl = url;
      }
    }
  }

  for (const provider of CALENDAR_MEETING_PROVIDER_ORDER) {
    const url = meetingUrls[provider];

    if (url) {
      return { provider, url };
    }
  }

  const textProvider = classifyCalendarMeetingText(`${event.location}\n${event.notes}`);

  if (textProvider) {
    return {
      provider: textProvider,
      url: meetingUrls[textProvider] ?? fallbackUrl,
    };
  }

  if (fallbackUrl) {
    return { provider: 'generic', url: fallbackUrl };
  }

  return null;
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

export function formatCalendarLinkDisplayLabel(url: string): string {
  const provider = classifyCalendarMeetingUrl(url);

  if (provider === 'teams') {
    return 'Abrir link do Microsoft Teams';
  }

  if (provider === 'meet') {
    return 'Abrir link do Google Meet';
  }

  if (provider === 'zoom') {
    return 'Abrir link do Zoom';
  }

  if (provider === 'webex') {
    return 'Abrir link do Webex';
  }

  if (url.length <= 72) {
    return url;
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');

    return `Abrir ${host}`;
  } catch {
    return `${url.slice(0, 56)}…`;
  }
}

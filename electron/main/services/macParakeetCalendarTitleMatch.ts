import type { CalendarEventItem, MacParakeetTranscriptionItem } from '../../types';
import { getCalendarEventsSnapshot } from './appleCalendar';
import {
  getMacParakeetTitleOverride,
  setMacParakeetTitleOverride,
} from './macParakeetTitleStore';

const CALENDAR_CACHE_TTL_MS = 45_000;
const CALENDAR_LOOKUP_TIMEOUT_MS = 4_000;
const MIN_OVERLAP_MS = 60_000;
const GENERIC_TRANSCRIPTION_TITLES = new Set(['sessão', 'sessao', 'session']);

interface ParakeetAiCallSessionTiming {
  id: string;
  activatedAt?: string | null;
  createdAt: string;
  planSessionEndedAt?: string | null;
  lastPingedAt?: string | null;
}

interface CalendarEventsCacheEntry {
  expiresAt: number;
  events: CalendarEventItem[];
}

let calendarEventsCache: CalendarEventsCacheEntry | null = null;

function parseCreatedAtMs(value: string | undefined | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveSessionDurationMs(session: ParakeetAiCallSessionTiming): number | null {
  const startMs = parseCreatedAtMs(session.activatedAt ?? session.createdAt);
  const endMs = parseCreatedAtMs(session.planSessionEndedAt ?? session.lastPingedAt ?? undefined);

  if (!startMs || !endMs || endMs <= startMs) {
    return null;
  }

  return endMs - startMs;
}

export function isGenericTranscriptionTitle(title: string): boolean {
  return GENERIC_TRANSCRIPTION_TITLES.has(title.trim().toLowerCase());
}

function resolveTranscriptionWindow(
  session: ParakeetAiCallSessionTiming,
  isLive: boolean,
): { startMs: number; endMs: number } | null {
  const startMs = parseCreatedAtMs(session.activatedAt ?? session.createdAt);
  if (!startMs) {
    return null;
  }

  const durationMs = resolveSessionDurationMs(session);
  const endMs = durationMs ? startMs + durationMs : isLive ? Date.now() : startMs + 3 * 60_000;

  if (endMs <= startMs) {
    return null;
  }

  return { startMs, endMs };
}

function computeOverlapMs(
  leftStartMs: number,
  leftEndMs: number,
  rightStartMs: number,
  rightEndMs: number,
): number {
  const overlapStart = Math.max(leftStartMs, rightStartMs);
  const overlapEnd = Math.min(leftEndMs, rightEndMs);
  return Math.max(0, overlapEnd - overlapStart);
}

export function findBestCalendarEventMatch(
  session: ParakeetAiCallSessionTiming,
  isLive: boolean,
  events: CalendarEventItem[],
): CalendarEventItem | null {
  const window = resolveTranscriptionWindow(session, isLive);
  if (!window) {
    return null;
  }

  let bestEvent: CalendarEventItem | null = null;
  let bestOverlapMs = 0;

  for (const event of events) {
    if (event.allDay) {
      continue;
    }

    const overlapMs = computeOverlapMs(
      window.startMs,
      window.endMs,
      event.startAt,
      event.endAt,
    );

    if (overlapMs <= 0) {
      continue;
    }

    const startsInsideEvent =
      window.startMs >= event.startAt && window.startMs <= event.endAt;

    if (!startsInsideEvent && overlapMs < MIN_OVERLAP_MS) {
      continue;
    }

    if (overlapMs > bestOverlapMs) {
      bestOverlapMs = overlapMs;
      bestEvent = event;
    }
  }

  return bestEvent;
}

async function getCachedTimedCalendarEvents(): Promise<CalendarEventItem[]> {
  const nowMs = Date.now();
  const cached = calendarEventsCache;

  if (cached && cached.expiresAt > nowMs) {
    return cached.events;
  }

  let events: CalendarEventItem[] = [];

  try {
    const snapshot = await Promise.race([
      getCalendarEventsSnapshot(),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), CALENDAR_LOOKUP_TIMEOUT_MS);
      }),
    ]);

    if (snapshot?.available) {
      events = snapshot.events.filter((event) => !event.allDay && event.title.trim().length > 0);
    }
  } catch {
    events = [];
  }

  calendarEventsCache = {
    expiresAt: nowMs + CALENDAR_CACHE_TTL_MS,
    events,
  };

  return events;
}

export function applyAutoCalendarTitleToTranscription<
  T extends MacParakeetTranscriptionItem,
>(
  session: ParakeetAiCallSessionTiming,
  item: T,
  events: CalendarEventItem[],
): T {
  if (getMacParakeetTitleOverride(item.id)) {
    return item;
  }

  if (!isGenericTranscriptionTitle(item.title)) {
    return item;
  }

  const match = findBestCalendarEventMatch(session, item.isLive, events);
  const eventTitle = match?.title.trim();

  if (!eventTitle) {
    return item;
  }

  const nextTitle = setMacParakeetTitleOverride(item.id, eventTitle);
  if (!nextTitle) {
    return item;
  }

  return {
    ...item,
    title: nextTitle,
  };
}

export async function applyAutoCalendarTitlesToTranscriptions<
  T extends MacParakeetTranscriptionItem,
>(
  sessions: ParakeetAiCallSessionTiming[],
  items: T[],
): Promise<T[]> {
  const timedEvents = await getCachedTimedCalendarEvents();
  if (timedEvents.length === 0) {
    return items;
  }

  const sessionById = new Map(sessions.map((session) => [session.id, session]));

  return items.map((item) => {
    const session = sessionById.get(item.id);
    if (!session) {
      return item;
    }

    return applyAutoCalendarTitleToTranscription(session, item, timedEvents);
  });
}

export async function refreshAutoCalendarTitlesForItems<
  T extends MacParakeetTranscriptionItem,
>(items: T[], sessions: ParakeetAiCallSessionTiming[]): Promise<T[]> {
  const needsMatch = items.some(
    (item) => !getMacParakeetTitleOverride(item.id) && isGenericTranscriptionTitle(item.title),
  );

  if (!needsMatch || sessions.length === 0) {
    return items;
  }

  return applyAutoCalendarTitlesToTranscriptions(sessions, items);
}

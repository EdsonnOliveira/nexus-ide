import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CalendarAccountItem,
  CalendarCreateEventInput,
  CalendarDeleteEventInput,
  CalendarFullEventItem,
  CalendarListItem,
  CalendarMutationResult,
  CalendarUpdateEventInput,
} from '@/types';

const ENABLED_STORAGE_KEY = 'nexus.home-calendar.enabled-ids';
const POLL_MS = 60_000;

function readEnabledIds(): string[] | null {
  try {
    const raw = window.localStorage.getItem(ENABLED_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    return parsed.filter((value): value is string => typeof value === 'string');
  } catch {
    return null;
  }
}

function writeEnabledIds(ids: string[]): void {
  try {
    window.localStorage.setItem(ENABLED_STORAGE_KEY, JSON.stringify(ids));
  } catch {
  }
}

export function useHomeCalendar(enabled: boolean) {
  const [accounts, setAccounts] = useState<CalendarAccountItem[]>([]);
  const [events, setEvents] = useState<CalendarFullEventItem[]>([]);
  const [accessGranted, setAccessGranted] = useState(false);
  const [platformSupported, setPlatformSupported] = useState(true);
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [enabledCalendarIds, setEnabledCalendarIds] = useState<Set<string>>(() => {
    const stored = readEnabledIds();
    return stored ? new Set(stored) : new Set();
  });
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const requestIdRef = useRef(0);
  const enabledInitializedRef = useRef(false);
  const rangeStartRef = useRef(0);
  const rangeEndRef = useRef(0);

  const calendars = useMemo(() => {
    const items: CalendarListItem[] = [];
    for (const account of accounts) {
      items.push(...account.calendars);
    }
    return items;
  }, [accounts]);

  useEffect(() => {
    if (!enabled || calendars.length === 0) {
      return;
    }

    const stored = readEnabledIds();
    const allIds = calendars.map((item) => item.id);
    const valid = new Set(allIds);

    if (stored === null || stored.length === 0) {
      setEnabledCalendarIds(new Set(allIds));
      writeEnabledIds(allIds);
      enabledInitializedRef.current = true;
      return;
    }

    const next = stored.filter((id) => valid.has(id));
    if (next.length === 0) {
      setEnabledCalendarIds(new Set(allIds));
      writeEnabledIds(allIds);
    } else if (!enabledInitializedRef.current) {
      setEnabledCalendarIds(new Set(next));
    }
    enabledInitializedRef.current = true;
  }, [calendars, enabled]);

  const refreshCalendars = useCallback(async () => {
    if (!enabled || !window.nexus?.calendar?.getCalendars) {
      setPlatformSupported(false);
      setAccessGranted(false);
      setAccounts([]);
      setHydrated(true);
      return;
    }

    const snapshot = await window.nexus.calendar.getCalendars();
    setPlatformSupported(snapshot.platformSupported);
    setAccessGranted(snapshot.accessGranted);
    setAccounts(snapshot.accounts);
  }, [enabled]);

  const refreshEvents = useCallback(
    async (startAt: number, endAt: number, background = false) => {
      if (!enabled || !window.nexus?.calendar?.getEventsInRange || startAt <= 0 || endAt <= startAt) {
        setEvents([]);
        setHydrated(true);
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      if (!background) {
        setLoading(true);
      }

      try {
        let snapshot = await window.nexus.calendar.getEventsInRange(startAt, endAt);
        if (
          requestIdRef.current === requestId &&
          rangeStartRef.current === startAt &&
          rangeEndRef.current === endAt &&
          Array.isArray(snapshot.events) &&
          snapshot.events.length === 0 &&
          snapshot.available === false
        ) {
          await new Promise((resolve) => {
            window.setTimeout(resolve, 400);
          });
          snapshot = await window.nexus.calendar.getEventsInRange(startAt, endAt);
        }

        if (rangeStartRef.current !== startAt || rangeEndRef.current !== endAt) {
          return;
        }
        if (snapshot.accessGranted) {
          setAccessGranted(true);
        }
        setPlatformSupported(snapshot.platformSupported);
        setEvents(Array.isArray(snapshot.events) ? snapshot.events : []);
      } catch {
        if (rangeStartRef.current === startAt && rangeEndRef.current === endAt) {
          setEvents([]);
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
          setHydrated(true);
        }
      }
    },
    [enabled],
  );

  const setVisibleRange = useCallback((startAt: number, endAt: number) => {
    rangeStartRef.current = startAt;
    rangeEndRef.current = endAt;
    setRangeStart(startAt);
    setRangeEnd(endAt);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setHydrated(false);
      return;
    }

    setHydrated(false);
    void refreshCalendars();
  }, [enabled, refreshCalendars]);

  useEffect(() => {
    if (!enabled || rangeStart <= 0 || rangeEnd <= rangeStart) {
      return;
    }

    void refreshEvents(rangeStart, rangeEnd, false);

    const intervalId = window.setInterval(() => {
      void refreshEvents(rangeStart, rangeEnd, true);
    }, POLL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, rangeEnd, rangeStart, refreshEvents]);

  const toggleCalendar = useCallback((calendarId: string, next: boolean) => {
    setEnabledCalendarIds((current) => {
      const nextSet = new Set(current);
      if (next) {
        nextSet.add(calendarId);
      } else {
        nextSet.delete(calendarId);
      }
      writeEnabledIds([...nextSet]);
      return nextSet;
    });
  }, []);

  const visibleEvents = useMemo(() => {
    if (enabledCalendarIds.size === 0) {
      return events;
    }
    return events.filter((event) => enabledCalendarIds.has(event.calendarId));
  }, [enabledCalendarIds, events]);

  const editableCalendars = useMemo(
    () => calendars.filter((item) => item.allowsEdit),
    [calendars],
  );

  const requestAccess = useCallback(async () => {
    if (!window.nexus?.calendar) {
      return;
    }
    await window.nexus.calendar.requestAccess();
    await refreshCalendars();
    if (rangeStart > 0 && rangeEnd > rangeStart) {
      await refreshEvents(rangeStart, rangeEnd, false);
    }
  }, [rangeEnd, rangeStart, refreshCalendars, refreshEvents]);

  const createEvent = useCallback(
    async (input: CalendarCreateEventInput): Promise<CalendarMutationResult> => {
      if (!window.nexus?.calendar?.createEvent) {
        return { ok: false, event: null, error: 'unavailable' };
      }
      const result = await window.nexus.calendar.createEvent(input);
      if (result.ok && rangeStart > 0) {
        await refreshEvents(rangeStart, rangeEnd, true);
      }
      return result;
    },
    [rangeEnd, rangeStart, refreshEvents],
  );

  const updateEvent = useCallback(
    async (input: CalendarUpdateEventInput): Promise<CalendarMutationResult> => {
      if (!window.nexus?.calendar?.updateEvent) {
        return { ok: false, event: null, error: 'unavailable' };
      }
      const result = await window.nexus.calendar.updateEvent(input);
      if (result.ok && rangeStart > 0) {
        await refreshEvents(rangeStart, rangeEnd, true);
      }
      return result;
    },
    [rangeEnd, rangeStart, refreshEvents],
  );

  const deleteEvent = useCallback(
    async (input: CalendarDeleteEventInput): Promise<CalendarMutationResult> => {
      if (!window.nexus?.calendar?.deleteEvent) {
        return { ok: false, event: null, error: 'unavailable' };
      }
      const result = await window.nexus.calendar.deleteEvent(input);
      if (result.ok && rangeStart > 0) {
        await refreshEvents(rangeStart, rangeEnd, true);
      }
      return result;
    },
    [rangeEnd, rangeStart, refreshEvents],
  );

  const openEvent = useCallback(async (startAt: number) => {
    if (!window.nexus?.calendar?.openEvent) {
      return;
    }
    await window.nexus.calendar.openEvent(startAt);
  }, []);

  return {
    accounts,
    calendars,
    editableCalendars,
    events: visibleEvents,
    allEvents: events,
    enabledCalendarIds,
    accessGranted,
    platformSupported,
    loading,
    hydrated,
    setVisibleRange,
    toggleCalendar,
    requestAccess,
    createEvent,
    updateEvent,
    deleteEvent,
    openEvent,
    refreshCalendars,
  };
}

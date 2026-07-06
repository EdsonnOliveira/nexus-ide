import { useEffect, useRef } from 'react';
import type { CalendarEventItem } from '@/types';
import { useCalendarEventNotificationStore } from '@/stores/useCalendarEventNotificationStore';
import {
  CALENDAR_ALERT_15M_MS,
  CALENDAR_ALERT_1H_MS,
  CALENDAR_ALERT_30M_MS,
  CALENDAR_URGENT_AFTER_MS,
  getCalendarEventKey,
  isCalendarEventInUrgentWindow,
} from '@/utils/calendarEventStyle';
import { playCalendarEventAlertSound } from '@/utils/calendarEventNotificationSound';

const TICK_MS = 1_000;

const ALERT_1H_SOUND_MS = 1_000;
const ALERT_1H_PING_MS = 1_500;
const ALERT_30M_SOUND_MS = 1_000;
const ALERT_30M_PING_MS = 1_500;
const ALERT_15M_SOUND_MS = 5_000;
const ALERT_15M_PING_MS = 6_500;
const ALERT_START_SOUND_MS = 5_000;
const ALERT_START_PING_MS = 6_500;

function pickUrgentEvent(events: CalendarEventItem[], now: number): CalendarEventItem | null {
  let closest: CalendarEventItem | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const event of events) {
    if (!isCalendarEventInUrgentWindow(event, now)) {
      continue;
    }

    const distance = Math.abs(event.startAt - now);

    if (distance < closestDistance) {
      closest = event;
      closestDistance = distance;
    }
  }

  return closest;
}

function triggerTimedAlert(
  eventKey: string,
  soundDurationMs: number,
  pingDurationMs: number,
  triggerTemporaryPing: (key: string, durationMs: number) => void,
): void {
  playCalendarEventAlertSound(soundDurationMs);
  triggerTemporaryPing(eventKey, pingDurationMs);
}

export function useCalendarEventNotifications(events: CalendarEventItem[], enabled: boolean): void {
  const eventsRef = useRef(events);
  const previousMsUntilStartRef = useRef<Record<string, number>>({});
  const initializedRef = useRef(false);

  eventsRef.current = events;

  useEffect(() => {
    if (!enabled) {
      previousMsUntilStartRef.current = {};
      initializedRef.current = false;
      useCalendarEventNotificationStore.getState().clearUrgentEvent();
      return;
    }

    const tick = () => {
      const now = Date.now();
      const store = useCalendarEventNotificationStore.getState();
      const timedEvents = eventsRef.current.filter((event) => !event.allDay);
      const nextPrevious: Record<string, number> = {};

      for (const event of timedEvents) {
        const eventKey = getCalendarEventKey(event);
        const msUntilStart = event.startAt - now;
        nextPrevious[eventKey] = msUntilStart;

        if (!initializedRef.current) {
          continue;
        }

        const previousMsUntilStart = previousMsUntilStartRef.current[eventKey];

        if (previousMsUntilStart === undefined) {
          continue;
        }

        if (previousMsUntilStart > CALENDAR_ALERT_1H_MS && msUntilStart <= CALENDAR_ALERT_1H_MS) {
          triggerTimedAlert(eventKey, ALERT_1H_SOUND_MS, ALERT_1H_PING_MS, store.triggerTemporaryPing);
        }

        if (previousMsUntilStart > CALENDAR_ALERT_30M_MS && msUntilStart <= CALENDAR_ALERT_30M_MS) {
          triggerTimedAlert(eventKey, ALERT_30M_SOUND_MS, ALERT_30M_PING_MS, store.triggerTemporaryPing);
        }

        if (previousMsUntilStart > CALENDAR_ALERT_15M_MS && msUntilStart <= CALENDAR_ALERT_15M_MS) {
          triggerTimedAlert(eventKey, ALERT_15M_SOUND_MS, ALERT_15M_PING_MS, store.triggerTemporaryPing);
        }

        if (previousMsUntilStart > 0 && msUntilStart <= 0) {
          triggerTimedAlert(eventKey, ALERT_START_SOUND_MS, ALERT_START_PING_MS, store.triggerTemporaryPing);
          store.activateUrgentEvent(event);
        }
      }

      const urgentCandidate = pickUrgentEvent(timedEvents, now);

      if (urgentCandidate) {
        store.activateUrgentEvent(urgentCandidate);
      } else if (store.urgentEvent) {
        const msSinceStart = now - store.urgentEvent.startAt;

        if (msSinceStart > CALENDAR_URGENT_AFTER_MS) {
          store.clearUrgentEvent();
        }
      }

      previousMsUntilStartRef.current = nextPrevious;
      initializedRef.current = true;
    };

    tick();

    const intervalId = window.setInterval(tick, TICK_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled]);
}

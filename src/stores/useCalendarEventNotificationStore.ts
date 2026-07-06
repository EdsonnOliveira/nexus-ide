import { create } from 'zustand';
import type { CalendarEventItem } from '@/types';
import {
  startCalendarEventUrgentSoundLoop,
  stopCalendarEventAlertSound,
  stopCalendarEventUrgentSoundLoop,
} from '@/utils/calendarEventNotificationSound';
import { getCalendarEventKey } from '@/utils/calendarEventStyle';

interface CalendarEventNotificationState {
  pingUntilByEventKey: Record<string, number>;
  urgentEvent: CalendarEventItem | null;
  dismissedUrgentKeys: Record<string, number>;
  triggerTemporaryPing: (eventKey: string, durationMs: number) => void;
  activateUrgentEvent: (event: CalendarEventItem) => void;
  dismissUrgentEvent: (event: CalendarEventItem) => void;
  clearUrgentEvent: () => void;
  isEventPinging: (eventKey: string, now: number) => boolean;
}

export const useCalendarEventNotificationStore = create<CalendarEventNotificationState>((set, get) => ({
  pingUntilByEventKey: {},
  urgentEvent: null,
  dismissedUrgentKeys: {},

  triggerTemporaryPing: (eventKey, durationMs) => {
    set((state) => ({
      pingUntilByEventKey: {
        ...state.pingUntilByEventKey,
        [eventKey]: Date.now() + durationMs,
      },
    }));
  },

  activateUrgentEvent: (event) => {
    const eventKey = getCalendarEventKey(event);
    const state = get();
    const dismissedAt = state.dismissedUrgentKeys[eventKey];

    if (dismissedAt) {
      const now = Date.now();
      const dismissedBeforeStart = dismissedAt < event.startAt;
      const eventHasStarted = now >= event.startAt;

      if (!(dismissedBeforeStart && eventHasStarted)) {
        return;
      }

      set((currentState) => {
        const nextDismissed = { ...currentState.dismissedUrgentKeys };
        delete nextDismissed[eventKey];
        return { dismissedUrgentKeys: nextDismissed };
      });
    }

    if (state.urgentEvent?.id === event.id && state.urgentEvent.startAt === event.startAt) {
      return;
    }

    stopCalendarEventAlertSound();
    startCalendarEventUrgentSoundLoop();

    set({ urgentEvent: event });
  },

  dismissUrgentEvent: (event) => {
    const eventKey = getCalendarEventKey(event);

    stopCalendarEventUrgentSoundLoop();

    set((state) => ({
      urgentEvent: null,
      dismissedUrgentKeys: {
        ...state.dismissedUrgentKeys,
        [eventKey]: Date.now(),
      },
      pingUntilByEventKey: {
        ...state.pingUntilByEventKey,
        [eventKey]: 0,
      },
    }));
  },

  clearUrgentEvent: () => {
    stopCalendarEventUrgentSoundLoop();
    set({ urgentEvent: null });
  },

  isEventPinging: (eventKey, now) => {
    const state = get();
    const pingUntil = state.pingUntilByEventKey[eventKey] ?? 0;

    if (pingUntil > now) {
      return true;
    }

    if (!state.urgentEvent) {
      return false;
    }

    if (getCalendarEventKey(state.urgentEvent) !== eventKey) {
      return false;
    }

    const dismissedAt = state.dismissedUrgentKeys[eventKey];

    if (!dismissedAt) {
      return true;
    }

    return dismissedAt < state.urgentEvent.startAt && now >= state.urgentEvent.startAt;
  },
}));

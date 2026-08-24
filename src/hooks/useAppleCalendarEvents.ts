import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { CalendarEventsSnapshot } from '@/types';

const POLL_INTERVAL_MS = 60_000;

const EMPTY_SNAPSHOT: CalendarEventsSnapshot = {
  platformSupported: true,
  accessGranted: false,
  available: false,
  permissionDenied: false,
  events: [],
};

interface AppleCalendarEventsState {
  snapshot: CalendarEventsSnapshot;
  loading: boolean;
  hydrated: boolean;
}

const DISABLED_STATE: AppleCalendarEventsState = {
  snapshot: EMPTY_SNAPSHOT,
  loading: false,
  hydrated: true,
};

let sharedState: AppleCalendarEventsState = {
  snapshot: EMPTY_SNAPSHOT,
  loading: false,
  hydrated: false,
};

const listeners = new Set<() => void>();
let subscriberCount = 0;
let intervalId: number | null = null;
let requestId = 0;
let inFlight: Promise<void> | null = null;

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function sameSnapshot(left: CalendarEventsSnapshot, right: CalendarEventsSnapshot): boolean {
  if (left === right) {
    return true;
  }

  if (
    left.platformSupported !== right.platformSupported ||
    left.accessGranted !== right.accessGranted ||
    left.available !== right.available ||
    left.permissionDenied !== right.permissionDenied ||
    left.events.length !== right.events.length
  ) {
    return false;
  }

  return left.events.every((event, index) => {
    const other = right.events[index];
    return (
      event.id === other.id &&
      event.startAt === other.startAt &&
      event.endAt === other.endAt &&
      event.title === other.title &&
      event.calendarName === other.calendarName
    );
  });
}

function setSharedState(patch: Partial<AppleCalendarEventsState>): void {
  const nextSnapshot = patch.snapshot ?? sharedState.snapshot;
  const next: AppleCalendarEventsState = {
    snapshot: sameSnapshot(sharedState.snapshot, nextSnapshot) ? sharedState.snapshot : nextSnapshot,
    loading: patch.loading ?? sharedState.loading,
    hydrated: patch.hydrated ?? sharedState.hydrated,
  };

  if (
    next.snapshot === sharedState.snapshot &&
    next.loading === sharedState.loading &&
    next.hydrated === sharedState.hydrated
  ) {
    return;
  }

  sharedState = next;
  emit();
}

async function refreshShared(background: boolean): Promise<void> {
  if (!window.nexus?.calendar) {
    setSharedState({
      snapshot: EMPTY_SNAPSHOT,
      loading: false,
      hydrated: true,
    });
    return;
  }

  const nextRequestId = requestId + 1;
  requestId = nextRequestId;

  if (!background) {
    setSharedState({ loading: true });
  }

  try {
    const nextSnapshot = await window.nexus.calendar.getTodayEvents();
    if (requestId !== nextRequestId) {
      return;
    }
    setSharedState({
      snapshot: nextSnapshot,
      loading: false,
      hydrated: true,
    });
  } catch {
    if (requestId !== nextRequestId) {
      return;
    }
    setSharedState({
      loading: false,
      hydrated: true,
    });
  }
}

function startSharedPolling(): void {
  if (intervalId !== null) {
    return;
  }

  inFlight = refreshShared(false).finally(() => {
    inFlight = null;
  });

  intervalId = window.setInterval(() => {
    if (inFlight) {
      return;
    }

    inFlight = refreshShared(true).finally(() => {
      inFlight = null;
    });
  }, POLL_INTERVAL_MS);
}

function stopSharedPolling(): void {
  if (intervalId !== null) {
    window.clearInterval(intervalId);
    intervalId = null;
  }
}

function subscribeShared(listener: () => void): () => void {
  listeners.add(listener);
  subscriberCount += 1;

  if (subscriberCount === 1) {
    startSharedPolling();
  }

  return () => {
    listeners.delete(listener);
    subscriberCount = Math.max(0, subscriberCount - 1);
    if (subscriberCount === 0) {
      stopSharedPolling();
    }
  };
}

function subscribeDisabled(): () => void {
  return () => undefined;
}

function getSharedSnapshot(): AppleCalendarEventsState {
  return sharedState;
}

function getDisabledSnapshot(): AppleCalendarEventsState {
  return DISABLED_STATE;
}

export async function openAppleCalendarEvent(startAt: number): Promise<void> {
  if (!window.nexus?.calendar) {
    return;
  }

  await window.nexus.calendar.openEvent(startAt);
}

export function useAppleCalendarEvents(enabled: boolean) {
  const state = useSyncExternalStore(
    enabled ? subscribeShared : subscribeDisabled,
    enabled ? getSharedSnapshot : getDisabledSnapshot,
    getDisabledSnapshot,
  );

  const refresh = useCallback(async (background = false) => {
    await refreshShared(background);
    return sharedState.snapshot;
  }, []);

  const openEvent = useCallback(async (startAt: number) => {
    await openAppleCalendarEvent(startAt);
  }, []);

  return useMemo(
    () => ({
      snapshot: state.snapshot,
      loading: state.loading,
      hydrated: state.hydrated,
      refresh,
      openEvent,
    }),
    [openEvent, refresh, state.hydrated, state.loading, state.snapshot],
  );
}

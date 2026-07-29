import { useCallback, useEffect, useRef } from 'react';

export interface WebNavHistoryState {
  projectId: string | null;
  agentId: string | null;
  emulator: boolean;
}

const NEXUS_NAV_KEY = '__nexusWebNav';
const EDGE_ZONE_PX = 28;
const SWIPE_THRESHOLD_PX = 72;

type StoredNavState = WebNavHistoryState & { [NEXUS_NAV_KEY]: true; depth: number };

function navDepth(state: WebNavHistoryState): number {
  return (
    (state.projectId ? 1 : 0) + (state.agentId ? 1 : 0) + (state.emulator ? 1 : 0)
  );
}

function createStoredState(state: WebNavHistoryState): StoredNavState {
  return {
    ...state,
    [NEXUS_NAV_KEY]: true,
    depth: navDepth(state),
  };
}

function isStoredNavState(value: unknown): value is StoredNavState {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)[NEXUS_NAV_KEY] === true
  );
}

function peelNavState(state: WebNavHistoryState): WebNavHistoryState {
  if (state.emulator) {
    return {
      projectId: state.projectId,
      agentId: state.agentId,
      emulator: false,
    };
  }
  if (state.agentId) {
    return {
      projectId: state.projectId,
      agentId: null,
      emulator: false,
    };
  }
  if (state.projectId) {
    return {
      projectId: null,
      agentId: null,
      emulator: false,
    };
  }
  return state;
}

function useEdgeSwipeBack(enabled: boolean, onBack: () => void): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let armed = false;

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        tracking = false;
        armed = false;
        return;
      }
      const touch = event.touches[0];
      if (!touch || touch.clientX > EDGE_ZONE_PX) {
        tracking = false;
        armed = false;
        return;
      }
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
      armed = true;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking || !armed) {
        return;
      }
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      const dx = touch.clientX - startX;
      const dy = Math.abs(touch.clientY - startY);
      if (dy > 48 && dy > Math.abs(dx)) {
        tracking = false;
        armed = false;
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!tracking || !armed) {
        tracking = false;
        armed = false;
        return;
      }
      tracking = false;
      armed = false;
      const touch = event.changedTouches[0];
      if (!touch) {
        return;
      }
      const dx = touch.clientX - startX;
      const dy = Math.abs(touch.clientY - startY);
      if (dx >= SWIPE_THRESHOLD_PX && dx > dy * 1.35) {
        onBackRef.current();
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [enabled]);
}

export function useWebNavHistory(options: {
  state: WebNavHistoryState;
  onPop: (next: WebNavHistoryState) => void;
}): { goBack: () => void; canGoBack: boolean } {
  const { state, onPop } = options;
  const stateRef = useRef(state);
  stateRef.current = state;
  const onPopRef = useRef(onPop);
  onPopRef.current = onPop;
  const depthRef = useRef(navDepth(state));
  const applyingPopRef = useRef(false);
  const seededRef = useRef(false);
  const backLockUntilRef = useRef(0);
  const canGoBack = navDepth(state) > 0;

  useEffect(() => {
    if (!seededRef.current) {
      window.history.replaceState(createStoredState(stateRef.current), '');
      depthRef.current = navDepth(stateRef.current);
      seededRef.current = true;
    }

    const onPopState = () => {
      applyingPopRef.current = true;
      backLockUntilRef.current = Date.now() + 450;
      const current = stateRef.current;
      if (navDepth(current) === 0) {
        window.history.pushState(createStoredState(current), '');
        queueMicrotask(() => {
          applyingPopRef.current = false;
        });
        return;
      }
      const next = peelNavState(current);
      depthRef.current = navDepth(next);
      onPopRef.current(next);
      queueMicrotask(() => {
        applyingPopRef.current = false;
      });
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!seededRef.current || applyingPopRef.current) {
      return;
    }

    const nextDepth = navDepth(state);
    const prevDepth = depthRef.current;

    if (nextDepth > prevDepth) {
      for (let depth = prevDepth + 1; depth <= nextDepth; depth += 1) {
        window.history.pushState(createStoredState(state), '');
      }
    } else if (nextDepth < prevDepth) {
      window.history.replaceState(createStoredState(state), '');
    } else if (!isStoredNavState(window.history.state)) {
      window.history.replaceState(createStoredState(state), '');
    } else {
      const stored = window.history.state;
      if (
        stored.projectId !== state.projectId ||
        stored.agentId !== state.agentId ||
        stored.emulator !== state.emulator
      ) {
        window.history.replaceState(createStoredState(state), '');
      }
    }

    depthRef.current = nextDepth;
  }, [state.projectId, state.agentId, state.emulator]);

  const goBack = useCallback(() => {
    if (navDepth(stateRef.current) === 0) {
      return;
    }
    if (Date.now() < backLockUntilRef.current) {
      return;
    }
    backLockUntilRef.current = Date.now() + 450;
    window.history.back();
  }, []);

  useEdgeSwipeBack(canGoBack, goBack);

  return { goBack, canGoBack };
}

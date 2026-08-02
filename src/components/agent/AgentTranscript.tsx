import { memo, useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import type { AgentQuestionAnswers, AgentTurn } from '@/types';
import { AgentTurnView } from '@/components/agent/AgentTurnView';
import { resolveActiveAgentTurnId } from '@/utils/agentPromptRail';

export interface AgentTranscriptScrollControl {
  scrollToBottom: (options?: { smooth?: boolean }) => void;
  scrollToTurn: (turnId: string, options?: { smooth?: boolean }) => void;
}

interface AgentTranscriptProps {
  turns: AgentTurn[];
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  scrollControlRef?: MutableRefObject<AgentTranscriptScrollControl | null>;
  scrollKey?: string;
  editingTurnId?: string | null;
  projectId: string;
  projectPath: string;
  paneId: string;
  disableStickyPrompt?: boolean;
  onAtBottomChange?: (atBottom: boolean) => void;
  onActiveTurnChange?: (turnId: string | null) => void;
  onEdit?: (turnId: string) => void;
  onRedo?: (turnId: string) => void;
  onSubmitQuestion?: (activityId: string, answers: AgentQuestionAnswers) => boolean | Promise<boolean>;
}

const SCROLL_BOTTOM_THRESHOLD_PX = 48;
const STICK_PIN_LOCK_MS = 360;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isScrollContainerAtBottom(container: HTMLElement): boolean {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight <=
    SCROLL_BOTTOM_THRESHOLD_PX
  );
}

function getScrollContainerTargetTop(container: HTMLElement): number {
  return Math.max(0, container.scrollHeight - container.clientHeight);
}

function scrollContainerToBottom(
  container: HTMLElement,
  options?: { smooth?: boolean; onComplete?: () => void },
): void {
  const targetTop = getScrollContainerTargetTop(container);
  const finish = options?.onComplete;

  if (!options?.smooth || prefersReducedMotion()) {
    container.scrollTop = targetTop;
    finish?.();
    return;
  }

  const startTop = container.scrollTop;
  const distance = targetTop - startTop;

  if (Math.abs(distance) < 1) {
    container.scrollTop = targetTop;
    finish?.();
    return;
  }

  const duration = Math.min(520, Math.max(260, Math.abs(distance) * 0.45));
  const startTime = performance.now();

  const step = (now: number) => {
    const progress = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    container.scrollTop = startTop + distance * eased;

    if (progress < 1) {
      window.requestAnimationFrame(step);
      return;
    }

    container.scrollTop = targetTop;
    finish?.();
  };

  window.requestAnimationFrame(step);
}

function scrollTranscriptToBottomInstant(
  container: HTMLElement,
  options?: {
    programmaticScrollRef?: MutableRefObject<boolean>;
    contentHeightRef?: MutableRefObject<number>;
    onAtBottom?: (atBottom: boolean) => void;
  },
): void {
  const targetTop = getScrollContainerTargetTop(container);

  if (options?.programmaticScrollRef) {
    options.programmaticScrollRef.current = true;
  }

  container.scrollTop = targetTop;

  if (options?.programmaticScrollRef) {
    options.programmaticScrollRef.current = false;
  }

  if (options?.contentHeightRef) {
    options.contentHeightRef.current = container.scrollHeight;
  }

  options?.onAtBottom?.(isScrollContainerAtBottom(container));
}

function AgentTranscriptComponent({
  turns,
  scrollContainerRef,
  scrollControlRef,
  scrollKey,
  editingTurnId,
  projectId,
  projectPath,
  paneId,
  disableStickyPrompt = false,
  onAtBottomChange,
  onActiveTurnChange,
  onEdit,
  onRedo,
  onSubmitQuestion,
}: AgentTranscriptProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const atBottomRef = useRef(true);
  const programmaticScrollRef = useRef(false);
  const stickPinLockUntilRef = useRef(0);
  const scrollRafRef = useRef<number | null>(null);
  const activeTurnRafRef = useRef<number | null>(null);
  const contentHeightRef = useRef(0);
  const turnElementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const activeTurnIdRef = useRef<string | null>(null);
  const onAtBottomChangeRef = useRef(onAtBottomChange);
  const onActiveTurnChangeRef = useRef(onActiveTurnChange);
  const lastTurnIdRef = useRef<string | null>(null);
  const lastScrollKeyRef = useRef(scrollKey ?? '');

  useEffect(() => {
    onAtBottomChangeRef.current = onAtBottomChange;
  }, [onAtBottomChange]);

  useEffect(() => {
    onActiveTurnChangeRef.current = onActiveTurnChange;
  }, [onActiveTurnChange]);

  const publishActiveTurn = useCallback((turnId: string | null) => {
    if (activeTurnIdRef.current === turnId) {
      return;
    }

    activeTurnIdRef.current = turnId;
    onActiveTurnChangeRef.current?.(turnId);
  }, []);

  const syncActiveTurn = useCallback(() => {
    const container = scrollContainerRef.current;

    if (!container) {
      return;
    }

    publishActiveTurn(resolveActiveAgentTurnId(container, turns, turnElementsRef.current));
  }, [publishActiveTurn, scrollContainerRef, turns]);

  const scheduleSyncActiveTurn = useCallback(() => {
    if (activeTurnRafRef.current !== null) {
      return;
    }

    activeTurnRafRef.current = window.requestAnimationFrame(() => {
      activeTurnRafRef.current = null;
      syncActiveTurn();
    });
  }, [syncActiveTurn]);

  const handleTurnElementChange = useCallback(
    (turnId: string, element: HTMLElement | null) => {
      if (element) {
        turnElementsRef.current.set(turnId, element);
      } else {
        turnElementsRef.current.delete(turnId);
      }

      scheduleSyncActiveTurn();
    },
    [scheduleSyncActiveTurn],
  );

  const notifyAtBottomChange = useCallback((atBottom: boolean) => {
    if (atBottomRef.current === atBottom) {
      return;
    }

    atBottomRef.current = atBottom;
    onAtBottomChangeRef.current?.(atBottom);
  }, []);

  const isStickPinLocked = useCallback(() => performance.now() < stickPinLockUntilRef.current, []);

  const releaseStickToBottom = useCallback(() => {
    if (!stickToBottomRef.current || isStickPinLocked()) {
      return;
    }

    stickToBottomRef.current = false;
    notifyAtBottomChange(false);
  }, [isStickPinLocked, notifyAtBottomChange]);

  const pinScrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;

    if (!container || !stickToBottomRef.current) {
      return;
    }

    scrollTranscriptToBottomInstant(container, {
      programmaticScrollRef,
      contentHeightRef,
      onAtBottom: notifyAtBottomChange,
    });
  }, [notifyAtBottomChange, scrollContainerRef]);

  const schedulePinScrollToBottom = useCallback(() => {
    if (!stickToBottomRef.current) {
      return;
    }

    window.requestAnimationFrame(() => {
      pinScrollToBottom();
      window.requestAnimationFrame(() => {
        pinScrollToBottom();
      });
    });

    window.setTimeout(() => {
      pinScrollToBottom();
    }, 0);

    window.setTimeout(() => {
      pinScrollToBottom();
    }, 120);

    window.setTimeout(() => {
      pinScrollToBottom();
    }, 280);
  }, [pinScrollToBottom]);

  const forceStickAndPin = useCallback(() => {
    stickToBottomRef.current = true;
    atBottomRef.current = true;
    stickPinLockUntilRef.current = performance.now() + STICK_PIN_LOCK_MS;
    onAtBottomChangeRef.current?.(true);
    schedulePinScrollToBottom();
  }, [schedulePinScrollToBottom]);

  useEffect(() => {
    lastScrollKeyRef.current = scrollKey ?? '';
    lastTurnIdRef.current = turns[turns.length - 1]?.id ?? null;
    contentHeightRef.current = 0;
    forceStickAndPin();
  }, [forceStickAndPin, scrollKey]);

  useEffect(() => {
    const container = scrollContainerRef.current;

    if (!container) {
      return;
    }

    const handleScroll = () => {
      scheduleSyncActiveTurn();

      if (programmaticScrollRef.current) {
        return;
      }

      if (isStickPinLocked()) {
        if (stickToBottomRef.current) {
          scrollTranscriptToBottomInstant(container, {
            programmaticScrollRef,
            contentHeightRef,
            onAtBottom: notifyAtBottomChange,
          });
        }

        return;
      }

      const atBottom = isScrollContainerAtBottom(container);
      stickToBottomRef.current = atBottom;
      notifyAtBottomChange(atBottom);
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY >= 0) {
        return;
      }

      if (isStickPinLocked()) {
        return;
      }

      if (isScrollContainerAtBottom(container)) {
        const distance =
          container.scrollHeight - container.scrollTop - container.clientHeight;
        if (distance <= SCROLL_BOTTOM_THRESHOLD_PX) {
          window.requestAnimationFrame(() => {
            if (!isScrollContainerAtBottom(container)) {
              releaseStickToBottom();
            }
          });
          return;
        }
      }

      releaseStickToBottom();
    };

    const handleTouchMove = () => {
      if (isStickPinLocked()) {
        return;
      }

      if (!isScrollContainerAtBottom(container)) {
        releaseStickToBottom();
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    container.addEventListener('wheel', handleWheel, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchmove', handleTouchMove);
    };
  }, [
    isStickPinLocked,
    notifyAtBottomChange,
    releaseStickToBottom,
    scheduleSyncActiveTurn,
    scrollContainerRef,
    scrollKey,
  ]);

  useEffect(() => {
    if (!scrollControlRef) {
      return;
    }

    scrollControlRef.current = {
      scrollToBottom: (options) => {
        const container = scrollContainerRef.current;

        if (!container) {
          return;
        }

        stickToBottomRef.current = true;
        stickPinLockUntilRef.current = performance.now() + STICK_PIN_LOCK_MS;
        programmaticScrollRef.current = true;
        scrollContainerToBottom(container, {
          smooth: options?.smooth ?? true,
          onComplete: () => {
            programmaticScrollRef.current = false;
            contentHeightRef.current = container.scrollHeight;
            notifyAtBottomChange(isScrollContainerAtBottom(container));
            schedulePinScrollToBottom();
            scheduleSyncActiveTurn();
          },
        });
      },
      scrollToTurn: (turnId, options) => {
        const container = scrollContainerRef.current;
        const turnElement = turnElementsRef.current.get(turnId);

        if (!container || !turnElement) {
          return;
        }

        stickToBottomRef.current = false;
        stickPinLockUntilRef.current = 0;
        programmaticScrollRef.current = true;
        publishActiveTurn(turnId);

        const containerRect = container.getBoundingClientRect();
        const turnRect = turnElement.getBoundingClientRect();
        const nextTop = Math.max(0, container.scrollTop + (turnRect.top - containerRect.top) - 12);
        const useSmooth = options?.smooth ?? !prefersReducedMotion();

        if (!useSmooth) {
          container.scrollTop = nextTop;
          programmaticScrollRef.current = false;
          notifyAtBottomChange(isScrollContainerAtBottom(container));
          scheduleSyncActiveTurn();
          return;
        }

        const startTop = container.scrollTop;
        const distance = nextTop - startTop;

        if (Math.abs(distance) < 1) {
          programmaticScrollRef.current = false;
          notifyAtBottomChange(isScrollContainerAtBottom(container));
          scheduleSyncActiveTurn();
          return;
        }

        const duration = Math.min(420, Math.max(220, Math.abs(distance) * 0.4));
        const startTime = performance.now();

        const step = (now: number) => {
          const progress = Math.min(1, (now - startTime) / duration);
          const eased = 1 - Math.pow(1 - progress, 3);
          container.scrollTop = startTop + distance * eased;

          if (progress < 1) {
            window.requestAnimationFrame(step);
            return;
          }

          container.scrollTop = nextTop;
          programmaticScrollRef.current = false;
          notifyAtBottomChange(isScrollContainerAtBottom(container));
          scheduleSyncActiveTurn();
        };

        window.requestAnimationFrame(step);
      },
    };

    return () => {
      scrollControlRef.current = null;
    };
  }, [
    notifyAtBottomChange,
    publishActiveTurn,
    schedulePinScrollToBottom,
    scheduleSyncActiveTurn,
    scrollContainerRef,
    scrollControlRef,
    scrollKey,
  ]);

  useEffect(() => {
    scheduleSyncActiveTurn();
  }, [scheduleSyncActiveTurn, turns]);

  useEffect(() => {
    return () => {
      if (activeTurnRafRef.current !== null) {
        window.cancelAnimationFrame(activeTurnRafRef.current);
        activeTurnRafRef.current = null;
      }
    };
  }, []);

  const lastTurnId = turns[turns.length - 1]?.id ?? null;
  const turnCount = turns.length;

  useEffect(() => {
    if (!lastTurnId) {
      return;
    }

    const container = scrollContainerRef.current;

    if (!container) {
      return;
    }

    const previousTurnId = lastTurnIdRef.current;
    lastTurnIdRef.current = lastTurnId;

    if (!previousTurnId || previousTurnId === lastTurnId) {
      return;
    }

    forceStickAndPin();
  }, [forceStickAndPin, lastTurnId, turnCount]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    const content = contentRef.current;

    if (!container || !content) {
      return;
    }

    const flushScrollToBottom = () => {
      scrollRafRef.current = null;

      if (!stickToBottomRef.current) {
        return;
      }

      const targetTop = getScrollContainerTargetTop(container);
      const distanceFromBottom = targetTop - container.scrollTop;

      contentHeightRef.current = container.scrollHeight;

      if (distanceFromBottom <= 1) {
        notifyAtBottomChange(true);
        return;
      }

      programmaticScrollRef.current = true;
      container.scrollTop = targetTop;
      programmaticScrollRef.current = false;
      notifyAtBottomChange(true);
    };

    const scheduleScrollToBottom = () => {
      if (!stickToBottomRef.current) {
        return;
      }

      if (scrollRafRef.current !== null) {
        return;
      }

      scrollRafRef.current = window.requestAnimationFrame(flushScrollToBottom);
    };

    contentHeightRef.current = container.scrollHeight;

    const observer = new ResizeObserver(scheduleScrollToBottom);
    observer.observe(content);
    observer.observe(container);

    return () => {
      observer.disconnect();

      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [notifyAtBottomChange, scrollContainerRef, scrollKey]);

  return (
    <div ref={contentRef} className='agent-view__turns'>
      {turns.map((turn, index) => (
        <AgentTurnView
          key={turn.id}
          turn={turn}
          turnIndex={index}
          scrollContainerRef={scrollContainerRef}
          isEditing={turn.id === editingTurnId}
          isLatestTurn={index === turns.length - 1}
          projectId={projectId}
          projectPath={projectPath}
          paneId={paneId}
          disableStickyPrompt={disableStickyPrompt}
          onTurnElementChange={handleTurnElementChange}
          onEdit={onEdit}
          onRedo={onRedo}
          onSubmitQuestion={onSubmitQuestion}
        />
      ))}
    </div>
  );
}

export const AgentTranscript = memo(AgentTranscriptComponent);

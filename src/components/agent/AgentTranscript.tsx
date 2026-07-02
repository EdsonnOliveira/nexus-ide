import { memo, useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import type { AgentQuestionAnswers, AgentTurn } from '@/types';
import { AgentTurnView } from '@/components/agent/AgentTurnView';

export interface AgentTranscriptScrollControl {
  scrollToBottom: (options?: { smooth?: boolean }) => void;
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
  onAtBottomChange?: (atBottom: boolean) => void;
  onEdit?: (turnId: string) => void;
  onRedo?: (turnId: string) => void;
  onSubmitQuestion?: (activityId: string, answers: AgentQuestionAnswers) => boolean | Promise<boolean>;
}

const SCROLL_BOTTOM_THRESHOLD_PX = 48;

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
  onAtBottomChange,
  onEdit,
  onRedo,
  onSubmitQuestion,
}: AgentTranscriptProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const atBottomRef = useRef(true);
  const programmaticScrollRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);
  const contentHeightRef = useRef(0);
  const onAtBottomChangeRef = useRef(onAtBottomChange);
  const lastTurnIdRef = useRef<string | null>(null);
  const lastScrollKeyRef = useRef(scrollKey ?? '');

  useEffect(() => {
    onAtBottomChangeRef.current = onAtBottomChange;
  }, [onAtBottomChange]);

  const notifyAtBottomChange = useCallback((atBottom: boolean) => {
    if (atBottomRef.current === atBottom) {
      return;
    }

    atBottomRef.current = atBottom;
    onAtBottomChangeRef.current?.(atBottom);
  }, []);

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
    stickToBottomRef.current = true;
    atBottomRef.current = true;
    onAtBottomChangeRef.current?.(true);

    window.requestAnimationFrame(() => {
      pinScrollToBottom();
      window.requestAnimationFrame(() => {
        pinScrollToBottom();
      });
    });

    window.setTimeout(() => {
      pinScrollToBottom();
    }, 0);
  }, [pinScrollToBottom]);

  useEffect(() => {
    lastScrollKeyRef.current = scrollKey ?? '';
    lastTurnIdRef.current = turns[turns.length - 1]?.id ?? null;
    contentHeightRef.current = 0;
    schedulePinScrollToBottom();
  }, [schedulePinScrollToBottom, scrollKey]);

  useEffect(() => {
    if (turns.length === 0) {
      return;
    }

    schedulePinScrollToBottom();
  }, [schedulePinScrollToBottom, turns.length]);

  useEffect(() => {
    const container = scrollContainerRef.current;

    if (!container) {
      return;
    }

    const handleScroll = () => {
      if (programmaticScrollRef.current) {
        return;
      }

      const atBottom = isScrollContainerAtBottom(container);
      stickToBottomRef.current = atBottom;
      notifyAtBottomChange(atBottom);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [notifyAtBottomChange, scrollContainerRef, scrollKey]);

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
        programmaticScrollRef.current = true;
        scrollContainerToBottom(container, {
          smooth: options?.smooth ?? true,
          onComplete: () => {
            programmaticScrollRef.current = false;
            contentHeightRef.current = container.scrollHeight;
            notifyAtBottomChange(isScrollContainerAtBottom(container));
          },
        });
      },
    };

    return () => {
      scrollControlRef.current = null;
    };
  }, [notifyAtBottomChange, scrollContainerRef, scrollControlRef, scrollKey]);

  const lastTurnId = turns[turns.length - 1]?.id ?? null;

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

    stickToBottomRef.current = true;
    programmaticScrollRef.current = true;
    scrollContainerToBottom(container, {
      smooth: true,
      onComplete: () => {
        programmaticScrollRef.current = false;
        contentHeightRef.current = container.scrollHeight;
        notifyAtBottomChange(isScrollContainerAtBottom(container));
      },
    });
  }, [lastTurnId, notifyAtBottomChange, scrollContainerRef]);

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

      const nextHeight = container.scrollHeight;
      const previousHeight = contentHeightRef.current;
      const targetTop = getScrollContainerTargetTop(container);
      const distanceFromBottom = targetTop - container.scrollTop;
      const contentGrew = nextHeight > previousHeight + 1;

      contentHeightRef.current = nextHeight;

      if (!contentGrew && distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD_PX) {
        return;
      }

      if (!contentGrew && distanceFromBottom > SCROLL_BOTTOM_THRESHOLD_PX) {
        stickToBottomRef.current = false;
        notifyAtBottomChange(false);
        return;
      }

      if (distanceFromBottom <= 1) {
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
          onEdit={onEdit}
          onRedo={onRedo}
          onSubmitQuestion={onSubmitQuestion}
        />
      ))}
    </div>
  );
}

export const AgentTranscript = memo(AgentTranscriptComponent);

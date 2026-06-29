import { memo, useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import type { AgentQuestionAnswers, AgentTurn } from '@/types';
import { AgentTurnView } from '@/components/agent/AgentTurnView';

export interface AgentTranscriptScrollControl {
  scrollToBottom: () => void;
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
  const onAtBottomChangeRef = useRef(onAtBottomChange);

  useEffect(() => {
    onAtBottomChangeRef.current = onAtBottomChange;
  }, [onAtBottomChange]);

  const notifyAtBottomChange = (atBottom: boolean) => {
    if (atBottomRef.current === atBottom) {
      return;
    }

    atBottomRef.current = atBottom;
    onAtBottomChangeRef.current?.(atBottom);
  };

  useEffect(() => {
    stickToBottomRef.current = true;
    atBottomRef.current = true;
    onAtBottomChangeRef.current?.(true);
    const container = scrollContainerRef.current;

    if (container) {
      scrollContainerToBottom(container);
    }
  }, [scrollContainerRef, scrollKey]);

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
  }, [scrollContainerRef, scrollKey]);

  useEffect(() => {
    if (!scrollControlRef) {
      return;
    }

    scrollControlRef.current = {
      scrollToBottom: () => {
        const container = scrollContainerRef.current;

        if (!container) {
          return;
        }

        stickToBottomRef.current = true;
        programmaticScrollRef.current = true;
        scrollContainerToBottom(container, {
          smooth: true,
          onComplete: () => {
            programmaticScrollRef.current = false;
            notifyAtBottomChange(isScrollContainerAtBottom(container));
          },
        });
      },
    };

    return () => {
      scrollControlRef.current = null;
    };
  }, [scrollContainerRef, scrollControlRef, scrollKey]);

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

      programmaticScrollRef.current = true;
      scrollContainerToBottom(container, {
        onComplete: () => {
          programmaticScrollRef.current = false;
          notifyAtBottomChange(true);
        },
      });
    };

    const scheduleScrollToBottom = () => {
      if (!stickToBottomRef.current || scrollRafRef.current !== null) {
        return;
      }

      scrollRafRef.current = window.requestAnimationFrame(flushScrollToBottom);
    };

    scheduleScrollToBottom();

    const observer = new ResizeObserver(scheduleScrollToBottom);
    observer.observe(content);

    return () => {
      observer.disconnect();

      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [scrollContainerRef, scrollKey]);

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

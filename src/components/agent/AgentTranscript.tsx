import { memo, useEffect, useRef, type RefObject } from 'react';
import type { AgentQuestionAnswers, AgentTurn } from '@/types';
import { AgentTurnView } from '@/components/agent/AgentTurnView';

interface AgentTranscriptProps {
  turns: AgentTurn[];
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  scrollKey?: string;
  editingTurnId?: string | null;
  projectId: string;
  projectPath: string;
  paneId: string;
  onEdit?: (turnId: string) => void;
  onRedo?: (turnId: string) => void;
  onSubmitQuestion?: (activityId: string, answers: AgentQuestionAnswers) => boolean | Promise<boolean>;
}

const SCROLL_BOTTOM_THRESHOLD_PX = 48;

function isScrollContainerAtBottom(container: HTMLElement): boolean {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight <=
    SCROLL_BOTTOM_THRESHOLD_PX
  );
}

function scrollContainerToBottom(container: HTMLElement): void {
  container.scrollTop = container.scrollHeight;
}

function AgentTranscriptComponent({
  turns,
  scrollContainerRef,
  scrollKey,
  editingTurnId,
  projectId,
  projectPath,
  paneId,
  onEdit,
  onRedo,
  onSubmitQuestion,
}: AgentTranscriptProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const programmaticScrollRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);

  useEffect(() => {
    stickToBottomRef.current = true;
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

      stickToBottomRef.current = isScrollContainerAtBottom(container);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [scrollContainerRef, scrollKey]);

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
      scrollContainerToBottom(container);
      window.requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
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

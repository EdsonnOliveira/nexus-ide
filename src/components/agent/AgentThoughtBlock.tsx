import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { AgentActivity } from '@/types';
import { useMarkdownCodeHighlight, useDeferredMarkdownHtml } from '@/hooks/useMarkdownCodeHighlight';

interface AgentThoughtBlockProps {
  activity: AgentActivity;
  defaultExpanded?: boolean;
  forceCollapsed?: boolean;
}

const SCROLL_BOTTOM_THRESHOLD_PX = 48;

function isThoughtBodyAtBottom(body: HTMLElement): boolean {
  return (
    body.scrollHeight - body.scrollTop - body.clientHeight <= SCROLL_BOTTOM_THRESHOLD_PX
  );
}

function getThoughtBodyTargetTop(body: HTMLElement): number {
  return Math.max(0, body.scrollHeight - body.clientHeight);
}

function formatDuration(durationMs?: number): string {
  if (!durationMs) {
    return '1s';
  }

  const seconds = Math.max(1, Math.round(durationMs / 1000));
  return `${seconds}s`;
}

function getElapsedSeconds(startedAt: number): number {
  return Math.max(1, Math.round((Date.now() - startedAt) / 1000));
}

function AgentThoughtBlockComponent({
  activity,
  defaultExpanded = false,
  forceCollapsed = false,
}: AgentThoughtBlockProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const programmaticScrollRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);
  const [expanded, setExpanded] = useState(() => {
    if (forceCollapsed) {
      return false;
    }

    return Boolean(activity.streaming) || defaultExpanded;
  });
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    activity.streaming ? getElapsedSeconds(activity.createdAt) : 1,
  );

  const bodyText = activity.label.trim();
  const bodyHtml = useDeferredMarkdownHtml(bodyText);
  const proseRef = useMarkdownCodeHighlight<HTMLDivElement>(bodyHtml);
  const canToggle = Boolean(bodyText) || Boolean(activity.streaming);

  useEffect(() => {
    if (forceCollapsed) {
      setExpanded(false);
      return;
    }

    if (activity.streaming) {
      setExpanded(true);
      return;
    }

    if (defaultExpanded && bodyText) {
      setExpanded(true);
    }
  }, [activity.streaming, bodyText, defaultExpanded, forceCollapsed]);

  useEffect(() => {
    if (!activity.streaming) {
      return;
    }

    setElapsedSeconds(getElapsedSeconds(activity.createdAt));

    const intervalId = window.setInterval(() => {
      setElapsedSeconds(getElapsedSeconds(activity.createdAt));
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activity.createdAt, activity.id, activity.streaming]);

  useEffect(() => {
    stickToBottomRef.current = true;

    const body = bodyRef.current;

    if (body) {
      body.scrollTop = getThoughtBodyTargetTop(body);
    }
  }, [activity.id]);

  useEffect(() => {
    const body = bodyRef.current;

    if (!body || !expanded) {
      return;
    }

    const handleScroll = () => {
      if (programmaticScrollRef.current) {
        return;
      }

      stickToBottomRef.current = isThoughtBodyAtBottom(body);
    };

    body.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      body.removeEventListener('scroll', handleScroll);
    };
  }, [activity.id, expanded]);

  useEffect(() => {
    const body = bodyRef.current;

    if (!body || !expanded || !activity.streaming) {
      return;
    }

    const flushScrollToBottom = () => {
      scrollRafRef.current = null;

      if (!stickToBottomRef.current) {
        return;
      }

      const targetTop = getThoughtBodyTargetTop(body);
      const distanceFromBottom = targetTop - body.scrollTop;

      if (distanceFromBottom <= 1) {
        return;
      }

      programmaticScrollRef.current = true;
      body.scrollTop = targetTop;
      programmaticScrollRef.current = false;
      stickToBottomRef.current = true;
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

    const observer = new ResizeObserver(scheduleScrollToBottom);
    observer.observe(body);
    scheduleScrollToBottom();

    return () => {
      observer.disconnect();

      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [activity.id, activity.streaming, bodyHtml, bodyText, expanded]);

  const handleToggle = useCallback(() => {
    if (!canToggle) {
      return;
    }

    setExpanded((prev) => !prev);
  }, [canToggle]);

  const isBriefThought = !activity.streaming && !bodyText;
  const titleLabel = activity.streaming
    ? `Thinking ${elapsedSeconds}s`
    : isBriefThought
      ? 'Thought briefly'
      : `Thought for ${formatDuration(activity.durationMs)}`;

  const showWaitingState = activity.streaming && !bodyText;
  const waitingHint = showWaitingState
    ? elapsedSeconds >= 300
      ? 'Demorando demais. Pare o agent e tente de novo.'
      : elapsedSeconds >= 90
        ? 'Ainda sem resposta do agent...'
        : null
    : null;

  return (
    <div
      className={`agent-view__thought${activity.streaming ? ' agent-view__thought--streaming' : ''}${expanded ? ' agent-view__thought--expanded' : ''}`}
    >
      <button
        type='button'
        className='agent-view__thought-header app-button'
        aria-expanded={expanded}
        disabled={!canToggle}
        onClick={handleToggle}
      >
        <span
          className={`agent-view__file-verb agent-view__thought-title${activity.streaming ? ' agent-view__thought-title--streaming' : ''}`}
        >
          {titleLabel}
        </span>
      </button>
      {expanded ? (
        <div ref={bodyRef} className='agent-view__thought-body app-button--enter'>
          {bodyText ? (
            <div
              ref={proseRef}
              className='agent-view__thought-prose markdown-preview markdown-preview--monokai'
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          ) : null}
          {showWaitingState ? (
            <div className='agent-view__thought-waiting'>
              <span className='agent-view__thought-waiting-dot' aria-hidden='true' />
              <span className='agent-view__thought-waiting-dot' aria-hidden='true' />
              <span className='agent-view__thought-waiting-dot' aria-hidden='true' />
              {waitingHint ? (
                <span className='agent-view__thought-waiting-hint'>{waitingHint}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const AgentThoughtBlock = memo(AgentThoughtBlockComponent);

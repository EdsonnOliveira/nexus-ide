import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AgentActivityIcon,
  resolveAgentActivityIconKind,
} from '@/components/agent/AgentActivityIcon';
import { AgentLiveStatus } from '@/components/agent/AgentLiveStatus';
import type { AgentActivity } from '@/types';
import {
  useMarkdownCodeHighlight,
  useDeferredMarkdownHtml,
} from '@/hooks/useMarkdownCodeHighlight';

interface AgentThoughtBlockProps {
  activity: AgentActivity;
  defaultExpanded?: boolean;
  forceCollapsed?: boolean;
  projectPath?: string;
}

const SCROLL_BOTTOM_THRESHOLD_PX = 48;

function isThoughtBodyAtBottom(body: HTMLElement): boolean {
  return body.scrollHeight - body.scrollTop - body.clientHeight <= SCROLL_BOTTOM_THRESHOLD_PX;
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
  projectPath,
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
    activity.streaming && activity.label.trim() ? getElapsedSeconds(activity.createdAt) : 1,
  );

  const bodyText = activity.label.trim();
  const bodyHtml = useDeferredMarkdownHtml(bodyText, projectPath);
  const proseRef = useMarkdownCodeHighlight<HTMLDivElement>(bodyHtml, projectPath);
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
    if (!activity.streaming || !activity.label.trim()) {
      return;
    }

    setElapsedSeconds(getElapsedSeconds(activity.createdAt));

    const intervalId = window.setInterval(() => {
      setElapsedSeconds(getElapsedSeconds(activity.createdAt));
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activity.createdAt, activity.id, activity.streaming, activity.label]);

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

    let lastBodyHeight = body.offsetHeight;

    const flushScrollToBottom = () => {
      scrollRafRef.current = null;

      if (!stickToBottomRef.current || programmaticScrollRef.current) {
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
      if (!stickToBottomRef.current || programmaticScrollRef.current) {
        return;
      }

      if (scrollRafRef.current !== null) {
        return;
      }

      scrollRafRef.current = window.requestAnimationFrame(flushScrollToBottom);
    };

    const observer = new ResizeObserver(() => {
      const nextHeight = body.offsetHeight;
      if (nextHeight <= lastBodyHeight + 0.5) {
        return;
      }

      lastBodyHeight = nextHeight;
      scheduleScrollToBottom();
    });
    observer.observe(body);
    scheduleScrollToBottom();

    return () => {
      observer.disconnect();

      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [activity.id, activity.streaming, expanded]);

  const handleToggle = useCallback(() => {
    if (!canToggle) {
      return;
    }

    setExpanded((prev) => !prev);
  }, [canToggle]);

  const isBriefThought = !activity.streaming && !bodyText;
  const firstLine = bodyText.split('\n').find((line) => line.trim())?.trim() ?? '';
  const streamingTitle =
    firstLine.length > 88 ? `${firstLine.slice(0, 85)}…` : firstLine;
  const titleLabel = activity.streaming
    ? streamingTitle || `Pensando ${elapsedSeconds}s`
    : isBriefThought
      ? 'Pensou brevemente'
      : `Pensou por ${formatDuration(activity.durationMs)}`;
  const iconKind = useMemo(() => resolveAgentActivityIconKind(activity), [activity]);

  if (activity.streaming && !bodyText) {
    return <AgentLiveStatus label='Pensando...' />;
  }

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
        <AgentActivityIcon kind={iconKind} />
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
        </div>
      ) : null}
    </div>
  );
}

export const AgentThoughtBlock = memo(AgentThoughtBlockComponent);

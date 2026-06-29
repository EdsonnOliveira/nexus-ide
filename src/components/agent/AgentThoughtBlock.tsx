import { memo, useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AgentActivity } from '@/types';

interface AgentThoughtBlockProps {
  activity: AgentActivity;
  defaultExpanded?: boolean;
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

function AgentThoughtBlockComponent({ activity, defaultExpanded = true }: AgentThoughtBlockProps) {
  const [expanded, setExpanded] = useState(
    () => !activity.streaming && defaultExpanded && !activity.collapsed,
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    activity.streaming ? getElapsedSeconds(activity.createdAt) : 1,
  );

  useEffect(() => {
    if (!activity.streaming && activity.collapsed) {
      setExpanded(false);
    }
  }, [activity.collapsed, activity.streaming]);

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

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const isBriefThought = !activity.streaming && !activity.label.trim();
  const bodyText = activity.label.trim();

  const titleLabel = activity.streaming
    ? `Thinking ${elapsedSeconds}s`
    : isBriefThought
      ? 'Thought briefly'
      : 'Thought';

  return (
    <div className='agent-view__thought'>
      <button type='button' className='agent-view__thought-header app-button' onClick={handleToggle}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span
          className={`agent-view__thought-title${activity.streaming ? ' agent-view__thought-title--streaming' : ''}`}
        >
          {titleLabel}
        </span>
        {!activity.streaming && !isBriefThought ? (
          <span className='agent-view__thought-duration'>for {formatDuration(activity.durationMs)}</span>
        ) : null}
      </button>
      {expanded ? (
        <div className='agent-view__thought-body'>
          {bodyText || (activity.streaming ? 'Analisando...' : 'Sem detalhes')}
        </div>
      ) : null}
    </div>
  );
}

export const AgentThoughtBlock = memo(AgentThoughtBlockComponent);

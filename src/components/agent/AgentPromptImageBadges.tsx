import { memo, useMemo, type CSSProperties } from 'react';
import {
  getAgentPromptImageBadgeColor,
  getAgentPromptPathMentionBadgeColor,
  hasAgentPromptImageMentions,
  splitAgentPromptImageMentions,
} from '@/utils/agentPromptImageBadge';

interface AgentPromptImageIndexBadgeProps {
  index: number;
  className?: string;
}

function AgentPromptImageIndexBadgeComponent({ index, className }: AgentPromptImageIndexBadgeProps) {
  const badgeColor = getAgentPromptImageBadgeColor(index);

  return (
    <span
      className={`agent-view__prompt-image-index-badge app-button--enter${className ? ` ${className}` : ''}`}
      style={{ '--prompt-image-badge-color': badgeColor } as CSSProperties}
      aria-hidden='true'
    >
      {index}
    </span>
  );
}

export const AgentPromptImageIndexBadge = memo(AgentPromptImageIndexBadgeComponent);

interface AgentPromptMentionBadgeProps {
  value: string;
  badgeColor: string;
  alignWidth?: boolean;
}

function AgentPromptMentionBadgeComponent({
  value,
  badgeColor,
  alignWidth = false,
}: AgentPromptMentionBadgeProps) {
  const mentionStyle = { '--prompt-image-badge-color': badgeColor } as CSSProperties;

  if (alignWidth) {
    return (
      <span
        className='agent-view__prompt-image-mention-wrap agent-view__prompt-image-mention-wrap--composer'
        style={mentionStyle}
      >
        <span
          className='agent-view__prompt-image-mention-sizer agent-view__prompt-image-mention-sizer--composer'
          aria-hidden='true'
        >
          {value}
        </span>
        <span className='agent-view__prompt-image-mention-pill' aria-hidden='true'>
          <span className='agent-view__prompt-image-mention-pill__bg' />
          <span className='agent-view__prompt-image-mention-pill__label'>{value}</span>
        </span>
      </span>
    );
  }

  return (
    <span
      className='agent-view__prompt-image-mention app-button--enter'
      style={mentionStyle}
    >
      {value}
    </span>
  );
}

const AgentPromptMentionBadge = memo(AgentPromptMentionBadgeComponent);

interface AgentPromptImageMentionTextProps {
  text: string;
  alignWidth?: boolean;
}

function AgentPromptImageMentionTextComponent({
  text,
  alignWidth = false,
}: AgentPromptImageMentionTextProps) {
  const segments = useMemo(
    () => splitAgentPromptImageMentions(text, { collapseMentionGaps: !alignWidth }),
    [alignWidth, text],
  );
  const showMentions = hasAgentPromptImageMentions(text);

  if (!showMentions) {
    return <>{text}</>;
  }

  return (
    <>
      {segments.map((segment, segmentIndex) => {
        if (segment.kind === 'text') {
          return <span key={`text-${segmentIndex}`}>{segment.value}</span>;
        }

        const badgeColor =
          segment.kind === 'path-mention'
            ? getAgentPromptPathMentionBadgeColor(segment.path)
            : getAgentPromptImageBadgeColor(segment.imageNumber);

        return (
          <AgentPromptMentionBadge
            key={`mention-${segmentIndex}`}
            value={segment.value}
            badgeColor={badgeColor}
            alignWidth={alignWidth}
          />
        );
      })}
    </>
  );
}

export const AgentPromptImageMentionText = memo(AgentPromptImageMentionTextComponent);

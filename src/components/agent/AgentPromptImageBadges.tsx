import { memo, useMemo, type CSSProperties } from 'react';
import {
  getAgentPromptImageBadgeColor,
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

interface AgentPromptImageMentionTextProps {
  text: string;
  alignWidth?: boolean;
}

function AgentPromptImageMentionTextComponent({
  text,
  alignWidth = false,
}: AgentPromptImageMentionTextProps) {
  const segments = useMemo(() => splitAgentPromptImageMentions(text), [text]);
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

        const badgeColor = getAgentPromptImageBadgeColor(segment.imageNumber);
        const mentionStyle = { '--prompt-image-badge-color': badgeColor } as CSSProperties;

        if (alignWidth) {
          return (
            <span
              key={`mention-${segmentIndex}`}
              className='agent-view__prompt-image-mention-wrap'
              style={mentionStyle}
            >
              <span className='agent-view__prompt-image-mention-sizer' aria-hidden='true'>
                {segment.value}
              </span>
              <span className='agent-view__prompt-image-mention agent-view__prompt-image-mention--overlay'>
                {segment.value}
              </span>
            </span>
          );
        }

        return (
          <span
            key={`mention-${segmentIndex}`}
            className='agent-view__prompt-image-mention app-button--enter'
            style={mentionStyle}
          >
            {segment.value}
          </span>
        );
      })}
    </>
  );
}

export const AgentPromptImageMentionText = memo(AgentPromptImageMentionTextComponent);

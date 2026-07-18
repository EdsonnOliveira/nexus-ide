import { memo, useMemo, type CSSProperties } from 'react';
import {
  getWebAgentPromptImageBadgeColor,
  hasWebAgentPromptImageMentions,
  splitWebAgentPromptImageMentions,
} from './webAgentPromptImages';

interface WebAgentPromptImageMentionTextProps {
  text: string;
  imagePreviewByNumber?: ReadonlyMap<number, string>;
}

function WebAgentPromptImageMentionTextComponent({
  text,
  imagePreviewByNumber,
}: WebAgentPromptImageMentionTextProps) {
  const segments = useMemo(() => splitWebAgentPromptImageMentions(text), [text]);

  if (!hasWebAgentPromptImageMentions(text)) {
    return <>{text}</>;
  }

  return (
    <>
      {segments.map((segment, segmentIndex) => {
        if (segment.kind === 'text') {
          return (
            <span key={`text-${segmentIndex}`} className='agent-view__prompt-image-mention-text'>
              {segment.value}
            </span>
          );
        }

        const badgeColor = getWebAgentPromptImageBadgeColor(segment.imageNumber);
        const previewSrc = imagePreviewByNumber?.get(segment.imageNumber) ?? null;

        return (
          <span
            key={`mention-${segmentIndex}-${segment.imageNumber}`}
            className={`agent-view__prompt-image-mention-wrap agent-view__prompt-image-mention-wrap--composer${
              previewSrc ? ' agent-view__prompt-image-mention-wrap--preview' : ''
            }`}
            style={{ '--prompt-image-badge-color': badgeColor } as CSSProperties}
            title={previewSrc ? `Imagem ${segment.imageNumber}` : undefined}
          >
            <span
              className='agent-view__prompt-image-mention-sizer agent-view__prompt-image-mention-sizer--composer'
              aria-hidden='true'
            >
              {segment.value}
            </span>
            <span className='agent-view__prompt-image-mention-pill' aria-hidden='true'>
              <span className='agent-view__prompt-image-mention-pill__bg' />
              <span className='agent-view__prompt-image-mention-pill__label'>{segment.value}</span>
            </span>
          </span>
        );
      })}
    </>
  );
}

export const WebAgentPromptImageMentionText = memo(WebAgentPromptImageMentionTextComponent);

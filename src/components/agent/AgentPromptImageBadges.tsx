import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
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
  previewSrc?: string | null;
}

function AgentPromptMentionBadgeComponent({
  value,
  badgeColor,
  alignWidth = false,
  previewSrc = null,
}: AgentPromptMentionBadgeProps) {
  const mentionStyle = { '--prompt-image-badge-color': badgeColor } as CSSProperties;
  const badgeRef = useRef<HTMLSpanElement>(null);
  const [previewRect, setPreviewRect] = useState<DOMRect | null>(null);
  const hideTimeoutRef = useRef<number | null>(null);

  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current !== null) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const showPreview = useCallback(() => {
    if (!previewSrc || !badgeRef.current) {
      return;
    }

    clearHideTimeout();
    setPreviewRect(badgeRef.current.getBoundingClientRect());
  }, [clearHideTimeout, previewSrc]);

  const hidePreview = useCallback(() => {
    clearHideTimeout();
    hideTimeoutRef.current = window.setTimeout(() => {
      setPreviewRect(null);
      hideTimeoutRef.current = null;
    }, 80);
  }, [clearHideTimeout]);

  useEffect(() => {
    return () => {
      clearHideTimeout();
    };
  }, [clearHideTimeout]);

  const previewPopup =
    previewSrc && previewRect
      ? createPortal(
          <div
            className='agent-view__prompt-image-preview-popup overlay-popup overlay-popup--in'
            style={{
              left: Math.min(
                Math.max(8, previewRect.left + previewRect.width / 2 - 88),
                window.innerWidth - 192,
              ),
              top: Math.max(8, previewRect.top - 148),
            }}
            onMouseEnter={showPreview}
            onMouseLeave={hidePreview}
          >
            <img src={previewSrc} alt='' className='agent-view__prompt-image-preview-popup-img' />
          </div>,
          document.body,
        )
      : null;

  if (alignWidth) {
    return (
      <>
        <span
          ref={badgeRef}
          className={`agent-view__prompt-image-mention-wrap agent-view__prompt-image-mention-wrap--composer${previewSrc ? ' agent-view__prompt-image-mention-wrap--preview' : ''}`}
          style={mentionStyle}
          onMouseEnter={previewSrc ? showPreview : undefined}
          onMouseLeave={previewSrc ? hidePreview : undefined}
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
        {previewPopup}
      </>
    );
  }

  return (
    <>
      <span
        ref={badgeRef}
        className={`agent-view__prompt-image-mention app-button--enter${previewSrc ? ' agent-view__prompt-image-mention--preview' : ''}`}
        style={mentionStyle}
        onMouseEnter={previewSrc ? showPreview : undefined}
        onMouseLeave={previewSrc ? hidePreview : undefined}
      >
        {value}
      </span>
      {previewPopup}
    </>
  );
}

const AgentPromptMentionBadge = memo(AgentPromptMentionBadgeComponent);

interface AgentPromptImageMentionTextProps {
  text: string;
  alignWidth?: boolean;
  imagePreviewByNumber?: ReadonlyMap<number, string>;
}

function AgentPromptImageMentionTextComponent({
  text,
  alignWidth = false,
  imagePreviewByNumber,
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
          return (
            <span key={`text-${segmentIndex}`} className='agent-view__prompt-image-mention-text'>
              {segment.value}
            </span>
          );
        }

        const badgeColor =
          segment.kind === 'path-mention'
            ? getAgentPromptPathMentionBadgeColor(segment.path)
            : getAgentPromptImageBadgeColor(segment.imageNumber);

        const previewSrc =
          segment.kind === 'mention'
            ? imagePreviewByNumber?.get(segment.imageNumber) ?? null
            : null;

        return (
          <AgentPromptMentionBadge
            key={`mention-${segmentIndex}`}
            value={segment.value}
            badgeColor={badgeColor}
            alignWidth={alignWidth}
            previewSrc={previewSrc}
          />
        );
      })}
    </>
  );
}

export const AgentPromptImageMentionText = memo(AgentPromptImageMentionTextComponent);

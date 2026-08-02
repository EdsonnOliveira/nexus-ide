import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen } from 'lucide-react';
import { AgentPromptImageIndexBadge } from '@/components/agent/AgentPromptImageBadges';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import type { AgentPromptAttachment, AgentTurn } from '@/types';
import {
  hydrateAgentUserMessage,
  resolvePromptDisplayContent,
} from '@/utils/agentPromptAttachments';
import { AGENT_PROMPT_IMAGE_MENTION_REGEX } from '@/utils/agentPromptImageBadge';
import {
  isSkillOnlyPrompt,
  resolveAgentSkillDisplayState,
  shouldShowSkillChipAbovePrompt,
} from '@/utils/agentSkillDisplay';
import { renderMarkdownPreview } from '@/utils/markdownPreview';
import { stripMarkdownSyntax } from '@/utils/markdownText';

interface AgentPromptRailProps {
  turns: AgentTurn[];
  activeTurnId: string | null;
  projectPath: string;
  onSelectTurn: (turnId: string) => void;
}

interface PromptRailPreview {
  turnId: string;
  top: number;
  left: number;
  title: string;
  titleHtml: string;
  bodyHtml: string;
  skillLabel: string | null;
  showSkillChip: boolean;
  showTitle: boolean;
  attachments: AgentPromptAttachment[];
}

const MARK_WIDTH_NORMAL = 10;
const MARK_WIDTH_FOCUS = 18;
const MARK_WIDTH_MIN = 4;
const MARK_HOVER_WIDTH_FACTORS = [1, 0.78, 0.52, 0.32, 0.22];

function truncatePromptText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function stripImageMentions(value: string): string {
  return value
    .replace(new RegExp(AGENT_PROMPT_IMAGE_MENTION_REGEX.source, 'gi'), '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function resolveTurnPreview(
  turn: AgentTurn,
  attachments: AgentPromptAttachment[],
): {
  title: string;
  titleHtml: string;
  bodyHtml: string;
  skillLabel: string | null;
  showSkillChip: boolean;
  showTitle: boolean;
  attachments: AgentPromptAttachment[];
} {
  const promptText = resolvePromptDisplayContent(turn.user.content);
  const { hasSkillPrompt, skillChipLabel } = resolveAgentSkillDisplayState(turn.user);
  const skillOnly = isSkillOnlyPrompt(turn.user, promptText, attachments.length);
  const showSkillChip =
    hasSkillPrompt && (skillOnly || shouldShowSkillChipAbovePrompt(promptText, skillChipLabel));
  const rawTitleSource = skillOnly
    ? ''
    : promptText || (!showSkillChip && hasSkillPrompt ? skillChipLabel : '') || 'Prompt';
  const titleSource =
    attachments.length > 0 ? stripImageMentions(rawTitleSource) : rawTitleSource;
  const responseLead = turn.summary?.responseLead?.trim() ?? '';
  const responseActivity = [...turn.activities]
    .reverse()
    .find((entry) => entry.kind === 'response' && entry.label.trim());
  const bodySource =
    responseLead ||
    responseActivity?.label.trim() ||
    (turn.running ? 'Executando…' : '');
  const titlePlain = truncatePromptText(
    stripMarkdownSyntax(titleSource || skillChipLabel || 'Prompt'),
    72,
  );
  const titleMarkdown = titleSource.split('\n').find((line) => line.trim())?.trim() || titleSource;
  const bodyMarkdown = bodySource.trim();

  return {
    title: titlePlain,
    titleHtml: titleMarkdown ? renderMarkdownPreview(titleMarkdown) : '',
    bodyHtml: bodyMarkdown ? renderMarkdownPreview(bodyMarkdown) : '',
    skillLabel: showSkillChip ? skillChipLabel : null,
    showSkillChip,
    showTitle: Boolean(titleMarkdown),
    attachments,
  };
}

function resolveMarkWidth(distance: number | null): number {
  if (distance === null) {
    return MARK_WIDTH_NORMAL;
  }

  const factor =
    MARK_HOVER_WIDTH_FACTORS[Math.min(distance, MARK_HOVER_WIDTH_FACTORS.length - 1)] ??
    MARK_HOVER_WIDTH_FACTORS[MARK_HOVER_WIDTH_FACTORS.length - 1];

  return Math.max(MARK_WIDTH_MIN, Math.round(MARK_WIDTH_FOCUS * factor * 10) / 10);
}

function AgentPromptRailComponent({
  turns,
  activeTurnId,
  projectPath,
  onSelectTurn,
}: AgentPromptRailProps) {
  const markRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [hoveredTurnId, setHoveredTurnId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PromptRailPreview | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [hydratedAttachments, setHydratedAttachments] = useState<AgentPromptAttachment[]>([]);
  const leaveTimeoutRef = useRef<number | null>(null);
  const hydrateRequestRef = useRef(0);

  const clearLeaveTimeout = useCallback(() => {
    if (leaveTimeoutRef.current !== null) {
      window.clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
  }, []);

  const updatePreviewPosition = useCallback(
    (turnId: string, attachments: AgentPromptAttachment[]) => {
      const mark = markRefs.current.get(turnId);
      const turn = turns.find((entry) => entry.id === turnId);

      if (!mark || !turn) {
        setPreview(null);
        return;
      }

      const rect = mark.getBoundingClientRect();
      const content = resolveTurnPreview(turn, attachments);

      setPreview({
        turnId,
        top: rect.top + rect.height / 2,
        left: rect.right + 12,
        title: content.title,
        titleHtml: content.titleHtml,
        bodyHtml: content.bodyHtml,
        skillLabel: content.skillLabel,
        showSkillChip: content.showSkillChip,
        showTitle: content.showTitle,
        attachments: content.attachments,
      });
    },
    [turns],
  );

  const handleMarkEnter = useCallback(
    (turnId: string) => {
      clearLeaveTimeout();
      setHoveredTurnId(turnId);
      const turn = turns.find((entry) => entry.id === turnId);
      const initialAttachments = turn?.user.attachments ?? [];
      setHydratedAttachments(initialAttachments);
      updatePreviewPosition(turnId, initialAttachments);
    },
    [clearLeaveTimeout, turns, updatePreviewPosition],
  );

  const handleRailLeave = useCallback(() => {
    if (lightboxUrl) {
      return;
    }

    clearLeaveTimeout();
    leaveTimeoutRef.current = window.setTimeout(() => {
      setHoveredTurnId(null);
      setPreview(null);
      setHydratedAttachments([]);
      leaveTimeoutRef.current = null;
    }, 80);
  }, [clearLeaveTimeout, lightboxUrl]);

  const handlePreviewEnter = useCallback(() => {
    clearLeaveTimeout();
  }, [clearLeaveTimeout]);

  const handleSelect = useCallback(
    (turnId: string) => {
      clearLeaveTimeout();
      onSelectTurn(turnId);
      setHoveredTurnId(turnId);
      const turn = turns.find((entry) => entry.id === turnId);
      const initialAttachments = turn?.user.attachments ?? [];
      setHydratedAttachments(initialAttachments);
      updatePreviewPosition(turnId, initialAttachments);
    },
    [clearLeaveTimeout, onSelectTurn, turns, updatePreviewPosition],
  );

  const handleOpenAttachment = useCallback(
    (event: MouseEvent<HTMLButtonElement>, dataUrl: string) => {
      event.preventDefault();
      event.stopPropagation();
      clearLeaveTimeout();
      setLightboxUrl(dataUrl);
    },
    [clearLeaveTimeout],
  );

  useEffect(() => {
    if (!hoveredTurnId) {
      return;
    }

    const turn = turns.find((entry) => entry.id === hoveredTurnId);

    if (!turn) {
      return;
    }

    const requestId = ++hydrateRequestRef.current;
    let cancelled = false;

    void hydrateAgentUserMessage(projectPath, turn.user).then((next) => {
      if (cancelled || hydrateRequestRef.current !== requestId) {
        return;
      }

      const nextAttachments = next.attachments ?? [];
      setHydratedAttachments(nextAttachments);
      updatePreviewPosition(hoveredTurnId, nextAttachments);
    });

    return () => {
      cancelled = true;
    };
  }, [hoveredTurnId, projectPath, turns, updatePreviewPosition]);

  useEffect(() => {
    if (!hoveredTurnId) {
      return;
    }

    const handleReposition = () => {
      updatePreviewPosition(hoveredTurnId, hydratedAttachments);
    };

    window.addEventListener('resize', handleReposition);
    return () => {
      window.removeEventListener('resize', handleReposition);
    };
  }, [hoveredTurnId, hydratedAttachments, updatePreviewPosition]);

  useEffect(() => {
    return () => {
      clearLeaveTimeout();
    };
  }, [clearLeaveTimeout]);

  const hoveredIndex = useMemo(() => {
    if (!hoveredTurnId) {
      return -1;
    }

    return turns.findIndex((turn) => turn.id === hoveredTurnId);
  }, [hoveredTurnId, turns]);

  const isHovering = hoveredIndex >= 0;

  const marks = useMemo(
    () =>
      turns.map((turn, index) => {
        const isFocused = turn.id === hoveredTurnId;
        const distance = isHovering ? Math.abs(index - hoveredIndex) : null;
        const previewContent = resolveTurnPreview(turn, turn.user.attachments ?? []);
        const label = previewContent.title || `Prompt ${turn.id}`;

        return {
          id: turn.id,
          isFocused,
          isActive: turn.id === activeTurnId,
          width: resolveMarkWidth(distance),
          label,
        };
      }),
    [activeTurnId, hoveredIndex, hoveredTurnId, isHovering, turns],
  );

  if (turns.length <= 1) {
    return null;
  }

  return (
    <>
      <div
        className={`agent-view__prompt-rail${isHovering ? ' agent-view__prompt-rail--hover' : ''}`}
        role='navigation'
        aria-label='Prompts do agent'
        onMouseLeave={handleRailLeave}
      >
        {marks.map((mark) => (
          <button
            key={mark.id}
            ref={(node) => {
              if (node) {
                markRefs.current.set(mark.id, node);
              } else {
                markRefs.current.delete(mark.id);
              }
            }}
            type='button'
            className={`agent-view__prompt-rail-mark app-button${mark.isFocused ? ' agent-view__prompt-rail-mark--focus' : ''}${mark.isActive && !isHovering ? ' agent-view__prompt-rail-mark--active' : ''}`}
            style={{ ['--prompt-rail-mark-width' as string]: `${mark.width}px` }}
            aria-label={mark.label}
            aria-current={mark.isActive ? 'true' : undefined}
            onMouseEnter={() => handleMarkEnter(mark.id)}
            onFocus={() => handleMarkEnter(mark.id)}
            onClick={() => handleSelect(mark.id)}
          >
            <span className='agent-view__prompt-rail-mark-bar' aria-hidden='true' />
          </button>
        ))}
      </div>
      {preview
        ? createPortal(
            <div
              className={`agent-view__prompt-rail-preview overlay-popup overlay-popup--in overlay-popup--anchor-start${preview.attachments.length > 0 ? ' agent-view__prompt-rail-preview--interactive' : ''}`}
              style={{
                top: preview.top,
                left: preview.left,
              }}
              role='tooltip'
              onMouseEnter={handlePreviewEnter}
              onMouseLeave={handleRailLeave}
            >
              {preview.attachments.length > 0 ? (
                <div className='agent-view__prompt-rail-preview-attachments'>
                  {preview.attachments.map((attachment, index) => (
                    <button
                      key={attachment.id}
                      type='button'
                      className='agent-view__prompt-rail-preview-attachment app-button app-button--enter'
                      aria-label={attachment.label || `Imagem ${index + 1}`}
                      onClick={(event) => handleOpenAttachment(event, attachment.dataUrl)}
                    >
                      <AgentPromptImageIndexBadge index={index + 1} />
                      <img
                        src={attachment.dataUrl}
                        alt=''
                        className='agent-view__prompt-rail-preview-attachment-thumb'
                      />
                    </button>
                  ))}
                </div>
              ) : null}
              {preview.showSkillChip && preview.skillLabel ? (
                <div className='agent-view__prompt-rail-preview-skill'>
                  <div className='agent-view__user-skill agent-view__user-skill--skill'>
                    <BookOpen size={11} strokeWidth={2} aria-hidden='true' />
                    <span className='agent-view__user-skill-label'>{preview.skillLabel}</span>
                  </div>
                </div>
              ) : null}
              {preview.showTitle ? (
                <div
                  className='agent-view__prompt-rail-preview-title markdown-preview'
                  dangerouslySetInnerHTML={{ __html: preview.titleHtml }}
                />
              ) : null}
              {preview.bodyHtml ? (
                <div
                  className='agent-view__prompt-rail-preview-body markdown-preview'
                  dangerouslySetInnerHTML={{ __html: preview.bodyHtml }}
                />
              ) : null}
            </div>,
            document.body,
          )
        : null}
      {lightboxUrl ? (
        <AnimatedModal
          panelClassName='terminal-paste-image-lightbox'
          onClose={() => setLightboxUrl(null)}
        >
          {(requestClose) => (
            <button
              type='button'
              className='terminal-paste-image-lightbox__close app-button'
              aria-label='Fechar imagem'
              onClick={requestClose}
            >
              <img
                src={lightboxUrl}
                alt=''
                className='terminal-paste-image-lightbox__image'
                draggable={false}
              />
            </button>
          )}
        </AnimatedModal>
      ) : null}
    </>
  );
}

export const AgentPromptRail = memo(AgentPromptRailComponent);

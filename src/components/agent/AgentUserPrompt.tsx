import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BookOpen, Pencil, RotateCcw } from 'lucide-react';
import iconModeAsk from '@/assets/icon-mode-ask.svg';
import iconModeAgent from '@/assets/icon-mode-agent.svg';
import iconModeDebug from '@/assets/icon-mode-debug.svg';
import iconModeMultitask from '@/assets/icon-mode-multitask.svg';
import iconModePlan from '@/assets/icon-mode-plan.svg';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import {
  AgentPromptImageIndexBadge,
  AgentPromptImageMentionText,
} from '@/components/agent/AgentPromptImageBadges';
import { getAgentModeOption, type AgentModeBadgeIcon } from '@/constants/agentModes';
import { useFlipMotion } from '@/hooks/useFlipMotion';
import type { AgentTurn } from '@/types';
import { hydrateAgentUserMessage, resolvePromptDisplayContent } from '@/utils/agentPromptAttachments';
import { resolveAgentSkillDisplayState, isSkillOnlyPrompt, shouldShowSkillChipAbovePrompt } from '@/utils/agentSkillDisplay';

const MODE_ICON_SRC: Record<AgentModeBadgeIcon, string> = {
  'mode-agent': iconModeAgent,
  'mode-plan': iconModePlan,
  'mode-ask': iconModeAsk,
  'mode-debug': iconModeDebug,
  'mode-multitask': iconModeMultitask,
};

interface AgentUserPromptProps {
  turn: AgentTurn;
  projectPath: string;
  isEditing?: boolean;
  isStickyLayout?: boolean;
  onEdit?: (turnId: string) => void;
  onRedo?: (turnId: string) => void;
}

function AgentUserPromptComponent({
  turn,
  projectPath,
  isEditing = false,
  isStickyLayout = false,
  onEdit,
  onRedo,
}: AgentUserPromptProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [attachments, setAttachments] = useState(turn.user.attachments ?? []);
  const [bubbleContent, setBubbleContent] = useState(resolvePromptDisplayContent(turn.user.content));
  const modeOption = useMemo(() => {
    const mode = turn.user.mode;

    if (!mode || mode === 'agent') {
      return null;
    }

    return getAgentModeOption(mode) ?? null;
  }, [turn.user.mode]);
  const { hasSkillPrompt, skillChipLabel } = resolveAgentSkillDisplayState(turn.user);
  const isSkillOnly = isSkillOnlyPrompt(turn.user, bubbleContent, attachments.length);
  const showSkillChipAbove =
    hasSkillPrompt && !isSkillOnly && shouldShowSkillChipAbovePrompt(bubbleContent, skillChipLabel);
  const isMultilineBubble =
    !isSkillOnly && (bubbleContent.includes('\n') || bubbleContent.length > 72);
  const showBubble = Boolean(bubbleContent) && !isSkillOnly;
  const showSkillBadge = isSkillOnly && hasSkillPrompt;

  useEffect(() => {
    let cancelled = false;

    setAttachments(turn.user.attachments ?? []);
    setBubbleContent(resolvePromptDisplayContent(turn.user.content));

    void hydrateAgentUserMessage(projectPath, turn.user).then((next) => {
      if (cancelled) {
        return;
      }

      setAttachments(next.attachments ?? []);
      setBubbleContent(resolvePromptDisplayContent(next.content));
    });

    return () => {
      cancelled = true;
    };
  }, [projectPath, turn.id, turn.user]);

  const handleEditClick = useCallback(() => {
    onEdit?.(turn.id);
  }, [onEdit, turn.id]);

  const handleRedoClick = useCallback(() => {
    onRedo?.(turn.id);
  }, [onRedo, turn.id]);

  const showActions =
    !turn.running && !turn.pendingFollowUp && Boolean(onEdit || onRedo);

  useFlipMotion(isStickyLayout, actionsRef, showActions);

  return (
    <>
      <div
        className={`agent-view__user-prompt-wrap${isEditing ? ' agent-view__user-prompt-wrap--editing' : ''}`}
      >
        {isEditing ? (
          <span className='agent-view__user-editing-badge app-button--enter'>Editando</span>
        ) : turn.pendingFollowUp ? (
          <span className='agent-view__user-queued-badge app-button--enter'>Na fila</span>
        ) : null}
        {showSkillChipAbove ? (
          <div className='agent-view__user-skill agent-view__user-skill--skill'>
            <BookOpen size={11} strokeWidth={2} aria-hidden='true' />
            <span className='agent-view__user-skill-label'>{skillChipLabel}</span>
          </div>
        ) : null}
        {modeOption ? (
          <div
            className={`agent-view__user-mode agent-view__user-mode--${modeOption.id}`}
            style={{ '--mode-chip-accent': modeOption.badgeColor } as CSSProperties}
          >
            <span
              className='agent-view__user-mode-icon'
              style={{
                backgroundColor: modeOption.badgeColor,
                WebkitMaskImage: `url("${MODE_ICON_SRC[modeOption.badgeIcon]}")`,
                maskImage: `url("${MODE_ICON_SRC[modeOption.badgeIcon]}")`,
              }}
              aria-hidden='true'
            />
            <span className='agent-view__user-mode-label'>{modeOption.label}</span>
          </div>
        ) : null}
        <div
          className={`agent-view__user-prompt${turn.running ? ' agent-view__user-prompt--active' : ''}${turn.pendingFollowUp ? ' agent-view__user-prompt--pending' : ''}${isEditing ? ' agent-view__user-prompt--editing' : ''}${isMultilineBubble ? ' agent-view__user-prompt--multiline' : ''}${isSkillOnly ? ' agent-view__user-prompt--skill-only' : ''}`}
        >
          {showSkillBadge ? (
            <div className='agent-view__user-skill agent-view__user-skill--skill'>
              <BookOpen size={11} strokeWidth={2} aria-hidden='true' />
              <span className='agent-view__user-skill-label'>{skillChipLabel}</span>
            </div>
          ) : null}
          {showBubble ? (
            <div
              className={`agent-view__user-bubble${isMultilineBubble ? ' agent-view__user-bubble--multiline' : ''}${hasSkillPrompt && !showSkillChipAbove ? ' agent-view__user-bubble--skill' : ''}`}
            >
              <AgentPromptImageMentionText text={bubbleContent} />
            </div>
          ) : null}
          {attachments.length > 0 ? (
            <div className='agent-view__attachments'>
              {attachments.map((attachment, index) => (
                <button
                  key={attachment.id}
                  type='button'
                  className='agent-view__attachment app-button app-button--enter'
                  aria-label={attachment.label}
                  onClick={() => setPreviewUrl(attachment.dataUrl)}
                >
                  <AgentPromptImageIndexBadge index={index + 1} />
                  <img src={attachment.dataUrl} alt='' className='agent-view__attachment-thumb' />
                </button>
              ))}
            </div>
          ) : null}
          {showActions ? (
            <div ref={actionsRef} className='agent-view__user-prompt-actions'>
              {onEdit ? (
                <button
                  type='button'
                  className='agent-view__edit app-button app-button--enter'
                  aria-label='Editar prompt'
                  onClick={handleEditClick}
                >
                  <Pencil size={13} />
                </button>
              ) : null}
              {onRedo ? (
                <button
                  type='button'
                  className='agent-view__redo app-button app-button--enter'
                  aria-label='Refazer prompt'
                  onClick={handleRedoClick}
                >
                  <RotateCcw size={13} />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {previewUrl ? (
        <AnimatedModal panelClassName='terminal-paste-image-lightbox' onClose={() => setPreviewUrl(null)}>
          {(requestClose) => (
            <button
              type='button'
              className='terminal-paste-image-lightbox__close app-button'
              aria-label='Fechar imagem'
              onClick={requestClose}
            >
              <img
                src={previewUrl}
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

export const AgentUserPrompt = memo(AgentUserPromptComponent);

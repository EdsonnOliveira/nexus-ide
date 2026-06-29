import { memo, useCallback, useMemo, useState, type CSSProperties } from 'react';
import { BookOpen, Pencil, RotateCcw } from 'lucide-react';
import iconModeAsk from '@/assets/icon-mode-ask.svg';
import iconModeAgent from '@/assets/icon-mode-agent.svg';
import iconModeDebug from '@/assets/icon-mode-debug.svg';
import iconModeMultitask from '@/assets/icon-mode-multitask.svg';
import iconModePlan from '@/assets/icon-mode-plan.svg';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { getAgentModeOption, type AgentModeBadgeIcon } from '@/constants/agentModes';
import type { AgentTurn } from '@/types';

const MODE_ICON_SRC: Record<AgentModeBadgeIcon, string> = {
  'mode-agent': iconModeAgent,
  'mode-plan': iconModePlan,
  'mode-ask': iconModeAsk,
  'mode-debug': iconModeDebug,
  'mode-multitask': iconModeMultitask,
};

interface AgentUserPromptProps {
  turn: AgentTurn;
  isEditing?: boolean;
  onEdit?: (turnId: string) => void;
  onRedo?: (turnId: string) => void;
}

function AgentUserPromptComponent({
  turn,
  isEditing = false,
  onEdit,
  onRedo,
}: AgentUserPromptProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const attachments = turn.user.attachments ?? [];
  const modeOption = useMemo(() => {
    const mode = turn.user.mode;

    if (!mode || mode === 'agent') {
      return null;
    }

    return getAgentModeOption(mode) ?? null;
  }, [turn.user.mode]);
  const skillLabel = turn.user.skillLabel?.trim() ?? '';
  const bubbleContent = turn.user.content.trim();

  const handleEditClick = useCallback(() => {
    onEdit?.(turn.id);
  }, [onEdit, turn.id]);

  const handleRedoClick = useCallback(() => {
    onRedo?.(turn.id);
  }, [onRedo, turn.id]);

  const showActions = !turn.running && !turn.pendingFollowUp && (onEdit || onRedo);

  return (
    <>
      <div
        className={`agent-view__user-prompt-wrap${isEditing ? ' agent-view__user-prompt-wrap--editing' : ''}`}
      >
        {skillLabel ? (
          <div
            className='agent-view__user-skill'
            style={{ '--skill-chip-accent': '#8b5cf6' } as CSSProperties}
          >
            <BookOpen size={11} strokeWidth={2} aria-hidden='true' />
            <span className='agent-view__user-skill-label'>{skillLabel}</span>
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
          className={`agent-view__user-prompt${turn.running ? ' agent-view__user-prompt--active' : ''}${turn.pendingFollowUp ? ' agent-view__user-prompt--pending' : ''}${isEditing ? ' agent-view__user-prompt--editing' : ''}`}
        >
          {bubbleContent ? <div className='agent-view__user-bubble'>{bubbleContent}</div> : null}
          {attachments.length > 0 ? (
            <div className='agent-view__attachments'>
              {attachments.map((attachment) => (
                <button
                  key={attachment.id}
                  type='button'
                  className='agent-view__attachment app-button app-button--enter'
                  aria-label={attachment.label}
                  onClick={() => setPreviewUrl(attachment.dataUrl)}
                >
                  <img src={attachment.dataUrl} alt='' className='agent-view__attachment-thumb' />
                </button>
              ))}
            </div>
          ) : null}
          {showActions ? (
            <div className='agent-view__user-prompt-actions'>
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
        <AnimatedModal panelClassName='project-dialog' onClose={() => setPreviewUrl(null)}>
          {() => <img src={previewUrl} alt='' className='agent-view__attachment-preview' />}
        </AnimatedModal>
      ) : null}
    </>
  );
}

export const AgentUserPrompt = memo(AgentUserPromptComponent);

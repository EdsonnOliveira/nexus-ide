import { memo } from 'react';
import iconModeAgent from '@/assets/icon-mode-agent.svg';
import iconModeAsk from '@/assets/icon-mode-ask.svg';
import iconModeDebug from '@/assets/icon-mode-debug.svg';
import iconModeMultitask from '@/assets/icon-mode-multitask.svg';
import iconModePlan from '@/assets/icon-mode-plan.svg';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import {
  AGENT_MODE_OPTIONS,
  type AgentModeBadgeIcon,
  type AutomationAgentMode,
} from '@/constants/agentModes';

const AGENT_MODE_ICON_SRC: Record<AgentModeBadgeIcon, string> = {
  'mode-agent': iconModeAgent,
  'mode-plan': iconModePlan,
  'mode-debug': iconModeDebug,
  'mode-multitask': iconModeMultitask,
  'mode-ask': iconModeAsk,
};

interface TaskAgentModeModalProps {
  onClose: () => void;
  onSelect: (mode: AutomationAgentMode) => void;
}

function TaskAgentModeModalComponent({ onClose, onSelect }: TaskAgentModeModalProps) {
  return (
    <AnimatedModal onClose={onClose} panelClassName='project-dialog task-agent-mode-modal'>
      {(requestClose) => (
        <>
          <span className='project-dialog__title'>Modo do agent</span>
          <div className='task-agent-mode-modal__list'>
            {AGENT_MODE_OPTIONS.map((mode) => (
              <button
                key={mode.id}
                type='button'
                className='task-agent-mode-modal__item app-button app-button--enter'
                onClick={() => {
                  onSelect(mode.id);
                  requestClose();
                }}
              >
                <span
                  className='task-agent-mode-modal__badge'
                  style={{ backgroundColor: mode.badgeColor }}
                >
                  <img
                    src={AGENT_MODE_ICON_SRC[mode.badgeIcon]}
                    alt=''
                    className='task-agent-mode-modal__badge-icon'
                    draggable={false}
                  />
                </span>
                <span>{mode.label}</span>
              </button>
            ))}
          </div>
          <div className='project-dialog__actions'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--ghost app-button'
              onClick={requestClose}
            >
              Cancelar
            </button>
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

export const TaskAgentModeModal = memo(TaskAgentModeModalComponent);

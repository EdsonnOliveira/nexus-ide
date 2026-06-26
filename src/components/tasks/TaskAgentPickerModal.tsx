import { Bot } from 'lucide-react';
import { memo } from 'react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { EmptyState } from '@/components/overlay/EmptyState';
import type { OpenAgentPaneEntry } from '@/utils/collectOpenAgentPanes';

interface TaskAgentPickerModalProps {
  agents: OpenAgentPaneEntry[];
  onClose: () => void;
  onSelect: (paneId: string) => void;
}

function TaskAgentPickerModalComponent({ agents, onClose, onSelect }: TaskAgentPickerModalProps) {
  return (
    <AnimatedModal onClose={onClose} panelClassName='project-dialog task-agent-picker-modal'>
      {(requestClose) => (
        <>
          <span className='project-dialog__title'>Selecionar agent</span>
          {agents.length === 0 ? (
            <EmptyState icon={Bot} message='Nenhum agent aberto' compact />
          ) : (
            <div className='task-agent-picker-modal__list'>
              {agents.map((entry) => (
                <button
                  key={entry.pane.id}
                  type='button'
                  className='task-agent-picker-modal__item app-button app-button--enter'
                  onClick={() => {
                    onSelect(entry.pane.id);
                    requestClose();
                  }}
                >
                  <span
                    className='task-agent-picker-modal__badge'
                    style={{ backgroundColor: entry.badgeColor }}
                  >
                    {entry.badgeIndex}
                  </span>
                  <span>{entry.paneTitle}</span>
                </button>
              ))}
            </div>
          )}
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

export const TaskAgentPickerModal = memo(TaskAgentPickerModalComponent);

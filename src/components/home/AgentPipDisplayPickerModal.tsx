import { Monitor } from 'lucide-react';
import { memo } from 'react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { EmptyState } from '@/components/overlay/EmptyState';
import type { AgentPipDisplayInfo } from '@/types/agentPip';

interface AgentPipDisplayPickerModalProps {
  displays: AgentPipDisplayInfo[];
  onClose: () => void;
  onSelect: (displayId: number) => void;
}

function AgentPipDisplayPickerModalComponent({
  displays,
  onClose,
  onSelect,
}: AgentPipDisplayPickerModalProps) {
  return (
    <AnimatedModal onClose={onClose} panelClassName='project-dialog task-agent-picker-modal'>
      {(requestClose) => (
        <>
          <span className='project-dialog__title'>Selecionar tela</span>
          <p className='project-dialog__message'>
            Escolha em qual tela o agent vai ficar fixado.
          </p>
          {displays.length === 0 ? (
            <EmptyState icon={Monitor} message='Nenhuma tela encontrada' compact />
          ) : (
            <div className='task-agent-picker-modal__list'>
              {displays.map((display) => (
                <button
                  key={display.id}
                  type='button'
                  className='task-agent-picker-modal__item app-button app-button--enter'
                  onClick={() => {
                    onSelect(display.id);
                    requestClose();
                  }}
                >
                  <span
                    className='task-agent-picker-modal__badge'
                    style={{ backgroundColor: display.primary ? '#2563eb' : '#475569' }}
                    aria-hidden='true'
                  >
                    <Monitor size={11} strokeWidth={2.5} />
                  </span>
                  <span>
                    {display.label}
                    {display.primary ? ' · Principal' : ''}
                  </span>
                  <span className='agent-pip-display-picker__size'>
                    {display.width}×{display.height}
                  </span>
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

export const AgentPipDisplayPickerModal = memo(AgentPipDisplayPickerModalComponent);

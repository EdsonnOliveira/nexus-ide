import { memo, useCallback, useEffect } from 'react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';

export type MissionDeleteKind = 'agent' | 'node' | 'flow' | 'mission';

interface MissionDeleteConfirmDialogProps {
  kind: MissionDeleteKind;
  name: string;
  onConfirm: () => void;
  onClose: () => void;
}

const KIND_COPY: Record<
  MissionDeleteKind,
  { title: string; entity: string; suffix?: string }
> = {
  agent: { title: 'Apagar agent', entity: 'o agent' },
  node: { title: 'Apagar nó', entity: 'o nó' },
  flow: { title: 'Apagar fluxo', entity: 'o fluxo' },
  mission: {
    title: 'Apagar missão',
    entity: 'a missão',
    suffix: ' Ela será removida para sempre.',
  },
};

function MissionDeleteConfirmDialogComponent({
  kind,
  name,
  onConfirm,
  onClose,
}: MissionDeleteConfirmDialogProps) {
  const copy = KIND_COPY[kind];

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.stopImmediatePropagation();
      onClose();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  const handleConfirm = useCallback(
    (requestClose: () => void) => {
      onConfirm();
      requestClose();
    },
    [onConfirm],
  );

  return (
    <AnimatedModal onClose={onClose} panelClassName='project-dialog'>
      {(requestClose) => (
        <>
          <span className='project-dialog__title'>{copy.title}</span>
          <p className='project-dialog__message'>
            Tem certeza que deseja apagar {copy.entity} <strong>{name}</strong>? Esta ação não pode
            ser desfeita.
            {copy.suffix ? copy.suffix : null}
          </p>
          <div className='project-dialog__actions'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--ghost app-button'
              onClick={requestClose}
            >
              Cancelar
            </button>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--danger app-button app-button--enter'
              onClick={() => handleConfirm(requestClose)}
            >
              Apagar
            </button>
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

export const MissionDeleteConfirmDialog = memo(MissionDeleteConfirmDialogComponent);

import { memo, useCallback } from 'react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';

interface ProjectDeleteDialogProps {
  projectName: string;
  onConfirm: () => void;
  onClose: () => void;
}

function ProjectDeleteDialogComponent({
  projectName,
  onConfirm,
  onClose,
}: ProjectDeleteDialogProps) {
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
          <span className='project-dialog__title'>Excluir projeto</span>
          <p className='project-dialog__message'>
            Tem certeza que deseja excluir o projeto <strong>{projectName}</strong>? Esta ação não
            pode ser desfeita.
          </p>
          <div className='project-dialog__actions'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--ghost'
              onClick={requestClose}
            >
              Cancelar
            </button>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--danger'
              onClick={() => handleConfirm(requestClose)}
            >
              Excluir
            </button>
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

export const ProjectDeleteDialog = memo(ProjectDeleteDialogComponent);

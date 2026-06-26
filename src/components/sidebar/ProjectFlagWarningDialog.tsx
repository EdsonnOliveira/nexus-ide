import { memo, useCallback } from 'react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';

interface ProjectFlagWarningDialogProps {
  projectName: string;
  reason: string;
  onDismiss: () => void;
  onRemoveFlag: () => void;
  onClose: () => void;
}

function ProjectFlagWarningDialogComponent({
  projectName,
  reason,
  onDismiss,
  onRemoveFlag,
  onClose,
}: ProjectFlagWarningDialogProps) {
  const handleDismiss = useCallback(
    (requestClose: () => void) => {
      onDismiss();
      requestClose();
    },
    [onDismiss],
  );

  const handleRemoveFlag = useCallback(
    (requestClose: () => void) => {
      onRemoveFlag();
      requestClose();
    },
    [onRemoveFlag],
  );

  return (
    <AnimatedModal onClose={onClose} panelClassName='project-dialog project-flag-warning-dialog'>
      {(requestClose) => (
        <>
          <span className='project-dialog__title'>Projeto sinalizado</span>
          <p className='project-dialog__message'>
            O projeto <strong>{projectName}</strong> está sinalizado.
          </p>
          <div className='project-flag-warning-dialog__reason'>
            <span className='project-flag-warning-dialog__reason-label'>Motivo</span>
            <p className='project-flag-warning-dialog__reason-text'>{reason}</p>
          </div>
          <div className='project-dialog__actions'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--ghost app-button'
              onClick={() => handleDismiss(requestClose)}
            >
              Sair
            </button>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--primary app-button app-button--enter'
              onClick={() => handleRemoveFlag(requestClose)}
            >
              Remover Flag
            </button>
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

export const ProjectFlagWarningDialog = memo(ProjectFlagWarningDialogComponent);

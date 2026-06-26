import { memo, useCallback } from 'react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';

interface GitDiscardConfirmDialogProps {
  scope: 'file' | 'paths' | 'group';
  filePath?: string;
  pathCount?: number;
  groupLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}

function GitDiscardConfirmDialogComponent({
  scope,
  filePath,
  pathCount = 0,
  groupLabel,
  onConfirm,
  onClose,
}: GitDiscardConfirmDialogProps) {
  const handleConfirm = useCallback(
    (requestClose: () => void) => {
      onConfirm();
      requestClose();
    },
    [onConfirm],
  );

  const message =
    scope === 'group' ? (
      <>
        Tem certeza que deseja descartar todas as alterações do prompt{' '}
        <strong>&ldquo;{groupLabel}&rdquo;</strong>? Esta ação não pode ser desfeita.
      </>
    ) : scope === 'paths' ? (
      <>
        Tem certeza que deseja descartar as alterações nos{' '}
        <strong>{pathCount}</strong> arquivos selecionados? Esta ação não pode ser desfeita.
      </>
    ) : (
      <>
        Tem certeza que deseja descartar as alterações em <strong>{filePath}</strong>? Esta ação não
        pode ser desfeita.
      </>
    );

  return (
    <AnimatedModal onClose={onClose} panelClassName='project-dialog'>
      {(requestClose) => (
        <>
          <span className='project-dialog__title'>Descartar alterações?</span>
          <p className='project-dialog__message'>{message}</p>
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
              Descartar
            </button>
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

export const GitDiscardConfirmDialog = memo(GitDiscardConfirmDialogComponent);

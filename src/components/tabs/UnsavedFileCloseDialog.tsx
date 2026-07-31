import { memo, useCallback, useState } from 'react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';

export type UnsavedCloseSaveResult = boolean | 'continue';

interface UnsavedFileCloseDialogProps {
  fileName: string;
  onSave: () => Promise<UnsavedCloseSaveResult>;
  onDiscard: () => UnsavedCloseSaveResult;
  onClose: () => void;
}

function UnsavedFileCloseDialogComponent({
  fileName,
  onSave,
  onDiscard,
  onClose,
}: UnsavedFileCloseDialogProps) {
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(
    async (requestClose: () => void) => {
      if (isSaving) {
        return;
      }

      setIsSaving(true);
      const result = await onSave();
      setIsSaving(false);

      if (result === 'continue') {
        return;
      }

      if (result) {
        requestClose();
      }
    },
    [isSaving, onSave],
  );

  const handleDiscard = useCallback(
    (requestClose: () => void) => {
      if (isSaving) {
        return;
      }

      const result = onDiscard();

      if (result === 'continue') {
        return;
      }

      requestClose();
    },
    [isSaving, onDiscard],
  );

  const handleCancel = useCallback(
    (requestClose: () => void) => {
      if (isSaving) {
        return;
      }

      requestClose();
    },
    [isSaving],
  );

  return (
    <AnimatedModal
      onClose={onClose}
      closeDisabled={isSaving}
      panelClassName='project-dialog'
    >
      {(requestClose) => (
        <>
          <span className='project-dialog__title'>Alterações não salvas</span>
          <p className='project-dialog__message'>
            Deseja salvar as alterações em <strong>&ldquo;{fileName}&rdquo;</strong> antes de
            fechar?
          </p>
          <div className='project-dialog__actions'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--ghost app-button'
              disabled={isSaving}
              onClick={() => handleCancel(requestClose)}
            >
              Cancelar
            </button>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--danger app-button app-button--enter'
              disabled={isSaving}
              onClick={() => handleDiscard(requestClose)}
            >
              Não salvar
            </button>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--primary app-button app-button--enter'
              disabled={isSaving}
              onClick={() => {
                void handleSave(requestClose);
              }}
            >
              {isSaving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

export const UnsavedFileCloseDialog = memo(UnsavedFileCloseDialogComponent);

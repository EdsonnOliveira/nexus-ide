import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';

interface ProjectFlagCreateDialogProps {
  projectName: string;
  entityLabel?: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

function ProjectFlagCreateDialogComponent({
  projectName,
  entityLabel = 'projeto',
  onConfirm,
  onClose,
}: ProjectFlagCreateDialogProps) {
  const [reason, setReason] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(
    (requestClose: () => void) => (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const trimmed = reason.trim();

      if (!trimmed) {
        return;
      }

      onConfirm(trimmed);
      requestClose();
    },
    [onConfirm, reason],
  );

  return (
    <AnimatedModal onClose={onClose} panelClassName='project-dialog'>
      {(requestClose) => (
        <form onSubmit={handleSubmit(requestClose)}>
          <span className='project-dialog__title'>Criar flag</span>
          <p className='project-dialog__message'>
            Sinalizar {entityLabel === 'workspace' ? 'a workspace' : 'o projeto'}{' '}
            <strong>{projectName}</strong>
          </p>
          <label className='project-dialog__label'>
            Motivo
            <input
              ref={inputRef}
              className='project-dialog__input'
              value={reason}
              maxLength={256}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className='project-dialog__actions'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--ghost app-button'
              onClick={requestClose}
            >
              Cancelar
            </button>
            <button
              type='submit'
              className='project-dialog__btn project-dialog__btn--primary app-button app-button--enter'
            >
              Salvar
            </button>
          </div>
        </form>
      )}
    </AnimatedModal>
  );
}

export const ProjectFlagCreateDialog = memo(ProjectFlagCreateDialogComponent);

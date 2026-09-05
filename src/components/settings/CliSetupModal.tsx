import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { OpenCodeSetupSection } from '@/components/settings/OpenCodeSetupSection';
import { useToastStore } from '@/stores/useToastStore';
import type { CliSetupStatus } from '@/types';

function CliSetupModalComponent() {
  const showToast = useToastStore((state) => state.showToast);
  const [status, setStatus] = useState<CliSetupStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoInstallStartedRef = useRef(false);

  useEffect(() => {
    if (!window.nexus?.cliSetup) {
      return;
    }

    let cancelled = false;

    void window.nexus.cliSetup.getStatus().then((nextStatus) => {
      if (cancelled) {
        return;
      }

      setStatus(nextStatus);
      setOpen(nextStatus.shouldOfferSetup);
      setSelected(true);
    }).catch(() => {
      if (!cancelled) {
        setOpen(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleClose = useCallback(() => {
    if (installing) {
      return;
    }

    setOpen(false);
    void window.nexus?.cliSetup.dismissSetup();
  }, [installing]);

  const handleInstall = useCallback(async () => {
    if (!window.nexus?.cliSetup || installing) {
      return;
    }

    setInstalling(true);
    setError(null);

    try {
      const result = await window.nexus.cliSetup.installOpenCode();

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setStatus({
        opencodeInstalled: true,
        pendingInstall: false,
        shouldOfferSetup: false,
      });
      setOpen(false);
      showToast(result.alreadyInstalled ? 'OpenCode já estava instalado' : 'OpenCode instalado');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível baixar o OpenCode');
    } finally {
      setInstalling(false);
    }
  }, [installing, showToast]);

  useEffect(() => {
    if (
      !open ||
      !status?.pendingInstall ||
      installing ||
      status.opencodeInstalled ||
      autoInstallStartedRef.current
    ) {
      return;
    }

    autoInstallStartedRef.current = true;
    void handleInstall();
  }, [handleInstall, installing, open, status]);

  const handleConfirm = useCallback(() => {
    if (!selected || status?.opencodeInstalled) {
      handleClose();
      return;
    }

    void handleInstall();
  }, [handleClose, handleInstall, selected, status?.opencodeInstalled]);

  if (!open) {
    return null;
  }

  return (
    <AnimatedModal
      panelClassName='project-dialog settings-modal settings-modal--setup'
      closeDisabled={installing}
      onClose={handleClose}
    >
      {(requestClose) => (
        <div className='settings-modal__content'>
          <div className='settings-modal__header'>
            <span className='project-dialog__title settings-modal__title'>Configurar IAs</span>
          </div>
          <div className='settings-modal__body' role='dialog' aria-label='Configurar IAs'>
            <OpenCodeSetupSection
              status={status}
              installing={installing}
              error={error}
              selectable
              selected={selected}
              onSelectedChange={setSelected}
              onInstall={() => undefined}
            />
          </div>
          <div className='project-dialog__actions'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--ghost app-button app-button--enter'
              disabled={installing}
              onClick={requestClose}
            >
              Agora não
            </button>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--primary app-button app-button--enter'
              disabled={installing || (!selected && !status?.opencodeInstalled)}
              onClick={handleConfirm}
            >
              {installing ? 'Baixando...' : selected ? 'Baixar OpenCode' : 'Continuar'}
            </button>
          </div>
        </div>
      )}
    </AnimatedModal>
  );
}

export const CliSetupModal = memo(CliSetupModalComponent);

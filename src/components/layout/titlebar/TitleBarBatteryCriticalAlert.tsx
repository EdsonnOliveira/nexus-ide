import { BatteryWarning, X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface TitleBarBatteryCriticalAlertProps {
  batteryLevel: number;
  onDismiss: () => void;
}

function TitleBarBatteryCriticalAlertComponent({
  batteryLevel,
  onDismiss,
}: TitleBarBatteryCriticalAlertProps) {
  const [animationClass, setAnimationClass] = useState('overlay-backdrop--in');
  const panelRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    setAnimationClass('overlay-backdrop--out');
  }, []);

  useEffect(() => {
    if (animationClass !== 'overlay-backdrop--out') {
      return;
    }

    const timer = setTimeout(() => {
      onDismiss();
    }, 180);

    return () => {
      clearTimeout(timer);
    };
  }, [animationClass, onDismiss]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleClose]);

  const handleBackdropClick = useCallback(
    (event: React.MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        handleClose();
      }
    },
    [handleClose],
  );

  return createPortal(
    <div
      className={`titlebar-battery-alert__overlay ${animationClass}`}
      role='alertdialog'
      aria-label='Bateria crítica'
      onClick={handleBackdropClick}
    >
      <div ref={panelRef} className='titlebar-battery-alert__panel overlay-panel--in'>
        <button
          type='button'
          className='titlebar-battery-alert__close app-button'
          aria-label='Fechar'
          onClick={handleClose}
        >
          <X size={14} />
        </button>
        <BatteryWarning size={36} strokeWidth={1.5} className='titlebar-battery-alert__icon' />
        <span className='titlebar-battery-alert__title'>Bateria baixa</span>
        <span className='titlebar-battery-alert__message'>
          Restam {batteryLevel}%. Conecte o carregador para evitar perda de trabalho.
        </span>
        <button
          type='button'
          className='titlebar-battery-alert__dismiss app-button'
          onClick={handleClose}
        >
          Entendi
        </button>
      </div>
    </div>,
    document.body,
  );
}

export const TitleBarBatteryCriticalAlert = memo(TitleBarBatteryCriticalAlertComponent);

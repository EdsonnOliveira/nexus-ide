import { Check } from 'lucide-react';
import { memo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { OVERLAY_POPUP_DURATION_MS, useAnimatedUnmount } from '@/hooks/useAnimatedUnmount';
import { useToastStore } from '@/stores/useToastStore';

const TOAST_VISIBLE_MS = 3200;

interface AppToastItemProps {
  id: string;
  message: string;
  onDismiss: () => void;
}

function AppToastItemComponent({ id, message, onDismiss }: AppToastItemProps) {
  const { phase, requestClose } = useAnimatedUnmount(onDismiss, OVERLAY_POPUP_DURATION_MS);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      requestClose();
    }, TOAST_VISIBLE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [id, requestClose]);

  return createPortal(
    <div className='app-toast-host' role='presentation'>
      <div className={`app-toast overlay-popup--${phase}`} role='status' aria-live='polite'>
        <span className='app-toast__icon' aria-hidden='true'>
          <Check size={14} strokeWidth={2.5} />
        </span>
        <span className='app-toast__message'>{message}</span>
      </div>
    </div>,
    document.body,
  );
}

const AppToastItem = memo(AppToastItemComponent);

function AppToastHostComponent() {
  const toast = useToastStore((state) => state.toast);
  const dismissToast = useToastStore((state) => state.dismissToast);

  if (!toast) {
    return null;
  }

  return (
    <AppToastItem
      key={toast.id}
      id={toast.id}
      message={toast.message}
      onDismiss={() => dismissToast(toast.id)}
    />
  );
}

export const AppToastHost = memo(AppToastHostComponent);

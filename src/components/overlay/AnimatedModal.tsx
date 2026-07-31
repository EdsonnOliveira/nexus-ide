import { memo, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { OVERLAY_MODAL_DURATION_MS, useAnimatedUnmount } from '@/hooks/useAnimatedUnmount';
import { registerModalOpen } from '@/utils/overlayBlocking';

interface AnimatedModalProps {
  panelClassName: string;
  onClose: () => void;
  closeDisabled?: boolean;
  children: (requestClose: () => void) => ReactNode;
}

function AnimatedModalComponent({
  panelClassName,
  onClose,
  closeDisabled = false,
  children,
}: AnimatedModalProps) {
  const { phase, requestClose } = useAnimatedUnmount(onClose, OVERLAY_MODAL_DURATION_MS);

  useEffect(() => registerModalOpen(), []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !closeDisabled) {
        requestClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeDisabled, requestClose]);

  return createPortal(
    <div
      className={`project-dialog-overlay overlay-backdrop--${phase}`}
      onMouseDown={closeDisabled ? undefined : requestClose}
    >
      <div
        className={`${panelClassName} overlay-panel--${phase}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children(requestClose)}
      </div>
    </div>,
    document.body,
  );
}

export const AnimatedModal = memo(AnimatedModalComponent);

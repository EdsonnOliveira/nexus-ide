import { useCallback, useEffect, useRef, useState } from 'react';

export type OverlayAnimationPhase = 'in' | 'out';

export const OVERLAY_MODAL_DURATION_MS = 220;
export const OVERLAY_POPUP_DURATION_MS = 220;

export function useAnimatedUnmount(onClose: () => void, durationMs = OVERLAY_POPUP_DURATION_MS) {
  const [phase, setPhase] = useState<OverlayAnimationPhase>('in');
  const onCloseRef = useRef(onClose);

  onCloseRef.current = onClose;

  const requestClose = useCallback(() => {
    setPhase((current) => (current === 'out' ? current : 'out'));
  }, []);

  const resetPhase = useCallback(() => {
    setPhase('in');
  }, []);

  useEffect(() => {
    if (phase !== 'out') {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      onCloseRef.current();
    }, durationMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [durationMs, phase]);

  return { phase, requestClose, resetPhase };
}

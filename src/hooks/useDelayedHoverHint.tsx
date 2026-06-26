import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';

const DEFAULT_DELAY_MS = 1000;

interface HintPosition {
  left: number;
  top: number;
}

function resolveHintPosition(rect: DOMRect): HintPosition {
  const maxWidth = 360;
  const margin = 8;
  const left = Math.min(Math.max(rect.left, margin), window.innerWidth - maxWidth - margin);
  const top = Math.min(rect.bottom + 6, window.innerHeight - margin);

  return { left, top };
}

export function useDelayedHoverHint(text: string, delayMs = DEFAULT_DELAY_MS) {
  const [position, setPosition] = useState<HintPosition | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onMouseEnter = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!text.trim()) {
        return;
      }

      clearTimer();
      const rect = event.currentTarget.getBoundingClientRect();

      timerRef.current = window.setTimeout(() => {
        setPosition(resolveHintPosition(rect));
      }, delayMs);
    },
    [clearTimer, delayMs, text],
  );

  const onMouseLeave = useCallback(() => {
    clearTimer();
    setPosition(null);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  const hintNode =
    position && text.trim()
      ? createPortal(
          <div
            className='delayed-hover-hint overlay-popup--in'
            style={{ left: position.left, top: position.top }}
            role='tooltip'
          >
            {text}
          </div>,
          document.body,
        )
      : null;

  return {
    onMouseEnter,
    onMouseLeave,
    hintNode,
  };
}

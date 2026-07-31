import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { isImageFileName } from '@/utils/fileViewMode';

const DEFAULT_DELAY_MS = 1000;
const IMAGE_PREVIEW_MAX_WIDTH = 280;
const IMAGE_PREVIEW_MAX_HEIGHT = 220;
const HINT_TEXT_MAX_WIDTH = 360;

interface HintPosition {
  left: number;
  top: number;
}

interface DelayedHoverHintOptions {
  imagePath?: string | null;
}

function resolveHintPosition(
  rect: DOMRect,
  options?: { hasImage?: boolean },
): HintPosition {
  const maxWidth = options?.hasImage ? IMAGE_PREVIEW_MAX_WIDTH + 24 : HINT_TEXT_MAX_WIDTH;
  const estimatedHeight = options?.hasImage ? IMAGE_PREVIEW_MAX_HEIGHT + 48 : 40;
  const margin = 8;
  const left = Math.min(Math.max(rect.left, margin), window.innerWidth - maxWidth - margin);
  const belowTop = rect.bottom + 6;
  const aboveTop = rect.top - estimatedHeight - 6;
  const top =
    belowTop + estimatedHeight <= window.innerHeight - margin
      ? belowTop
      : Math.max(margin, aboveTop);

  return { left, top };
}

export function useDelayedHoverHint(
  text: string,
  delayMs = DEFAULT_DELAY_MS,
  options?: DelayedHoverHintOptions,
) {
  const imagePath = options?.imagePath?.trim() || null;
  const showImagePreview = Boolean(imagePath && isImageFileName(imagePath));
  const [position, setPosition] = useState<HintPosition | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null | undefined>(undefined);
  const timerRef = useRef<number | null>(null);
  const loadIdRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearPreview = useCallback(() => {
    loadIdRef.current += 1;
    setImageSrc(undefined);
    setPosition(null);
  }, []);

  const onMouseEnter = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!text.trim() && !showImagePreview) {
        return;
      }

      clearTimer();
      const rect = event.currentTarget.getBoundingClientRect();
      const loadId = loadIdRef.current + 1;
      loadIdRef.current = loadId;

      if (showImagePreview && imagePath && window.nexus?.files?.readImageAsDataUrl) {
        setImageSrc(undefined);
        void window.nexus.files.readImageAsDataUrl(imagePath).then((dataUrl) => {
          if (loadIdRef.current !== loadId) {
            return;
          }

          setImageSrc(dataUrl);
        });
      } else {
        setImageSrc(null);
      }

      timerRef.current = window.setTimeout(() => {
        if (loadIdRef.current !== loadId) {
          return;
        }

        setPosition(resolveHintPosition(rect, { hasImage: showImagePreview }));
      }, delayMs);
    },
    [clearTimer, delayMs, imagePath, showImagePreview, text],
  );

  const onMouseLeave = useCallback(() => {
    clearTimer();
    clearPreview();
  }, [clearPreview, clearTimer]);

  useEffect(() => {
    return () => {
      clearTimer();
      loadIdRef.current += 1;
    };
  }, [clearTimer]);

  useEffect(() => {
    clearPreview();
  }, [clearPreview, imagePath, text]);

  const hintNode =
    position && (text.trim() || showImagePreview)
      ? createPortal(
          <div
            className={`delayed-hover-hint overlay-popup--in${showImagePreview ? ' delayed-hover-hint--image' : ''}`}
            style={{ left: position.left, top: position.top }}
            role='tooltip'
          >
            {showImagePreview && imageSrc !== null ? (
              <div className='delayed-hover-hint__preview'>
                {imageSrc ? (
                  <img src={imageSrc} alt='' className='delayed-hover-hint__image' draggable={false} />
                ) : (
                  <div className='delayed-hover-hint__loading' aria-hidden='true' />
                )}
              </div>
            ) : null}
            {text.trim() ? <div className='delayed-hover-hint__text'>{text}</div> : null}
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

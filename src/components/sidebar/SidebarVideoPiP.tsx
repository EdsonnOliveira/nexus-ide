import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Move, RotateCcw, X } from 'lucide-react';
import { MusicMarqueeLine } from '@/components/sidebar/SidebarMusicPlayer';
import {
  SIDEBAR_VIDEO_PROVIDER_LABELS,
  type SidebarVideoSession,
} from '@/utils/sidebarVideoProviders';

interface SidebarVideoPiPProps {
  session: SidebarVideoSession;
  onClose: () => void;
}

interface PiPPosition {
  x: number;
  y: number;
}

interface PiPSize {
  width: number;
  height: number;
}

interface DragOffset {
  x: number;
  y: number;
}

interface ResizeState {
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
}

const FLOATING_WIDTH = 320;
const MIN_WIDTH = 220;
const MIN_HEIGHT = 160;
const MAX_WIDTH_RATIO = 0.92;
const MAX_HEIGHT_RATIO = 0.88;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function SidebarVideoPiPComponent({ session, onClose }: SidebarVideoPiPProps) {
  const pipRef = useRef<HTMLElement>(null);
  const dragOffsetRef = useRef<DragOffset | null>(null);
  const resizeStateRef = useRef<ResizeState | null>(null);
  const [isFloating, setIsFloating] = useState(false);
  const [position, setPosition] = useState<PiPPosition | null>(null);
  const [customSize, setCustomSize] = useState<PiPSize | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const providerLabel = SIDEBAR_VIDEO_PROVIDER_LABELS[session.provider];
  const isCustomized = isFloating || customSize !== null;
  const displayTitle = session.title.trim() || providerLabel;

  useEffect(() => {
    setIsFloating(false);
    setPosition(null);
    setCustomSize(null);
    setIsDragging(false);
    setIsResizing(false);
    dragOffsetRef.current = null;
    resizeStateRef.current = null;
  }, [session.sourceUrl]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleReset = useCallback(() => {
    setIsFloating(false);
    setPosition(null);
    setCustomSize(null);
    setIsDragging(false);
    setIsResizing(false);
    dragOffsetRef.current = null;
    resizeStateRef.current = null;
  }, []);

  const getCurrentRect = useCallback((): DOMRect | null => {
    return pipRef.current?.getBoundingClientRect() ?? null;
  }, []);

  const updateFloatingPosition = useCallback(
    (clientX: number, clientY: number) => {
      const offset = dragOffsetRef.current;
      const pip = pipRef.current;

      if (!offset || !pip) {
        return;
      }

      const width = pip.offsetWidth || customSize?.width || FLOATING_WIDTH;
      const height = pip.offsetHeight || customSize?.height || MIN_HEIGHT;

      setPosition({
        x: clamp(clientX - offset.x, 8, window.innerWidth - width - 8),
        y: clamp(clientY - offset.y, 8, window.innerHeight - height - 8),
      });
    },
    [customSize?.height, customSize?.width],
  );

  const handleMovePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();

      const rect = getCurrentRect();

      if (!rect) {
        return;
      }

      if (!isFloating) {
        setPosition({ x: rect.left, y: rect.top });
        setCustomSize((current) => current ?? { width: rect.width, height: rect.height });
        setIsFloating(true);
      }

      dragOffsetRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      setIsDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [getCurrentRect, isFloating],
  );

  const handleMovePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!dragOffsetRef.current) {
        return;
      }

      updateFloatingPosition(event.clientX, event.clientY);
    },
    [updateFloatingPosition],
  );

  const handleMovePointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    dragOffsetRef.current = null;
    setIsDragging(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const rect = getCurrentRect();

      if (!rect) {
        return;
      }

      const shouldFloat = isFloating || Math.abs(event.movementX) > 0;

      if (!isFloating && event.pointerType !== 'touch') {
        const startWidth = rect.width;
        const startHeight = rect.height;

        resizeStateRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          startWidth,
          startHeight,
        };
        setIsResizing(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }

      if (!isFloating) {
        setPosition({ x: rect.left, y: rect.top });
        setIsFloating(true);
      }

      resizeStateRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        startWidth: customSize?.width ?? rect.width,
        startHeight: customSize?.height ?? rect.height,
      };

      if (shouldFloat && !customSize) {
        setCustomSize({ width: rect.width, height: rect.height });
      }

      setIsResizing(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [customSize, getCurrentRect, isFloating],
  );

  const handleResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const state = resizeStateRef.current;

      if (!state) {
        return;
      }

      const deltaX = event.clientX - state.startX;
      const deltaY = event.clientY - state.startY;
      const maxWidth = window.innerWidth * MAX_WIDTH_RATIO;
      const maxHeight = window.innerHeight * MAX_HEIGHT_RATIO;

      if (isFloating) {
        const nextWidth = clamp(state.startWidth + deltaX, MIN_WIDTH, maxWidth);
        const nextHeight = clamp(state.startHeight + deltaY, MIN_HEIGHT, maxHeight);

        setCustomSize({ width: nextWidth, height: nextHeight });

        if (position) {
          setPosition({
            x: clamp(position.x, 8, window.innerWidth - nextWidth - 8),
            y: clamp(position.y, 8, window.innerHeight - nextHeight - 8),
          });
        }

        return;
      }

      const nextHeight = clamp(state.startHeight + deltaY, MIN_HEIGHT, maxHeight);

      if (Math.abs(deltaX) > 12) {
        const rect = getCurrentRect();

        if (rect) {
          setPosition({ x: rect.left, y: rect.top });
          setIsFloating(true);
          setCustomSize({
            width: clamp(state.startWidth + deltaX, MIN_WIDTH, maxWidth),
            height: nextHeight,
          });
          return;
        }
      }

      setCustomSize({
        width: state.startWidth,
        height: nextHeight,
      });
    },
    [getCurrentRect, isFloating, position],
  );

  const handleResizePointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    resizeStateRef.current = null;
    setIsResizing(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const pipStyle = useMemo(() => {
    if (isFloating && position) {
      return {
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${customSize?.width ?? FLOATING_WIDTH}px`,
        height: `${customSize?.height ?? MIN_HEIGHT}px`,
      };
    }

    if (customSize) {
      return {
        height: `${customSize.height}px`,
      };
    }

    return undefined;
  }, [customSize, isFloating, position]);

  const pipNode = (
    <section
      ref={pipRef}
      className={`sidebar-video-pip app-button--enter${isFloating ? ' sidebar-video-pip--portaled sidebar-video-pip--floating' : ''}${customSize ? ' sidebar-video-pip--custom-size' : ''}${isDragging ? ' sidebar-video-pip--dragging' : ''}${isResizing ? ' sidebar-video-pip--resizing' : ''}`}
      style={pipStyle}
      aria-label={`PiP ${providerLabel}`}
    >
      <div className='sidebar-video-pip__header'>
        <div className='sidebar-video-pip__meta'>
          <span className='sidebar-video-pip__eyebrow'>Rodando agora</span>
          <MusicMarqueeLine text={displayTitle} className='sidebar-video-pip__title' />
        </div>
        <div className='sidebar-video-pip__actions'>
          {isCustomized ? (
            <button
              type='button'
              className='sidebar-video-pip__action app-button app-button--enter'
              aria-label='Voltar para posição padrão'
              title='Voltar para posição padrão'
              onClick={handleReset}
            >
              <RotateCcw size={14} strokeWidth={2} />
            </button>
          ) : null}
          <button
            type='button'
            className={`sidebar-video-pip__action sidebar-video-pip__move app-button app-button--enter${isDragging ? ' sidebar-video-pip__move--dragging' : ''}`}
            aria-label='Mover PiP'
            title='Mover PiP'
            onPointerDown={handleMovePointerDown}
            onPointerMove={handleMovePointerMove}
            onPointerUp={handleMovePointerUp}
            onPointerCancel={handleMovePointerUp}
          >
            <Move size={14} strokeWidth={2} />
          </button>
          <button
            type='button'
            className='sidebar-video-pip__action app-button app-button--enter'
            aria-label='Fechar PiP'
            title='Fechar PiP'
            onClick={handleClose}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className='sidebar-video-pip__viewport'>
        {session.useEmbed ? (
          <iframe
            className='sidebar-video-pip__frame'
            src={session.playbackUrl}
            title={displayTitle}
            allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
            allowFullScreen
          />
        ) : (
          <webview
            className='sidebar-video-pip__frame'
            src={session.playbackUrl}
            allowpopups
            webpreferences='contextIsolation=yes,javascript=yes,sandbox=no'
          />
        )}
      </div>
      <button
        type='button'
        className='sidebar-video-pip__resize app-button app-button--enter'
        aria-label='Redimensionar PiP'
        title='Redimensionar PiP'
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
        onPointerCancel={handleResizePointerUp}
      />
    </section>
  );

  if (isFloating) {
    return createPortal(pipNode, document.body);
  }

  return pipNode;
}

export const SidebarVideoPiP = memo(SidebarVideoPiPComponent);

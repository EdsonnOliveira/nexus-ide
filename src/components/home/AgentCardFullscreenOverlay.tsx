import { memo, useCallback, useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { OVERLAY_MODAL_DURATION_MS, useAnimatedUnmount } from '@/hooks/useAnimatedUnmount';
import { registerModalOpen } from '@/utils/overlayBlocking';

export function useAgentCardFullscreen() {
  const [open, setOpen] = useState(false);
  const [slotNode, setSlotNode] = useState<HTMLDivElement | null>(null);
  const [dialogNode, setDialogNode] = useState<HTMLDivElement | null>(null);
  const { phase, requestClose, resetPhase } = useAnimatedUnmount(
    () => setOpen(false),
    OVERLAY_MODAL_DURATION_MS,
  );

  const openFullscreen = useCallback(() => {
    resetPhase();
    setOpen(true);
  }, [resetPhase]);

  const portalTarget = open && dialogNode ? dialogNode : slotNode;

  return {
    open,
    phase,
    setSlotNode,
    setDialogNode,
    portalTarget,
    openFullscreen,
    closeFullscreen: requestClose,
  };
}

interface AgentCardFullscreenOverlayProps {
  phase: 'in' | 'out';
  onDialogNode: (node: HTMLDivElement | null) => void;
  onClose: () => void;
}

function AgentCardFullscreenOverlayComponent({
  phase,
  onDialogNode,
  onClose,
}: AgentCardFullscreenOverlayProps) {
  useEffect(() => registerModalOpen(), []);

  return createPortal(
    <div className={`project-dialog-overlay overlay-backdrop--${phase}`} onMouseDown={onClose}>
      <div
        ref={onDialogNode}
        className={`project-dialog home-dashboard__agent-modal overlay-panel--${phase}`}
        role='dialog'
        aria-label='Agent em tela cheia'
        onMouseDown={(event) => event.stopPropagation()}
      />
    </div>,
    document.body,
  );
}

const AgentCardFullscreenOverlay = memo(AgentCardFullscreenOverlayComponent);

interface AgentCardFrameProps {
  className: string;
  style?: CSSProperties;
  fullscreen: ReturnType<typeof useAgentCardFullscreen>;
  children: ReactNode;
  onMouseDown?: (event: MouseEvent) => void;
  dataHomeAgentPane?: string;
}

function AgentCardFrameComponent({
  className,
  style,
  fullscreen,
  children,
  onMouseDown,
  dataHomeAgentPane,
}: AgentCardFrameProps) {
  const card = (
    <article
      className={`${className}${fullscreen.open ? ' home-dashboard__agent-card--modal' : ''}`}
      style={style}
      onMouseDown={onMouseDown}
    >
      {children}
    </article>
  );

  return (
    <>
      <div
        ref={fullscreen.setSlotNode}
        className='home-dashboard__agent-card-host'
        data-home-agent-pane={dataHomeAgentPane}
      />
      {fullscreen.open ? (
        <AgentCardFullscreenOverlay
          phase={fullscreen.phase}
          onDialogNode={fullscreen.setDialogNode}
          onClose={fullscreen.closeFullscreen}
        />
      ) : null}
      {fullscreen.portalTarget ? createPortal(card, fullscreen.portalTarget) : null}
    </>
  );
}

export const AgentCardFrame = memo(AgentCardFrameComponent);

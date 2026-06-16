import { memo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePaneSlotRegistry } from '@/components/workspace/PaneSlotRegistry';

interface PanePortalProps {
  paneId: string;
  children: ReactNode;
}

function PanePortalComponent({ paneId, children }: PanePortalProps) {
  const { getSlot, version } = usePaneSlotRegistry();
  void version;
  const slot = getSlot(paneId);
  const [fallbackHost, setFallbackHost] = useState<HTMLDivElement | null>(null);
  const portalTarget = slot ?? fallbackHost;

  return (
    <>
      <div ref={setFallbackHost} className='workspace-pane-pool' aria-hidden='true' />
      {portalTarget ? createPortal(children, portalTarget) : null}
    </>
  );
}

export const PanePortal = memo(PanePortalComponent);

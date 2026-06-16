import { memo, useCallback, useRef } from 'react';
import { usePaneSlotRegistry } from '@/components/workspace/PaneSlotRegistry';

interface PaneSlotProps {
  paneId: string;
}

function PaneSlotComponent({ paneId }: PaneSlotProps) {
  const { register, unregister } = usePaneSlotRegistry();
  const ownerRef = useRef<HTMLDivElement | null>(null);

  const handleRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) {
        ownerRef.current = node;
        register(paneId, node);
        return;
      }

      if (ownerRef.current) {
        unregister(paneId, ownerRef.current);
        ownerRef.current = null;
      }
    },
    [paneId, register, unregister],
  );

  return <div ref={handleRef} className='workspace-pane workspace-pane--slot' />;
}

export const PaneSlot = memo(PaneSlotComponent);

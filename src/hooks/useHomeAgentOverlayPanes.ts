import { useSyncExternalStore } from 'react';
import { getHomeAgentOverlayPaneIds, subscribeHomeAgentOverlay } from '@/utils/homeAgentOverlay';

const EMPTY_OVERLAY_PANE_IDS: ReadonlySet<string> = new Set();

function getServerOverlayPaneIds(): ReadonlySet<string> {
  return EMPTY_OVERLAY_PANE_IDS;
}

export function useHomeAgentOverlayPaneIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribeHomeAgentOverlay,
    getHomeAgentOverlayPaneIds,
    getServerOverlayPaneIds,
  );
}

export function useIsHomeAgentOverlayPane(paneId: string): boolean {
  const overlayPaneIds = useHomeAgentOverlayPaneIds();
  return overlayPaneIds.has(paneId);
}

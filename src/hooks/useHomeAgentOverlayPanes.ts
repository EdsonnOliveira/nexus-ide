import { useSyncExternalStore } from 'react';
import {
  getHomeAgentOverlayPaneIds,
  subscribeHomeAgentOverlay,
} from '@/utils/homeAgentOverlay';

const EMPTY_OVERLAY_PANE_IDS: ReadonlySet<string> = new Set();

export function useHomeAgentOverlayPaneIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribeHomeAgentOverlay,
    getHomeAgentOverlayPaneIds,
    () => EMPTY_OVERLAY_PANE_IDS,
  );
}

export function useIsHomeAgentOverlayPane(paneId: string): boolean {
  const overlayPaneIds = useHomeAgentOverlayPaneIds();
  return overlayPaneIds.has(paneId);
}

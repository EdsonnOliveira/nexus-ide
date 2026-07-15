const EMPTY_OVERLAY_PANE_IDS: ReadonlySet<string> = new Set();

let overlayPaneIds: ReadonlySet<string> = EMPTY_OVERLAY_PANE_IDS;
const listeners = new Set<() => void>();

function samePaneIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const paneId of left) {
    if (!right.has(paneId)) {
      return false;
    }
  }

  return true;
}

function emitHomeAgentOverlayChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function setHomeAgentOverlayPaneIds(paneIds: readonly string[]): void {
  const next =
    paneIds.length === 0 ? EMPTY_OVERLAY_PANE_IDS : new Set(paneIds.filter(Boolean));

  if (samePaneIds(overlayPaneIds, next)) {
    return;
  }

  overlayPaneIds = next;
  emitHomeAgentOverlayChange();
}

export function setHomeAgentOverlayPaneId(paneId: string | null): void {
  setHomeAgentOverlayPaneIds(paneId ? [paneId] : []);
}

export function getHomeAgentOverlayPaneIds(): ReadonlySet<string> {
  return overlayPaneIds;
}

export function getHomeAgentOverlayPaneId(): string | null {
  const [first] = overlayPaneIds;
  return first ?? null;
}

export function isHomeAgentOverlayPane(paneId: string): boolean {
  return overlayPaneIds.has(paneId);
}

export function subscribeHomeAgentOverlay(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

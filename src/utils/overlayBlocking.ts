let anchoredDropdownOpenCount = 0;
let modalOpenCount = 0;
const listeners = new Set<() => void>();

function notifyOverlayBlockingChange(): void {
  listeners.forEach((listener) => listener());
}

export function registerAnchoredDropdownOpen(): () => void {
  anchoredDropdownOpenCount += 1;
  notifyOverlayBlockingChange();

  return () => {
    anchoredDropdownOpenCount = Math.max(0, anchoredDropdownOpenCount - 1);
    notifyOverlayBlockingChange();
  };
}

export function registerModalOpen(): () => void {
  modalOpenCount += 1;
  notifyOverlayBlockingChange();

  return () => {
    modalOpenCount = Math.max(0, modalOpenCount - 1);
    notifyOverlayBlockingChange();
  };
}

export function isOverlayBlockingTerminalHints(): boolean {
  return anchoredDropdownOpenCount > 0 || modalOpenCount > 0;
}

export function subscribeOverlayBlockingChange(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

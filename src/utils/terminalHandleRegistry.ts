import type { XTermViewHandle } from '@/components/terminal/XTermView';

const terminalHandles = new Map<string, XTermViewHandle>();

export function registerTerminalHandle(paneId: string, handle: XTermViewHandle | null): void {
  if (handle) {
    terminalHandles.set(paneId, handle);
    return;
  }

  terminalHandles.delete(paneId);
}

export function getTerminalHandle(paneId: string): XTermViewHandle | null {
  return terminalHandles.get(paneId) ?? null;
}

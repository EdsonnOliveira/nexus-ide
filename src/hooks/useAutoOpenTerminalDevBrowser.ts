import { useEffect, useRef } from 'react';
import { useTabActions } from '@/stores/useTabStore';
import { findProjectIdByPtyId } from '@/utils/findProjectIdByPaneId';
import { extractTerminalLocalDevReadyUrls } from '@/utils/terminalUrlExtract';

const BUFFER_LIMIT = 4000;
const DEDUPE_MS = 10_000;

export function useAutoOpenTerminalDevBrowser(enabled: boolean): void {
  const { openBrowserTab } = useTabActions();
  const openBrowserTabRef = useRef(openBrowserTab);
  const buffersRef = useRef(new Map<string, string>());
  const openedAtRef = useRef(new Map<string, number>());

  openBrowserTabRef.current = openBrowserTab;

  useEffect(() => {
    if (!enabled || !window.nexus?.terminal?.onData) {
      return;
    }

    const unsubscribe = window.nexus.terminal.onData((ptyId, data) => {
      const previous = buffersRef.current.get(ptyId) ?? '';
      const next = `${previous}${data}`.slice(-BUFFER_LIMIT);
      buffersRef.current.set(ptyId, next);

      const now = Date.now();
      const projectId = findProjectIdByPtyId(ptyId);

      for (const url of extractTerminalLocalDevReadyUrls(next)) {
        const lastOpened = openedAtRef.current.get(url) ?? 0;

        if (now - lastOpened < DEDUPE_MS) {
          continue;
        }

        openedAtRef.current.set(url, now);
        void openBrowserTabRef.current(url, projectId);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [enabled]);
}

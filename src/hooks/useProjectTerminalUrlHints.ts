import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '@/stores/useProjectStore';
import type { TerminalTab } from '@/types';
import { collectProjectPanes } from '@/utils/tabGroups';
import { extractTerminalUrls } from '@/utils/terminalUrlExtract';

const MAX_URL_HINTS = 4;
const REFRESH_DEBOUNCE_MS = 350;

async function readTerminalPaneText(pane: TerminalTab): Promise<string> {
  if (pane.ptyId) {
    const live = await window.nexus.terminal.getScrollback(pane.ptyId);

    if (live) {
      return live;
    }
  }

  return window.nexus.session.getScrollback(pane.id);
}

export function useProjectTerminalUrlHints(
  enabled: boolean,
  currentUrl: string,
): string[] {
  const activeProject = useProjectStore((state) => {
    const { projects, activeProjectId } = state;

    return projects.find((project) => project.id === activeProjectId) ?? null;
  });
  const [hints, setHints] = useState<string[]>([]);
  const refreshTimerRef = useRef<number | null>(null);

  const terminalPanes = useMemo(() => {
    if (!activeProject) {
      return [] as TerminalTab[];
    }

    return collectProjectPanes(activeProject.tabs).filter(
      (pane): pane is TerminalTab => pane.type === 'terminal',
    );
  }, [activeProject]);

  const terminalPtyIds = useMemo(
    () =>
      new Set(
        terminalPanes.map((pane) => pane.ptyId).filter((ptyId): ptyId is string => Boolean(ptyId)),
      ),
    [terminalPanes],
  );

  const collectHints = useCallback(async () => {
    if (!enabled || terminalPanes.length === 0) {
      setHints([]);
      return;
    }

    const seen = new Set<string>();

    for (const pane of terminalPanes) {
      const text = await readTerminalPaneText(pane);

      for (const url of extractTerminalUrls(text)) {
        if (url === currentUrl) {
          continue;
        }

        seen.add(url);
      }
    }

    setHints(Array.from(seen).slice(0, MAX_URL_HINTS));
  }, [currentUrl, enabled, terminalPanes]);

  const scheduleCollect = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void collectHints();
    }, REFRESH_DEBOUNCE_MS);
  }, [collectHints]);

  useEffect(() => {
    void collectHints();
  }, [collectHints]);

  useEffect(() => {
    if (!enabled || terminalPtyIds.size === 0) {
      return;
    }

    const unsubscribe = window.nexus.terminal.onData((ptyId) => {
      if (terminalPtyIds.has(ptyId)) {
        scheduleCollect();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [enabled, scheduleCollect, terminalPtyIds]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  return hints;
}

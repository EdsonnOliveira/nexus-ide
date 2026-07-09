import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  MacParakeetSourceType,
  MacParakeetTranscriptionDetail,
  MacParakeetTranscriptionsSnapshot,
} from '@/types';

const POLL_INTERVAL_MS = 60_000;
const INITIAL_LOAD_DELAY_MS = 350;
const IMPORT_TIMEOUT_MS = 20_000;

const EMPTY_SNAPSHOT: MacParakeetTranscriptionsSnapshot = {
  platformSupported: true,
  installed: false,
  available: false,
  transcriptions: [],
};

export function useHomeDashboardMacParakeet(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<MacParakeetTranscriptionsSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [selectedSourceType, setSelectedSourceType] = useState<MacParakeetSourceType | ''>('');
  const requestIdRef = useRef(0);
  const importingRef = useRef(false);

  const sourceFilter = useMemo(
    () => (selectedSourceType ? selectedSourceType : null),
    [selectedSourceType],
  );

  const refresh = useCallback(
    async (background = false, forceRefresh = false) => {
      if (!enabled || !window.nexus?.macParakeet) {
        setSnapshot(EMPTY_SNAPSHOT);
        setHydrated(true);
        setLoading(false);
        return;
      }

      const requestId = ++requestIdRef.current;

      if (!background) {
        setLoading(true);
      }

      try {
        const nextSnapshot = await window.nexus.macParakeet.getTranscriptions(
          sourceFilter,
          forceRefresh,
        );

        if (requestId !== requestIdRef.current) {
          return;
        }

        setSnapshot((previousSnapshot) => {
          if (
            !forceRefresh &&
            nextSnapshot.available &&
            nextSnapshot.transcriptions.length === 0 &&
            previousSnapshot.transcriptions.length > 0
          ) {
            return {
              ...nextSnapshot,
              transcriptions: previousSnapshot.transcriptions,
            };
          }

          if (!nextSnapshot.available && previousSnapshot.transcriptions.length > 0) {
            return {
              ...nextSnapshot,
              transcriptions: [],
            };
          }

          return nextSnapshot;
        });
      } catch {
        if (requestId !== requestIdRef.current) {
          return;
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setHydrated(true);

          if (!background) {
            setLoading(false);
          }
        }
      }
    },
    [enabled, sourceFilter],
  );

  const importTranscriptions = useCallback(async () => {
    if (!enabled || !window.nexus?.macParakeet || importingRef.current) {
      return;
    }

    importingRef.current = true;
    setImporting(true);

    try {
      await Promise.race([
        refresh(true, true),
        new Promise<void>((_, reject) => {
          window.setTimeout(() => reject(new Error('macparakeet-import-timeout')), IMPORT_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // import timeout or fetch failure — spinner still stops below
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      void refresh(false);
    }, INITIAL_LOAD_DELAY_MS);

    const intervalId = window.setInterval(() => {
      void refresh(true);
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [enabled, refresh]);

  const loadDetail = useCallback(async (id: string): Promise<MacParakeetTranscriptionDetail | null> => {
    if (!window.nexus?.macParakeet) {
      return null;
    }

    return window.nexus.macParakeet.getTranscriptionDetail(id);
  }, []);

  const openApp = useCallback(async () => {
    if (!window.nexus?.macParakeet) {
      return;
    }

    await window.nexus.macParakeet.openApp();
  }, []);

  const renameTitle = useCallback(async (id: string, title: string): Promise<string | null> => {
    if (!window.nexus?.macParakeet) {
      return null;
    }

    const result = await window.nexus.macParakeet.renameTranscriptionTitle(id, title);
    if (!result.ok) {
      return null;
    }

    setSnapshot((previousSnapshot) => ({
      ...previousSnapshot,
      transcriptions: previousSnapshot.transcriptions.map((item) =>
        item.id === id ? { ...item, title: result.title } : item,
      ),
    }));

    return result.title;
  }, []);

  const selectSourceType = useCallback((value: string) => {
    setSelectedSourceType(value as MacParakeetSourceType | '');
  }, []);

  const filterOptions = useMemo(
    () =>
      [
        { value: '', label: 'Todas' },
        { value: 'regular_call', label: 'Chamadas' },
        { value: 'interview', label: 'Entrevistas' },
      ] as const,
    [],
  );

  return {
    snapshot,
    transcriptions: snapshot.transcriptions,
    loading,
    importing,
    hydrated,
    selectedSourceType,
    filterOptions,
    selectSourceType,
    refresh,
    importTranscriptions,
    loadDetail,
    openApp,
    renameTitle,
  };
}

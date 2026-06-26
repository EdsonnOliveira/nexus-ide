import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiProjectData } from '@/types/api';
import { createEmptyApiProjectData } from '@/utils/apiDefaults';

const SAVE_DEBOUNCE_MS = 300;

export function useApiProjectData(projectId: string, isVisible: boolean) {
  const [data, setData] = useState<ApiProjectData>(createEmptyApiProjectData);
  const [isLoading, setIsLoading] = useState(true);
  const saveTimerRef = useRef<number | null>(null);
  const latestDataRef = useRef(data);

  latestDataRef.current = data;

  useEffect(() => {
    if (!isVisible || !projectId) {
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    void window.nexus.api.loadProjectData(projectId).then((loaded) => {
      if (cancelled) {
        return;
      }

      setData(loaded);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isVisible, projectId]);

  const persist = useCallback(
    (nextData: ApiProjectData) => {
      if (!projectId) {
        return;
      }

      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }

      saveTimerRef.current = window.setTimeout(() => {
        void window.nexus.api.saveProjectData(projectId, nextData);
      }, SAVE_DEBOUNCE_MS);
    },
    [projectId],
  );

  const updateData = useCallback(
    (updater: (current: ApiProjectData) => ApiProjectData) => {
      setData((current) => {
        const nextData = updater(current);
        persist(nextData);
        return nextData;
      });
    },
    [persist],
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }

      if (projectId) {
        void window.nexus.api.saveProjectData(projectId, latestDataRef.current);
      }
    };
  }, [projectId]);

  return {
    data,
    isLoading,
    updateData,
    setData,
  };
}

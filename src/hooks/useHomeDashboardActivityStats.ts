import { useCallback, useEffect, useState } from 'react';
import type { HomeDashboardActivityComparison } from '@/types';

const EMPTY_STATS: HomeDashboardActivityComparison = {
  today: {
    commits: 0,
    linesChanged: 0,
    agentExecutions: 0,
    prompts: 0,
  },
  yesterday: {
    commits: 0,
    linesChanged: 0,
    agentExecutions: 0,
    prompts: 0,
  },
};

export function useHomeDashboardActivityStats(projectPathsKey: string) {
  const [stats, setStats] = useState<HomeDashboardActivityComparison>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(
    async (background = false) => {
      if (!window.nexus?.homeDashboard?.getStats) {
        setStats(EMPTY_STATS);
        setLoading(false);
        return;
      }

      if (!background) {
        setLoading(true);
      }

      try {
        const nextStats = await window.nexus.homeDashboard.getStats(
          projectPathsKey ? projectPathsKey.split('|') : [],
        );
        setStats(nextStats);
      } catch {
        if (!background) {
          setStats(EMPTY_STATS);
        }
      } finally {
        setLoading(false);
      }
    },
    [projectPathsKey],
  );

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  useEffect(() => {
    const handleFocus = () => {
      void refresh(true);
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [refresh]);

  return { stats, loading, refresh };
}

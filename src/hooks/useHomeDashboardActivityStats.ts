import { useCallback, useEffect, useState } from 'react';
import type { HomeDashboardActivityComparison } from '@/types';
import type { AiProviderId } from '@/constants/aiProviders';

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

export function useHomeDashboardActivityStats(
  projectPathsKey: string,
  provider: Exclude<AiProviderId, 'nexus'>,
  enabled = true,
) {
  const [stats, setStats] = useState<HomeDashboardActivityComparison>(EMPTY_STATS);
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(
    async (background = false) => {
      if (!enabled || !window.nexus?.homeDashboard?.getStats) {
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
          provider,
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
    [enabled, projectPathsKey, provider],
  );

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    void refresh(false);
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleFocus = () => {
      void refresh(true);
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [enabled, refresh]);

  return { stats, loading, refresh };
}

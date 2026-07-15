import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildBrainDataset,
  createIdleBrainDataset,
} from '@/components/brain/buildBrainDataset';
import type { BrainDataset } from '@/components/brain/brainTypes';
import { useProjectStore } from '@/stores/useProjectStore';
import type { Project } from '@/types';

interface UseBrainDatasetResult {
  dataset: BrainDataset;
  loading: boolean;
  reload: () => void;
}

export function useBrainDataset(project: Project | null): UseBrainDatasetResult {
  const projects = useProjectStore((state) => state.projects);
  const [dataset, setDataset] = useState<BrainDataset>(() =>
    createIdleBrainDataset(project?.name ?? 'Projeto'),
  );
  const [loading, setLoading] = useState(Boolean(project));
  const [reloadToken, setReloadToken] = useState(0);

  const relatedProjectNames = useMemo(() => {
    if (!project) {
      return [] as string[];
    }

    return projects
      .filter((item) => item.workspaceId === project.workspaceId && item.id !== project.id)
      .map((item) => item.name);
  }, [project, projects]);

  const refreshKey = useMemo(() => {
    if (!project) {
      return 'none';
    }

    const agentSignal = project.tabs
      .map((tab) => {
        if (tab.type === 'agent') {
          return `${tab.id}:${tab.turns.length}:${tab.turns.at(-1)?.completedAt ?? 0}`;
        }
        if (tab.type === 'split') {
          return tab.panes
            .filter((pane) => pane.type === 'agent')
            .map((pane) => `${pane.id}:${pane.turns.length}`)
            .join('|');
        }
        return '';
      })
      .join(';');

    return [
      project.id,
      project.name,
      project.path,
      project.tasks?.length ?? 0,
      project.agentGitGroups?.length ?? 0,
      agentSignal,
      reloadToken,
    ].join('::');
  }, [project, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!project) {
      setDataset(createIdleBrainDataset('Projeto'));
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void buildBrainDataset(project, relatedProjectNames)
      .then((next) => {
        if (!cancelled) {
          setDataset(next);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDataset(createIdleBrainDataset(project.name));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [project, relatedProjectNames, refreshKey]);

  return { dataset, loading, reload };
}

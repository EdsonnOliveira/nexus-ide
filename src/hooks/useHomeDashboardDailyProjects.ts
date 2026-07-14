import { useCallback, useMemo, useState } from 'react';
import type { Project } from '@/types';

const STORAGE_KEY = 'nexus.home-dashboard.daily-projects';

interface StoredDailyProjects {
  projectIds: string[];
}

function readStoredDailyProjectIds(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as StoredDailyProjects;

    if (!Array.isArray(parsed?.projectIds)) {
      return null;
    }

    return parsed.projectIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  } catch {
    return null;
  }
}

function writeStoredDailyProjectIds(projectIds: string[] | null): void {
  if (projectIds === null) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify({ projectIds }));
}

export function useHomeDashboardDailyProjects(projects: Project[]) {
  const [storedProjectIds, setStoredProjectIds] = useState<string[] | null>(() =>
    readStoredDailyProjectIds(),
  );

  const projectIds = useMemo(() => projects.map((project) => project.id), [projects]);

  const selectedProjectIds = useMemo(() => {
    if (storedProjectIds === null) {
      return new Set(projectIds);
    }

    const availableIds = new Set(projectIds);
    return new Set(storedProjectIds.filter((id) => availableIds.has(id)));
  }, [projectIds, storedProjectIds]);

  const visibleDailyProjects = useMemo(() => {
    if (storedProjectIds === null) {
      return projects;
    }

    return projects.filter((project) => selectedProjectIds.has(project.id));
  }, [projects, selectedProjectIds, storedProjectIds]);

  const setSelectedProjectIds = useCallback(
    (nextProjectIds: string[]) => {
      const availableIds = new Set(projectIds);
      const nextIds = Array.from(
        new Set(nextProjectIds.filter((id) => id.trim().length > 0 && availableIds.has(id))),
      );
      const selectsAll =
        projectIds.length > 0 &&
        nextIds.length === projectIds.length &&
        projectIds.every((id) => nextIds.includes(id));

      if (selectsAll) {
        writeStoredDailyProjectIds(null);
        setStoredProjectIds(null);
        return;
      }

      writeStoredDailyProjectIds(nextIds);
      setStoredProjectIds(nextIds);
    },
    [projectIds],
  );

  return {
    selectedProjectIds,
    visibleDailyProjects,
    setSelectedProjectIds,
  };
}

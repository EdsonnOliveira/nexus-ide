import { memo, useCallback, useMemo } from 'react';
import { TestListView } from '@/components/tests/TestListView';
import { useProjectStore } from '@/stores/useProjectStore';
import type { ProjectTestEntry } from '@/types/test';
import { executeProjectTest, stopProjectTest } from '@/utils/executeProjectTest';

interface ProjectTestsDrawerProps {
  projectId: string;
}

function ProjectTestsDrawerComponent({ projectId }: ProjectTestsDrawerProps) {
  const project = useProjectStore((state) => state.projects.find((item) => item.id === projectId) ?? null);
  const updateProject = useProjectStore((state) => state.updateProject);

  const testEntries = useMemo(() => project?.testEntries ?? [], [project?.testEntries]);

  const persistTestEntries = useCallback(
    async (nextEntries: ProjectTestEntry[]) => {
      if (!project) {
        return;
      }

      await updateProject(project.id, { testEntries: nextEntries });
    },
    [project, updateProject],
  );

  const handleAddEntries = useCallback(
    (entries: ProjectTestEntry[]) => {
      if (entries.length === 0) {
        return;
      }

      void persistTestEntries([...testEntries, ...entries]);
    },
    [persistTestEntries, testEntries],
  );

  const handleRemoveEntry = useCallback(
    (entry: ProjectTestEntry) => {
      void persistTestEntries(testEntries.filter((item) => item.id !== entry.id));
    },
    [persistTestEntries, testEntries],
  );

  const handleRenameEntry = useCallback(
    (entry: ProjectTestEntry, name: string) => {
      const trimmed = name.trim();

      if (!trimmed || trimmed === entry.name) {
        return;
      }

      void persistTestEntries(
        testEntries.map((item) => (item.id === entry.id ? { ...item, name: trimmed } : item)),
      );
    },
    [persistTestEntries, testEntries],
  );

  const handlePlay = useCallback(
    (entry: ProjectTestEntry) => {
      if (!project) {
        return;
      }

      void executeProjectTest(entry, projectId, project.path);
    },
    [project, projectId],
  );

  const handleStop = useCallback((entry: ProjectTestEntry) => {
    void stopProjectTest(entry.id);
  }, []);

  if (!project) {
    return null;
  }

  return (
    <TestListView
      testEntries={testEntries}
      projectId={projectId}
      projectPath={project.path}
      onAddEntries={handleAddEntries}
      onRemoveEntry={handleRemoveEntry}
      onRenameEntry={handleRenameEntry}
      onPlay={handlePlay}
      onStop={handleStop}
    />
  );
}

export const ProjectTestsDrawer = memo(ProjectTestsDrawerComponent);

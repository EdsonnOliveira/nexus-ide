import { useProjectStore } from '@/stores/useProjectStore';
import { collectProjectPanes } from '@/utils/tabGroups';

export function findProjectIdByPaneId(paneId: string): string | null {
  const { projects } = useProjectStore.getState();

  for (const project of projects) {
    for (const pane of collectProjectPanes(project.tabs)) {
      if (pane.id === paneId) {
        return project.id;
      }
    }
  }

  return null;
}

import Store from 'electron-store';
import type { ApiProjectData } from '../../types/api';

interface ApiStoreSchema {
  projects: Record<string, ApiProjectData>;
}

const defaultProjectData = (): ApiProjectData => ({
  collections: [],
  environments: [],
  activeEnvironmentId: null,
  history: [],
});

const store = new Store<ApiStoreSchema>({
  name: 'api-projects',
  defaults: {
    projects: {},
  },
});

export function loadApiProjectData(projectId: string): ApiProjectData {
  const data = store.get(`projects.${projectId}`);

  if (!data) {
    return defaultProjectData();
  }

  return {
    collections: data.collections ?? [],
    environments: data.environments ?? [],
    activeEnvironmentId: data.activeEnvironmentId ?? null,
    history: data.history ?? [],
  };
}

export function saveApiProjectData(projectId: string, data: ApiProjectData): void {
  store.set(`projects.${projectId}`, {
    collections: data.collections,
    environments: data.environments,
    activeEnvironmentId: data.activeEnvironmentId,
    history: data.history.slice(0, 50),
  });
}

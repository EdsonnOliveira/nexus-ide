import type {
  ApiCollectionFolder,
  ApiEnvironment,
  ApiKeyValue,
  ApiProjectData,
  ApiRequest,
} from '@/types/api';

export function createApiKeyValue(key = '', value = '', enabled = true): ApiKeyValue {
  return {
    id: crypto.randomUUID(),
    key,
    value,
    enabled,
  };
}

export function createDefaultApiRequest(name = 'Nova request'): ApiRequest {
  return {
    id: crypto.randomUUID(),
    name,
    method: 'GET',
    url: '{{BASE_URL}}/',
    query: [],
    headers: [],
    bodyType: 'none',
    body: '',
    authType: 'none',
    authBearer: '',
    authBasicUser: '',
    authBasicPass: '',
  };
}

export function createDefaultCollection(name = 'Coleção'): ApiCollectionFolder {
  return {
    id: crypto.randomUUID(),
    name,
    items: [],
    folders: [],
  };
}

export function createDefaultEnvironment(name = 'Local'): ApiEnvironment {
  return {
    id: crypto.randomUUID(),
    name,
    variables: [createApiKeyValue('BASE_URL', 'http://localhost:3000')],
  };
}

export function createEmptyApiProjectData(): ApiProjectData {
  return {
    collections: [],
    environments: [],
    activeEnvironmentId: null,
    history: [],
  };
}

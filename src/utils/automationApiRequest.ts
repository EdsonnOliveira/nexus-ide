import type { ApiBodyType, ApiKeyValue, ApiProjectData, ApiRequest } from '@/types/api';
import type { AutomationStep } from '@/types/automation';
import { createApiKeyValue } from '@/utils/apiDefaults';
import { upsertCollectionItem } from '@/utils/apiCollectionUtils';
import { variablesFromEnvironment } from '@/utils/substituteApiVariables';

export const AUTOMATION_API_COLLECTION_ID = 'nexus-automation-api';

function ensureAutomationCollection(data: ApiProjectData): ApiProjectData {
  if (data.collections.some((collection) => collection.id === AUTOMATION_API_COLLECTION_ID)) {
    return data;
  }

  return {
    ...data,
    collections: [
      ...data.collections,
      {
        id: AUTOMATION_API_COLLECTION_ID,
        name: 'Automações',
        items: [],
        folders: [],
      },
    ],
  };
}

function inferBodyType(body: string): ApiBodyType {
  const trimmed = body.trim();

  if (!trimmed) {
    return 'none';
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return 'json';
  }

  return 'text';
}

export function parseAutomationHeaders(raw: string): ApiKeyValue[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(':');
      const key = separator >= 0 ? line.slice(0, separator).trim() : line;
      const value = separator >= 0 ? line.slice(separator + 1).trim() : '';

      return createApiKeyValue(key, value, true);
    });
}

export function buildApiRequestFromAutomationStep(step: AutomationStep): ApiRequest {
  const body = step.body ?? '';
  const method = step.method ?? 'GET';

  return {
    id: step.id,
    name: step.title?.trim() || 'Request',
    method,
    url: step.url?.trim() || '',
    query: [],
    headers: parseAutomationHeaders(step.headers ?? ''),
    bodyType: inferBodyType(body),
    body,
    authType: 'none',
    authBearer: '',
    authBasicUser: '',
    authBasicPass: '',
  };
}

export async function persistAutomationApiRequests(
  projectId: string,
  steps: AutomationStep[],
): Promise<void> {
  const apiSteps = steps.filter((step) => step.type === 'api');

  if (apiSteps.length === 0) {
    return;
  }

  let data = ensureAutomationCollection(await window.nexus.api.loadProjectData(projectId));

  for (const step of apiSteps) {
    const request = buildApiRequestFromAutomationStep(step);

    data = {
      ...data,
      collections: upsertCollectionItem(data.collections, AUTOMATION_API_COLLECTION_ID, {
        id: step.id,
        name: request.name,
        request,
      }),
    };
  }

  await window.nexus.api.saveProjectData(projectId, data);
}

export async function sendAutomationApiRequests(
  projectId: string,
  steps: AutomationStep[],
): Promise<void> {
  const apiSteps = steps.filter((step) => step.type === 'api');

  if (apiSteps.length === 0) {
    return;
  }

  const data = await window.nexus.api.loadProjectData(projectId);
  const activeEnvironment =
    data.environments.find((environment) => environment.id === data.activeEnvironmentId) ?? null;
  const variables = variablesFromEnvironment(activeEnvironment);

  for (const step of apiSteps) {
    const request = buildApiRequestFromAutomationStep(step);

    await window.nexus.api.sendRequest({ request, variables });
  }
}

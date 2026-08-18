import { ipcMain } from 'electron';
import {
  getPrimaryActiveRenderDeployment,
  getRenderDeploymentLogs,
  listRenderDeploymentsForToken,
  mergeRenderDeployments,
  resolveRenderAccountLabel,
  validateRenderToken,
  type RenderActiveDeployment,
  type RenderDeploymentLogsQuery,
} from '../services/renderApi';
import { renderCredentialStore } from '../services/renderCredentialStore';

function readStatusCode(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    return Number((error as { statusCode?: number }).statusCode);
  }

  return undefined;
}

async function listAllRenderDeployments(): Promise<RenderActiveDeployment[]> {
  const credentials = renderCredentialStore.listCredentials();

  if (credentials.length === 0) {
    return [];
  }

  const grouped = await Promise.all(
    credentials.map(async (credential) => {
      try {
        return await listRenderDeploymentsForToken(
          credential.id,
          credential.label,
          credential.token,
        );
      } catch (error) {
        if (readStatusCode(error) === 401) {
          return [];
        }

        throw error;
      }
    }),
  );

  return mergeRenderDeployments(grouped.flat());
}

const RENDER_IPC_CHANNELS = [
  'render:getKeysConfigured',
  'render:listKeys',
  'render:getKeyToken',
  'render:addKey',
  'render:removeKey',
  'render:getActiveDeployment',
  'render:listDeployments',
  'render:getDeploymentLogs',
] as const;

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLogsQuery(value: unknown): RenderDeploymentLogsQuery | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const query = value as Partial<RenderDeploymentLogsQuery>;
  const credentialId = readString(query.credentialId);
  const ownerId = readString(query.ownerId);
  const serviceId = readString(query.serviceId);

  if (!credentialId || !ownerId || !serviceId) {
    return null;
  }

  const createdAt = Number(query.createdAt);
  const readyAt = query.readyAt == null ? null : Number(query.readyAt);

  return {
    credentialId,
    ownerId,
    serviceId,
    createdAt: Number.isFinite(createdAt) ? createdAt : 0,
    readyAt: readyAt !== null && Number.isFinite(readyAt) ? readyAt : null,
  };
}

export function registerRenderHandlers(): void {
  for (const channel of RENDER_IPC_CHANNELS) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle('render:getKeysConfigured', () => {
    try {
      return renderCredentialStore.hasCredentials();
    } catch {
      return false;
    }
  });

  ipcMain.handle('render:listKeys', () => {
    try {
      return renderCredentialStore.listCredentials().map((item) => ({
        id: item.id,
        label: item.label,
      }));
    } catch {
      return [];
    }
  });

  ipcMain.handle('render:getKeyToken', (_, id: unknown) => {
    try {
      return renderCredentialStore.getToken(readString(id));
    } catch {
      return null;
    }
  });

  ipcMain.handle('render:addKey', async (_, token: unknown) => {
    const trimmed = readString(token);

    if (!trimmed) {
      return 'empty';
    }

    if (renderCredentialStore.hasToken(trimmed)) {
      return 'duplicate';
    }

    const isValid = await validateRenderToken(trimmed);

    if (!isValid) {
      return 'invalid';
    }

    const label = await resolveRenderAccountLabel(trimmed);
    const saved = renderCredentialStore.addCredential(label, trimmed);
    return saved ? 'saved' : 'invalid';
  });

  ipcMain.handle('render:removeKey', (_, id: unknown) => {
    const credentialId = readString(id);

    if (!credentialId) {
      return;
    }

    renderCredentialStore.removeCredential(credentialId);
  });

  ipcMain.handle('render:getActiveDeployment', async () => {
    if (!renderCredentialStore.hasCredentials()) {
      return null;
    }

    try {
      const deployments = await listAllRenderDeployments();
      return getPrimaryActiveRenderDeployment(deployments);
    } catch {
      return null;
    }
  });

  ipcMain.handle('render:listDeployments', async () => {
    if (!renderCredentialStore.hasCredentials()) {
      return [];
    }

    return listAllRenderDeployments();
  });

  ipcMain.handle('render:getDeploymentLogs', async (_, rawQuery: unknown) => {
    const query = readLogsQuery(rawQuery);

    if (!query) {
      return '';
    }

    const token = renderCredentialStore.getToken(query.credentialId);

    if (!token) {
      return '';
    }

    try {
      return await getRenderDeploymentLogs(token, query);
    } catch (error) {
      if (readStatusCode(error) === 401) {
        return '';
      }

      throw error;
    }
  });
}

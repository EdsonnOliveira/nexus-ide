import { ipcMain } from 'electron';
import {
  getPrimaryActiveVercelDeployment,
  getVercelDeploymentLogs,
  listRecentVercelDeployments,
  mergeVercelDeployments,
  resolveVercelAccountLabel,
  validateVercelToken,
  type VercelActiveDeployment,
} from '../services/vercelApi';
import { vercelCredentialStore } from '../services/vercelCredentialStore';

function readStatusCode(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    return Number((error as { statusCode?: number }).statusCode);
  }

  return undefined;
}

async function listAllVercelDeployments(): Promise<VercelActiveDeployment[]> {
  const credentials = vercelCredentialStore.listCredentials();

  if (credentials.length === 0) {
    return [];
  }

  const grouped = await Promise.all(
    credentials.map(async (credential) => {
      try {
        return await listRecentVercelDeployments(
          credential.token,
          credential.id,
          credential.label,
        );
      } catch (error) {
        if (readStatusCode(error) === 401) {
          return [];
        }

        throw error;
      }
    }),
  );

  return mergeVercelDeployments(grouped.flat());
}

const VERCEL_IPC_CHANNELS = [
  'vercel:getTokenConfigured',
  'vercel:listKeys',
  'vercel:getKeyToken',
  'vercel:getToken',
  'vercel:addKey',
  'vercel:saveToken',
  'vercel:removeKey',
  'vercel:clearToken',
  'vercel:validateToken',
  'vercel:getActiveDeployment',
  'vercel:listDeployments',
  'vercel:getDeploymentLogs',
] as const;

export function registerVercelHandlers(): void {
  for (const channel of VERCEL_IPC_CHANNELS) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle('vercel:getTokenConfigured', () => {
    try {
      return vercelCredentialStore.isTokenConfigured();
    } catch {
      vercelCredentialStore.clearToken();
      return false;
    }
  });

  ipcMain.handle('vercel:listKeys', () => {
    try {
      return vercelCredentialStore.listCredentials().map((item) => ({
        id: item.id,
        label: item.label,
      }));
    } catch {
      return [];
    }
  });

  ipcMain.handle('vercel:getKeyToken', (_, id: unknown) => {
    try {
      return typeof id === 'string' ? vercelCredentialStore.getToken(id) : null;
    } catch {
      return null;
    }
  });

  ipcMain.handle('vercel:getToken', () => {
    try {
      return vercelCredentialStore.getToken();
    } catch {
      vercelCredentialStore.clearToken();
      return null;
    }
  });

  ipcMain.handle('vercel:addKey', async (_, token: unknown) => {
    const trimmed = typeof token === 'string' ? token.trim() : '';

    if (!trimmed) {
      return 'empty';
    }

    if (vercelCredentialStore.hasToken(trimmed)) {
      return 'duplicate';
    }

    const isValid = await validateVercelToken(trimmed);

    if (!isValid) {
      return 'invalid';
    }

    const label = await resolveVercelAccountLabel(trimmed);
    const saved = vercelCredentialStore.addCredential(label, trimmed);
    return saved ? 'saved' : 'invalid';
  });

  ipcMain.handle('vercel:saveToken', async (_, token: unknown) => {
    const trimmed = typeof token === 'string' ? token.trim() : '';

    if (!trimmed) {
      return false;
    }

    const result = await (async () => {
      if (vercelCredentialStore.hasToken(trimmed)) {
        return true;
      }

      const isValid = await validateVercelToken(trimmed);

      if (!isValid) {
        return false;
      }

      const label = await resolveVercelAccountLabel(trimmed);
      return Boolean(vercelCredentialStore.addCredential(label, trimmed));
    })();

    return result;
  });

  ipcMain.handle('vercel:removeKey', (_, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) {
      return;
    }

    vercelCredentialStore.removeCredential(id);
  });

  ipcMain.handle('vercel:clearToken', () => {
    vercelCredentialStore.clearToken();
  });

  ipcMain.handle('vercel:validateToken', async (_, token: string) => validateVercelToken(token));

  ipcMain.handle('vercel:getActiveDeployment', async () => {
    if (!vercelCredentialStore.hasCredentials()) {
      return null;
    }

    try {
      const deployments = await listAllVercelDeployments();
      return getPrimaryActiveVercelDeployment(deployments);
    } catch {
      return null;
    }
  });

  ipcMain.handle('vercel:listDeployments', async () => {
    if (!vercelCredentialStore.hasCredentials()) {
      return [];
    }

    return listAllVercelDeployments();
  });

  ipcMain.handle(
    'vercel:getDeploymentLogs',
    async (_, deploymentUid: string, credentialId?: string) => {
      const tokens = credentialId
        ? [vercelCredentialStore.getToken(credentialId)].filter(
            (token): token is string => Boolean(token),
          )
        : vercelCredentialStore
            .listCredentials()
            .map((item) => item.token)
            .filter(Boolean);

      if (tokens.length === 0) {
        return '';
      }

      for (const token of tokens) {
        try {
          const logs = await getVercelDeploymentLogs(token, deploymentUid);

          if (logs.trim()) {
            return logs;
          }
        } catch (error) {
          if (readStatusCode(error) === 401) {
            continue;
          }

          throw error;
        }
      }

      return '';
    },
  );
}

import { ipcMain } from 'electron';
import {
  getPrimaryActiveVercelDeployment,
  getVercelDeploymentLogs,
  listActiveVercelDeployments,
  validateVercelToken,
} from '../services/vercelApi';
import { vercelCredentialStore } from '../services/vercelCredentialStore';

export function registerVercelHandlers(): void {
  ipcMain.handle('vercel:getTokenConfigured', () => vercelCredentialStore.isTokenConfigured());

  ipcMain.handle('vercel:saveToken', async (_, token: string) => {
    const trimmed = token.trim();

    if (!trimmed) {
      vercelCredentialStore.clearToken();
      return false;
    }

    const isValid = await validateVercelToken(trimmed);

    if (!isValid) {
      return false;
    }

    vercelCredentialStore.saveToken(trimmed);
    return true;
  });

  ipcMain.handle('vercel:clearToken', () => {
    vercelCredentialStore.clearToken();
  });

  ipcMain.handle('vercel:validateToken', async (_, token: string) => validateVercelToken(token));

  ipcMain.handle('vercel:getActiveDeployment', async () => {
    const token = vercelCredentialStore.getToken();

    if (!token) {
      return null;
    }

    try {
      const deployments = await listActiveVercelDeployments(token);
      return getPrimaryActiveVercelDeployment(deployments);
    } catch (error) {
      const statusCode =
        error && typeof error === 'object' && 'statusCode' in error
          ? Number((error as { statusCode?: number }).statusCode)
          : undefined;

      if (statusCode === 401) {
        vercelCredentialStore.clearToken();
      }

      throw error;
    }
  });

  ipcMain.handle('vercel:listDeployments', async () => {
    const token = vercelCredentialStore.getToken();

    if (!token) {
      return [];
    }

    try {
      return await listActiveVercelDeployments(token);
    } catch (error) {
      const statusCode =
        error && typeof error === 'object' && 'statusCode' in error
          ? Number((error as { statusCode?: number }).statusCode)
          : undefined;

      if (statusCode === 401) {
        vercelCredentialStore.clearToken();
      }

      throw error;
    }
  });

  ipcMain.handle('vercel:getDeploymentLogs', async (_, deploymentUid: string) => {
    const token = vercelCredentialStore.getToken();

    if (!token) {
      return '';
    }

    try {
      return await getVercelDeploymentLogs(token, deploymentUid);
    } catch (error) {
      const statusCode =
        error && typeof error === 'object' && 'statusCode' in error
          ? Number((error as { statusCode?: number }).statusCode)
          : undefined;

      if (statusCode === 401) {
        vercelCredentialStore.clearToken();
      }

      throw error;
    }
  });
}

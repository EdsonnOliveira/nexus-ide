import { safeStorage } from 'electron';
import Store from 'electron-store';

interface VercelCredentialStoreShape {
  vercelAccessToken: string | null;
}

function encryptValue(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(value).toString('base64');
  }

  return Buffer.from(value, 'utf8').toString('base64');
}

function decryptValue(value: string): string {
  const buffer = Buffer.from(value, 'base64');

  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(buffer);
  }

  return buffer.toString('utf8');
}

class VercelCredentialStoreService {
  private store = new Store<VercelCredentialStoreShape>({
    name: 'vercel-credentials',
    defaults: {
      vercelAccessToken: null,
    },
  });

  isTokenConfigured(): boolean {
    return Boolean(this.getToken());
  }

  getToken(): string | null {
    const encrypted = this.store.get('vercelAccessToken');

    if (!encrypted) {
      return null;
    }

    return decryptValue(encrypted);
  }

  saveToken(token: string): void {
    const trimmed = token.trim();

    if (!trimmed) {
      this.clearToken();
      return;
    }

    this.store.set('vercelAccessToken', encryptValue(trimmed));
  }

  clearToken(): void {
    this.store.set('vercelAccessToken', null);
  }
}

export const vercelCredentialStore = new VercelCredentialStoreService();

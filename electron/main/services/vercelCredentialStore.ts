import Store from 'electron-store';
import {
  decryptCredentialValue,
  encryptCredentialValue,
} from './credentialCrypto';

interface VercelCredentialStoreShape {
  vercelAccessToken: string | null;
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

    const decrypted = decryptCredentialValue(encrypted);

    if (!decrypted) {
      this.clearToken();
      return null;
    }

    return decrypted;
  }

  saveToken(token: string): void {
    const trimmed = token.trim();

    if (!trimmed) {
      this.clearToken();
      return;
    }

    this.store.set('vercelAccessToken', encryptCredentialValue(trimmed));
  }

  clearToken(): void {
    this.store.set('vercelAccessToken', null);
  }
}

export const vercelCredentialStore = new VercelCredentialStoreService();

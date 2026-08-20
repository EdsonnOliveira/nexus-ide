import { randomUUID } from 'node:crypto';
import Store from 'electron-store';
import { decryptCredentialValue, encryptCredentialValue } from './credentialCrypto';

export interface VercelStoredCredential {
  id: string;
  label: string;
  token: string;
}

interface VercelCredentialStoreShape {
  vercelAccessToken: string | null;
  credentials: VercelStoredCredential[];
}

class VercelCredentialStoreService {
  private store = new Store<VercelCredentialStoreShape>({
    name: 'vercel-credentials',
    defaults: {
      vercelAccessToken: null,
      credentials: [],
    },
  });

  private decryptedCache: VercelStoredCredential[] | null = null;

  listCredentials(): VercelStoredCredential[] {
    return this.readCredentials();
  }

  hasCredentials(): boolean {
    return this.isTokenConfigured();
  }

  isTokenConfigured(): boolean {
    const stored = this.store.get('credentials') ?? [];

    if (stored.some((item) => Boolean(item.id?.trim() && item.token?.trim()))) {
      return true;
    }

    return Boolean(this.store.get('vercelAccessToken'));
  }

  getCredential(id: string): VercelStoredCredential | null {
    return this.readCredentials().find((item) => item.id === id) ?? null;
  }

  getToken(id?: string): string | null {
    if (id !== undefined) {
      const trimmed = id.trim();

      if (!trimmed) {
        return null;
      }

      return this.getCredential(trimmed)?.token ?? null;
    }

    return this.readCredentials()[0]?.token ?? null;
  }

  hasToken(token: string): boolean {
    const trimmed = token.trim();

    if (!trimmed) {
      return false;
    }

    return this.readCredentials().some((item) => item.token === trimmed);
  }

  addCredential(label: string, token: string): VercelStoredCredential | null {
    const trimmedToken = token.trim();
    const trimmedLabel = label.trim() || 'Conta Vercel';

    if (!trimmedToken) {
      return null;
    }

    if (this.hasToken(trimmedToken)) {
      return null;
    }

    const credential: VercelStoredCredential = {
      id: randomUUID(),
      label: trimmedLabel,
      token: trimmedToken,
    };
    const next = [...this.readCredentials(), credential];
    this.writeCredentials(next);
    return credential;
  }

  removeCredential(id: string): void {
    const next = this.readCredentials().filter((item) => item.id !== id);
    this.writeCredentials(next);
  }

  saveToken(token: string): void {
    const trimmed = token.trim();

    if (!trimmed) {
      this.clearToken();
      return;
    }

    if (this.hasToken(trimmed)) {
      return;
    }

    this.addCredential('Conta Vercel', trimmed);
  }

  clearToken(): void {
    this.writeCredentials([]);
    this.store.set('vercelAccessToken', null);
  }

  private readLegacyToken(): string | null {
    const encrypted = this.store.get('vercelAccessToken');

    if (!encrypted) {
      return null;
    }

    return decryptCredentialValue(encrypted);
  }

  private readCredentials(): VercelStoredCredential[] {
    if (this.decryptedCache) {
      return this.decryptedCache;
    }

    const stored = this.store.get('credentials') ?? [];
    const credentials = stored
      .map((item) => {
        const id = item.id?.trim();
        const encryptedToken = item.token?.trim();

        if (!id || !encryptedToken) {
          return null;
        }

        const token = decryptCredentialValue(encryptedToken);

        if (!token) {
          return null;
        }

        return {
          id,
          label: item.label?.trim() || 'Conta Vercel',
          token,
        };
      })
      .filter((item): item is VercelStoredCredential => item !== null);

    if (credentials.length > 0) {
      this.decryptedCache = credentials;
      return credentials;
    }

    const legacyToken = this.readLegacyToken();

    if (!legacyToken) {
      this.decryptedCache = [];
      return [];
    }

    const migrated: VercelStoredCredential = {
      id: randomUUID(),
      label: 'Conta Vercel',
      token: legacyToken,
    };
    this.writeCredentials([migrated]);
    this.store.set('vercelAccessToken', null);
    return this.decryptedCache ?? [migrated];
  }

  private writeCredentials(credentials: VercelStoredCredential[]): void {
    this.decryptedCache = credentials;
    this.store.set(
      'credentials',
      credentials.map((item) => ({
        id: item.id,
        label: item.label,
        token: encryptCredentialValue(item.token),
      })),
    );
  }
}

export const vercelCredentialStore = new VercelCredentialStoreService();

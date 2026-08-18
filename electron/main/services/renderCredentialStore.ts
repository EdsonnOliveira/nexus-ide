import { randomUUID } from 'node:crypto';
import Store from 'electron-store';
import { decryptCredentialValue, encryptCredentialValue } from './credentialCrypto';

export interface RenderStoredCredential {
  id: string;
  label: string;
  token: string;
}

interface RenderCredentialStoreShape {
  credentials: RenderStoredCredential[];
}

class RenderCredentialStoreService {
  private store = new Store<RenderCredentialStoreShape>({
    name: 'render-credentials',
    defaults: {
      credentials: [],
    },
  });

  listCredentials(): RenderStoredCredential[] {
    return this.readCredentials();
  }

  hasCredentials(): boolean {
    return this.readCredentials().length > 0;
  }

  getCredential(id: string): RenderStoredCredential | null {
    return this.readCredentials().find((item) => item.id === id) ?? null;
  }

  getToken(id: string): string | null {
    const trimmed = id.trim();

    if (!trimmed) {
      return null;
    }

    return this.getCredential(trimmed)?.token ?? null;
  }

  hasToken(token: string): boolean {
    const trimmed = token.trim();

    if (!trimmed) {
      return false;
    }

    return this.readCredentials().some((item) => item.token === trimmed);
  }

  addCredential(label: string, token: string): RenderStoredCredential | null {
    const trimmedToken = token.trim();
    const trimmedLabel = label.trim() || 'Conta Render';

    if (!trimmedToken) {
      return null;
    }

    if (this.hasToken(trimmedToken)) {
      return null;
    }

    const credential: RenderStoredCredential = {
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

  private readCredentials(): RenderStoredCredential[] {
    const stored = this.store.get('credentials') ?? [];

    return stored
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
          label: item.label?.trim() || 'Conta Render',
          token,
        };
      })
      .filter((item): item is RenderStoredCredential => item !== null);
  }

  private writeCredentials(credentials: RenderStoredCredential[]): void {
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

export const renderCredentialStore = new RenderCredentialStoreService();

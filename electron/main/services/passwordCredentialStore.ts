import Store from 'electron-store';
import {
  decryptCredentialValue,
  encryptCredentialValue,
} from './credentialCrypto';

interface CredentialStoreShape {
  secrets: Record<string, Record<string, Record<string, string>>>;
}

function readSecretValue(encrypted: string | undefined): string | undefined {
  if (!encrypted) {
    return undefined;
  }

  return decryptCredentialValue(encrypted) ?? undefined;
}

class PasswordCredentialStoreService {
  private store = new Store<CredentialStoreShape>({
    name: 'password-credentials',
    defaults: {
      secrets: {},
    },
  });

  getValues(projectId: string, collectionId: string): Record<string, string> {
    const allSecrets = this.store.get('secrets', {}) as Record<
      string,
      Record<string, Record<string, string>>
    >;
    const encrypted = allSecrets[projectId]?.[collectionId] ?? {};
    const values: Record<string, string> = {};

    for (const [fieldId, encryptedValue] of Object.entries(encrypted)) {
      const decrypted = readSecretValue(encryptedValue);

      if (decrypted) {
        values[fieldId] = decrypted;
      }
    }

    return values;
  }

  saveValues(projectId: string, collectionId: string, values: Record<string, string>): void {
    const allSecrets = { ...this.store.get('secrets', {}) } as Record<
      string,
      Record<string, Record<string, string>>
    >;
    const encrypted: Record<string, string> = {};

    for (const [fieldId, value] of Object.entries(values)) {
      if (!value) {
        continue;
      }

      encrypted[fieldId] = encryptCredentialValue(value);
    }

    if (!allSecrets[projectId]) {
      allSecrets[projectId] = {};
    }

    allSecrets[projectId][collectionId] = encrypted;
    this.store.set('secrets', allSecrets);
  }

  deleteValues(projectId: string, collectionId: string): void {
    const allSecrets = { ...this.store.get('secrets', {}) } as Record<
      string,
      Record<string, Record<string, string>>
    >;

    if (!allSecrets[projectId]?.[collectionId]) {
      return;
    }

    delete allSecrets[projectId][collectionId];

    if (Object.keys(allSecrets[projectId]).length === 0) {
      delete allSecrets[projectId];
    }

    this.store.set('secrets', allSecrets);
  }

  deleteProjectValues(projectId: string): void {
    const allSecrets = { ...this.store.get('secrets', {}) } as Record<
      string,
      Record<string, Record<string, string>>
    >;

    delete allSecrets[projectId];
    this.store.set('secrets', allSecrets);
  }
}

export const passwordCredentialStore = new PasswordCredentialStoreService();

import { safeStorage } from 'electron';
import Store from 'electron-store';

interface CredentialStoreShape {
  secrets: Record<string, Record<string, Record<string, string>>>;
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
      values[fieldId] = decryptValue(encryptedValue);
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

      encrypted[fieldId] = encryptValue(value);
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

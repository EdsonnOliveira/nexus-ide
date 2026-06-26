import { safeStorage } from 'electron';
import Store from 'electron-store';

export interface TaskCredentialSecrets {
  jiraApiToken?: string;
  trelloApiKey?: string;
  trelloToken?: string;
  deepcrmApiToken?: string;
}

interface CredentialStoreShape {
  secrets: Record<string, TaskCredentialSecrets>;
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

class TaskCredentialStoreService {
  private store = new Store<CredentialStoreShape>({
    name: 'task-credentials',
    defaults: {
      secrets: {},
    },
  });

  getSecrets(projectId: string): TaskCredentialSecrets {
    const allSecrets = this.store.get('secrets', {}) as Record<string, Record<string, string>>;
    const encrypted = allSecrets[projectId] ?? {};

    return {
      jiraApiToken: encrypted.jiraApiToken ? decryptValue(encrypted.jiraApiToken) : undefined,
      trelloApiKey: encrypted.trelloApiKey ? decryptValue(encrypted.trelloApiKey) : undefined,
      trelloToken: encrypted.trelloToken ? decryptValue(encrypted.trelloToken) : undefined,
      deepcrmApiToken: encrypted.deepcrmApiToken ? decryptValue(encrypted.deepcrmApiToken) : undefined,
    };
  }

  saveSecrets(projectId: string, secrets: TaskCredentialSecrets): void {
    const current = this.getSecrets(projectId);
    const merged: TaskCredentialSecrets = {
      jiraApiToken: secrets.jiraApiToken ?? current.jiraApiToken,
      trelloApiKey: secrets.trelloApiKey ?? current.trelloApiKey,
      trelloToken: secrets.trelloToken ?? current.trelloToken,
      deepcrmApiToken: secrets.deepcrmApiToken ?? current.deepcrmApiToken,
    };
    const allSecrets = { ...this.store.get('secrets', {}) } as Record<string, Record<string, string>>;
    const encrypted: Record<string, string> = {};

    if (merged.jiraApiToken) {
      encrypted.jiraApiToken = encryptValue(merged.jiraApiToken);
    }

    if (merged.trelloApiKey) {
      encrypted.trelloApiKey = encryptValue(merged.trelloApiKey);
    }

    if (merged.trelloToken) {
      encrypted.trelloToken = encryptValue(merged.trelloToken);
    }

    if (merged.deepcrmApiToken) {
      encrypted.deepcrmApiToken = encryptValue(merged.deepcrmApiToken);
    }

    allSecrets[projectId] = encrypted;
    this.store.set('secrets', allSecrets);
  }

  clearSecrets(projectId: string): void {
    const allSecrets = { ...this.store.get('secrets', {}) } as Record<string, Record<string, string>>;
    delete allSecrets[projectId];
    this.store.set('secrets', allSecrets);
  }
}

export const taskCredentialStore = new TaskCredentialStoreService();

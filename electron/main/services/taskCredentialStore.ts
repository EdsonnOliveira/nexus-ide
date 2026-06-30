import Store from 'electron-store';
import {
  decryptCredentialValue,
  encryptCredentialValue,
} from './credentialCrypto';

export interface TaskCredentialSecrets {
  jiraApiToken?: string;
  trelloApiKey?: string;
  trelloToken?: string;
  deepcrmApiToken?: string;
}

interface CredentialStoreShape {
  secrets: Record<string, Record<string, string>>;
}

function readSecretValue(encrypted: string | undefined): string | undefined {
  if (!encrypted) {
    return undefined;
  }

  return decryptCredentialValue(encrypted) ?? undefined;
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
      jiraApiToken: readSecretValue(encrypted.jiraApiToken),
      trelloApiKey: readSecretValue(encrypted.trelloApiKey),
      trelloToken: readSecretValue(encrypted.trelloToken),
      deepcrmApiToken: readSecretValue(encrypted.deepcrmApiToken),
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
      encrypted.jiraApiToken = encryptCredentialValue(merged.jiraApiToken);
    }

    if (merged.trelloApiKey) {
      encrypted.trelloApiKey = encryptCredentialValue(merged.trelloApiKey);
    }

    if (merged.trelloToken) {
      encrypted.trelloToken = encryptCredentialValue(merged.trelloToken);
    }

    if (merged.deepcrmApiToken) {
      encrypted.deepcrmApiToken = encryptCredentialValue(merged.deepcrmApiToken);
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

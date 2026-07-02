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

export type TaskCredentialFieldStatus = 'missing' | 'readable' | 'unreadable';

export interface TaskCredentialStatus {
  jiraApiToken: TaskCredentialFieldStatus;
  trelloApiKey: TaskCredentialFieldStatus;
  trelloToken: TaskCredentialFieldStatus;
  deepcrmApiToken: TaskCredentialFieldStatus;
}

interface CredentialStoreShape {
  secrets: Record<string, Record<string, string>>;
}

type SecretKey = keyof TaskCredentialSecrets;

const SECRET_KEYS: SecretKey[] = ['jiraApiToken', 'trelloApiKey', 'trelloToken', 'deepcrmApiToken'];

function readSecretValue(encrypted: string | undefined): string | undefined {
  if (!encrypted) {
    return undefined;
  }

  return decryptCredentialValue(encrypted) ?? undefined;
}

function resolveFieldStatus(encrypted: string | undefined): TaskCredentialFieldStatus {
  if (!encrypted) {
    return 'missing';
  }

  return readSecretValue(encrypted) ? 'readable' : 'unreadable';
}

class TaskCredentialStoreService {
  private store = new Store<CredentialStoreShape>({
    name: 'task-credentials',
    defaults: {
      secrets: {},
    },
  });

  private readEncrypted(projectId: string): Record<string, string> {
    const allSecrets = this.store.get('secrets', {}) as Record<string, Record<string, string>>;

    return allSecrets[projectId] ?? {};
  }

  getCredentialStatus(projectId: string): TaskCredentialStatus {
    const encrypted = this.readEncrypted(projectId);

    return {
      jiraApiToken: resolveFieldStatus(encrypted.jiraApiToken),
      trelloApiKey: resolveFieldStatus(encrypted.trelloApiKey),
      trelloToken: resolveFieldStatus(encrypted.trelloToken),
      deepcrmApiToken: resolveFieldStatus(encrypted.deepcrmApiToken),
    };
  }

  getSecrets(projectId: string): TaskCredentialSecrets {
    const encrypted = this.readEncrypted(projectId);

    return {
      jiraApiToken: readSecretValue(encrypted.jiraApiToken),
      trelloApiKey: readSecretValue(encrypted.trelloApiKey),
      trelloToken: readSecretValue(encrypted.trelloToken),
      deepcrmApiToken: readSecretValue(encrypted.deepcrmApiToken),
    };
  }

  saveSecrets(projectId: string, secrets: TaskCredentialSecrets): void {
    const allSecrets = { ...this.store.get('secrets', {}) } as Record<string, Record<string, string>>;
    const stored = { ...(allSecrets[projectId] ?? {}) };
    const current = this.getSecrets(projectId);

    for (const key of SECRET_KEYS) {
      const incoming = secrets[key];

      if (incoming !== undefined) {
        if (incoming) {
          stored[key] = encryptCredentialValue(incoming);
        } else {
          delete stored[key];
        }
        continue;
      }

      if (current[key]) {
        stored[key] = encryptCredentialValue(current[key]!);
      }
    }

    if (Object.keys(stored).length === 0) {
      delete allSecrets[projectId];
    } else {
      allSecrets[projectId] = stored;
    }

    this.store.set('secrets', allSecrets);
  }

  clearSecrets(projectId: string): void {
    const allSecrets = { ...this.store.get('secrets', {}) } as Record<string, Record<string, string>>;
    delete allSecrets[projectId];
    this.store.set('secrets', allSecrets);
  }
}

export const taskCredentialStore = new TaskCredentialStoreService();

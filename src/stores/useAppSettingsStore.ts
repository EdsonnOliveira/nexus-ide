import { create } from 'zustand';
import {
  DEFAULT_AI_PROVIDER,
  isSelectableAiProviderId,
  type AiProviderId,
} from '@/constants/aiProviders';

interface AppSettingsState {
  preferredAiProvider: Exclude<AiProviderId, 'nexus'>;
  setPreferredAiProvider: (provider: AiProviderId) => void;
}

const STORAGE_KEY = 'nexus-app-settings';

interface PersistedAppSettings {
  preferredAiProvider?: string;
}

function readPreferredAiProvider(): Exclude<AiProviderId, 'nexus'> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return DEFAULT_AI_PROVIDER;
    }

    const parsed = JSON.parse(raw) as PersistedAppSettings;

    if (parsed?.preferredAiProvider && isSelectableAiProviderId(parsed.preferredAiProvider)) {
      return parsed.preferredAiProvider;
    }

    return DEFAULT_AI_PROVIDER;
  } catch {
    return DEFAULT_AI_PROVIDER;
  }
}

function writePreferredAiProvider(provider: Exclude<AiProviderId, 'nexus'>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ preferredAiProvider: provider }));
  } catch {
    return;
  }
}

export const useAppSettingsStore = create<AppSettingsState>((set) => ({
  preferredAiProvider: readPreferredAiProvider(),
  setPreferredAiProvider: (provider) => {
    if (!isSelectableAiProviderId(provider)) {
      return;
    }

    writePreferredAiProvider(provider);
    set({ preferredAiProvider: provider });
  },
}));

import { create } from 'zustand';
import {
  DEFAULT_AI_PROVIDER,
  isSelectableAiProviderId,
  type AiProviderId,
} from '@/constants/aiProviders';

interface AppSettingsState {
  preferredAiProvider: Exclude<AiProviderId, 'nexus'>;
  notificationSoundEnabled: boolean;
  setPreferredAiProvider: (provider: AiProviderId) => void;
  setNotificationSoundEnabled: (enabled: boolean) => void;
}

const STORAGE_KEY = 'nexus-app-settings';

interface PersistedAppSettings {
  preferredAiProvider?: string;
  notificationSoundEnabled?: boolean;
}

interface LoadedAppSettings {
  preferredAiProvider: Exclude<AiProviderId, 'nexus'>;
  notificationSoundEnabled: boolean;
}

function readPersistedSettings(): LoadedAppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return {
        preferredAiProvider: DEFAULT_AI_PROVIDER,
        notificationSoundEnabled: true,
      };
    }

    const parsed = JSON.parse(raw) as PersistedAppSettings;

    return {
      preferredAiProvider:
        parsed?.preferredAiProvider && isSelectableAiProviderId(parsed.preferredAiProvider)
          ? parsed.preferredAiProvider
          : DEFAULT_AI_PROVIDER,
      notificationSoundEnabled: parsed?.notificationSoundEnabled !== false,
    };
  } catch {
    return {
      preferredAiProvider: DEFAULT_AI_PROVIDER,
      notificationSoundEnabled: true,
    };
  }
}

function writePersistedSettings(settings: LoadedAppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    return;
  }
}

const initialSettings = readPersistedSettings();

export const useAppSettingsStore = create<AppSettingsState>((set, get) => ({
  preferredAiProvider: initialSettings.preferredAiProvider,
  notificationSoundEnabled: initialSettings.notificationSoundEnabled,
  setPreferredAiProvider: (provider) => {
    if (!isSelectableAiProviderId(provider)) {
      return;
    }

    writePersistedSettings({
      preferredAiProvider: provider,
      notificationSoundEnabled: get().notificationSoundEnabled,
    });
    set({ preferredAiProvider: provider });
  },
  setNotificationSoundEnabled: (enabled) => {
    writePersistedSettings({
      preferredAiProvider: get().preferredAiProvider,
      notificationSoundEnabled: enabled,
    });
    set({ notificationSoundEnabled: enabled });
  },
}));

export function isNotificationSoundEnabled(): boolean {
  return useAppSettingsStore.getState().notificationSoundEnabled;
}

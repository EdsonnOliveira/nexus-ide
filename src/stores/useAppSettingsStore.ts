import { create } from 'zustand';
import {
  DEFAULT_AI_PROVIDER,
  isSelectableAiProviderId,
  normalizeEnabledAiProviders,
  normalizeNoAttachmentAiProvider,
  resolveEnabledAiProvider,
  type AiProviderId,
  type SelectableAiProviderId,
} from '@/constants/aiProviders';

interface AppSettingsState {
  preferredAiProvider: SelectableAiProviderId;
  enabledAiProviders: SelectableAiProviderId[];
  noAttachmentAiProvider: SelectableAiProviderId | null;
  notificationSoundEnabled: boolean;
  setPreferredAiProvider: (provider: AiProviderId) => void;
  setEnabledAiProvider: (provider: SelectableAiProviderId, enabled: boolean) => void;
  setNoAttachmentAiProvider: (provider: SelectableAiProviderId | null) => void;
  setNotificationSoundEnabled: (enabled: boolean) => void;
}

const STORAGE_KEY = 'nexus-app-settings';

interface PersistedAppSettings {
  preferredAiProvider?: string;
  enabledAiProviders?: unknown;
  noAttachmentAiProvider?: unknown;
  notificationSoundEnabled?: boolean;
}

interface LoadedAppSettings {
  preferredAiProvider: SelectableAiProviderId;
  enabledAiProviders: SelectableAiProviderId[];
  noAttachmentAiProvider: SelectableAiProviderId | null;
  notificationSoundEnabled: boolean;
}

function readPersistedSettings(): LoadedAppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return {
        preferredAiProvider: DEFAULT_AI_PROVIDER,
        enabledAiProviders: normalizeEnabledAiProviders(undefined),
        noAttachmentAiProvider: null,
        notificationSoundEnabled: true,
      };
    }

    const parsed = JSON.parse(raw) as PersistedAppSettings;
    const enabledAiProviders = normalizeEnabledAiProviders(parsed?.enabledAiProviders);
    const preferredAiProvider =
      parsed?.preferredAiProvider && isSelectableAiProviderId(parsed.preferredAiProvider)
        ? parsed.preferredAiProvider
        : DEFAULT_AI_PROVIDER;

    return {
      preferredAiProvider: resolveEnabledAiProvider(preferredAiProvider, enabledAiProviders),
      enabledAiProviders,
      noAttachmentAiProvider: normalizeNoAttachmentAiProvider(parsed?.noAttachmentAiProvider),
      notificationSoundEnabled: parsed?.notificationSoundEnabled !== false,
    };
  } catch {
    return {
      preferredAiProvider: DEFAULT_AI_PROVIDER,
      enabledAiProviders: normalizeEnabledAiProviders(undefined),
      noAttachmentAiProvider: null,
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
  enabledAiProviders: initialSettings.enabledAiProviders,
  noAttachmentAiProvider: initialSettings.noAttachmentAiProvider,
  notificationSoundEnabled: initialSettings.notificationSoundEnabled,
  setPreferredAiProvider: (provider) => {
    if (!isSelectableAiProviderId(provider)) {
      return;
    }

    const enabledAiProviders = get().enabledAiProviders.includes(provider)
      ? get().enabledAiProviders
      : normalizeEnabledAiProviders([...get().enabledAiProviders, provider]);
    const next: LoadedAppSettings = {
      preferredAiProvider: provider,
      enabledAiProviders,
      noAttachmentAiProvider: get().noAttachmentAiProvider,
      notificationSoundEnabled: get().notificationSoundEnabled,
    };

    writePersistedSettings(next);
    set(next);
  },
  setEnabledAiProvider: (provider, enabled) => {
    const current = get().enabledAiProviders;
    const nextEnabled = enabled
      ? normalizeEnabledAiProviders([...current, provider])
      : normalizeEnabledAiProviders(current.filter((id) => id !== provider));

    if (!enabled && nextEnabled.length === current.length) {
      return;
    }

    if (enabled && nextEnabled.length === current.length && current.includes(provider)) {
      return;
    }

    const next: LoadedAppSettings = {
      preferredAiProvider: resolveEnabledAiProvider(get().preferredAiProvider, nextEnabled),
      enabledAiProviders: nextEnabled,
      noAttachmentAiProvider:
        !enabled && get().noAttachmentAiProvider === provider ? null : get().noAttachmentAiProvider,
      notificationSoundEnabled: get().notificationSoundEnabled,
    };

    writePersistedSettings(next);
    set(next);
  },
  setNoAttachmentAiProvider: (provider) => {
    if (provider !== null && !isSelectableAiProviderId(provider)) {
      return;
    }

    const enabledAiProviders =
      provider && !get().enabledAiProviders.includes(provider)
        ? normalizeEnabledAiProviders([...get().enabledAiProviders, provider])
        : get().enabledAiProviders;
    const next: LoadedAppSettings = {
      preferredAiProvider: resolveEnabledAiProvider(get().preferredAiProvider, enabledAiProviders),
      enabledAiProviders,
      noAttachmentAiProvider: provider,
      notificationSoundEnabled: get().notificationSoundEnabled,
    };

    writePersistedSettings(next);
    set(next);
  },
  setNotificationSoundEnabled: (enabled) => {
    const next: LoadedAppSettings = {
      preferredAiProvider: get().preferredAiProvider,
      enabledAiProviders: get().enabledAiProviders,
      noAttachmentAiProvider: get().noAttachmentAiProvider,
      notificationSoundEnabled: enabled,
    };

    writePersistedSettings(next);
    set(next);
  },
}));

export function isNotificationSoundEnabled(): boolean {
  return useAppSettingsStore.getState().notificationSoundEnabled;
}

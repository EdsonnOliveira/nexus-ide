import {
  DEFAULT_CAPABILITIES,
  type DeviceCapabilities,
  type RuntimeStatus,
} from '@nexus/protocol';
import { createWebBridge } from './webBridge';
import type { NexusBridge } from './types';
import type { NexusSupabaseConfig } from '@nexus/supabase';

interface LocalRuntimeStatus {
  online: boolean;
  deviceId?: string | null;
  workspaceId?: string | null;
  hostname?: string | null;
  name?: string | null;
  lastSeenAt?: string | null;
  capabilities?: Partial<DeviceCapabilities>;
  activeAgents: number;
  activeTerminals: number;
}

interface NexusDesktopApi {
  dialog?: {
    openDirectory?: () => Promise<string | null>;
  };
  cloud?: {
    getLocalRuntimeStatus?: () => Promise<LocalRuntimeStatus>;
  };
}

function getDesktopApi(): NexusDesktopApi | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return (window as Window & { nexus?: NexusDesktopApi }).nexus ?? null;
}

export function createElectronBridge(config: NexusSupabaseConfig): NexusBridge {
  const webBridge = createWebBridge(config);

  return {
    ...webBridge,
    async openLocalFolder(): Promise<string | null> {
      const desktop = getDesktopApi();
      if (!desktop?.dialog?.openDirectory) {
        return null;
      }
      return desktop.dialog.openDirectory();
    },
    async getRuntimeStatus(): Promise<RuntimeStatus> {
      const status = await webBridge.getRuntimeStatus();
      const desktop = getDesktopApi();
      if (desktop?.cloud?.getLocalRuntimeStatus) {
        const local = await desktop.cloud.getLocalRuntimeStatus();
        return {
          ...status,
          online: local.online || status.online,
          deviceId: local.deviceId ?? status.deviceId,
          workspaceId: local.workspaceId ?? status.workspaceId,
          hostname: local.hostname ?? status.hostname,
          name: local.name ?? status.name,
          lastSeenAt: local.lastSeenAt ?? status.lastSeenAt,
          capabilities: { ...DEFAULT_CAPABILITIES, ...local.capabilities },
          activeAgents: local.activeAgents,
          activeTerminals: local.activeTerminals,
        };
      }
      return status;
    },
  };
}

import { create } from 'zustand';
import type { CommandApproval, DeviceRecord } from '@nexus/protocol';
import { isDeviceOnline } from '@nexus/supabase';
import { cloudBridge, cloudSupabase, isNexusCloudConfigured } from '@/lib/nexusCloud';

interface CloudState {
  configured: boolean;
  authenticated: boolean;
  accountEmail: string | null;
  devices: DeviceRecord[];
  approvals: CommandApproval[];
  selectedDeviceId: string | null;
  runtimeOnline: boolean;
  drawerOpen: boolean;
  loading: boolean;
  setDrawerOpen: (open: boolean) => void;
  setSelectedDeviceId: (id: string | null) => void;
  refresh: () => Promise<void>;
  decideApproval: (id: string, status: 'approved' | 'denied') => Promise<void>;
  signOut: () => Promise<void>;
}

export const useCloudStore = create<CloudState>((set, get) => ({
  configured: isNexusCloudConfigured,
  authenticated: false,
  accountEmail: null,
  devices: [],
  approvals: [],
  selectedDeviceId: null,
  runtimeOnline: false,
  drawerOpen: false,
  loading: false,
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setSelectedDeviceId: (selectedDeviceId) => set({ selectedDeviceId }),
  refresh: async () => {
    if (!cloudBridge || !cloudSupabase) {
      set({ configured: false });
      return;
    }
    set({ loading: true });
    try {
      const {
        data: { session },
      } = await cloudSupabase.auth.getSession();
      if (!session) {
        set({
          authenticated: false,
          accountEmail: null,
          devices: [],
          approvals: [],
          runtimeOnline: false,
          loading: false,
        });
        return;
      }
      const [devices, approvals, localStatus] = await Promise.all([
        cloudBridge.listDevices(),
        cloudBridge.listApprovals(),
        window.nexus?.cloud?.getLocalRuntimeStatus?.() ??
          Promise.resolve({ online: false }),
      ]);
      const selectedDeviceId =
        get().selectedDeviceId ??
        devices.find((device) => device.is_default && isDeviceOnline(device.last_seen_at))?.id ??
        devices.find((device) => isDeviceOnline(device.last_seen_at))?.id ??
        devices[0]?.id ??
        null;
      set({
        authenticated: true,
        accountEmail: session.user.email ?? null,
        devices,
        approvals,
        selectedDeviceId,
        runtimeOnline: Boolean(localStatus.online),
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },
  decideApproval: async (id, status) => {
    if (!cloudBridge) {
      return;
    }
    await cloudBridge.decideApproval(id, status);
    await get().refresh();
  },
  signOut: async () => {
    if (!cloudSupabase) {
      return;
    }
    await cloudSupabase.auth.signOut();
    set({
      authenticated: false,
      accountEmail: null,
      devices: [],
      approvals: [],
      selectedDeviceId: null,
      runtimeOnline: false,
    });
  },
}));

cloudSupabase?.auth.onAuthStateChange(() => {
  void useCloudStore.getState().refresh();
});

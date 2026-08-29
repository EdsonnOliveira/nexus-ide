import { useEffect } from 'react';
import { subscribeDesktopAgentViewed } from '@nexus/supabase';
import { cloudSupabase } from '@/lib/nexusCloud';
import { useProjectNotificationStore } from '@/stores/useProjectNotificationStore';

export function useDesktopAgentViewedAck(): void {
  useEffect(() => {
    if (!cloudSupabase || !window.nexus?.cloud?.getLocalRuntimeStatus) {
      return;
    }

    const client = cloudSupabase;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let subscribedDeviceId: string | null = null;

    const subscribe = async () => {
      const status = await window.nexus.cloud.getLocalRuntimeStatus();
      const deviceId = status.deviceId?.trim() || null;
      if (!deviceId || cancelled) {
        return;
      }
      if (subscribedDeviceId === deviceId && unsubscribe) {
        return;
      }

      unsubscribe?.();
      unsubscribe = subscribeDesktopAgentViewed(client, deviceId, (paneId) => {
        useProjectNotificationStore.getState().clearNotificationForPane(paneId);
      });
      subscribedDeviceId = deviceId;

      if (cancelled) {
        unsubscribe();
        unsubscribe = null;
        subscribedDeviceId = null;
      }
    };

    void subscribe();
    const timer = window.setInterval(() => {
      void subscribe();
    }, 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unsubscribe?.();
    };
  }, []);
}

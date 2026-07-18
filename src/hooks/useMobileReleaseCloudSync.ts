import { useEffect, useRef } from 'react';
import { upsertMobileReleaseSnapshot } from '@nexus/supabase';
import { cloudSupabase } from '@/lib/nexusCloud';
import { useCloudStore } from '@/stores/useCloudStore';
import { useMobileReleaseStore } from '@/stores/useMobileReleaseStore';
import type { MobileActiveRelease } from '@/types';

const VISIBLE_FINISHED_MS = 60 * 60 * 1000;

function pickActiveRelease(
  releases: Record<string, MobileActiveRelease>,
  historyByProject: Record<string, MobileActiveRelease[]>,
  dismissedUids: Set<string>,
): MobileActiveRelease | null {
  const now = Date.now();
  const merged = new Map<string, MobileActiveRelease>();

  for (const entry of Object.values(releases)) {
    merged.set(entry.uid, entry);
  }

  for (const entry of Object.values(historyByProject).flat()) {
    if (!merged.has(entry.uid)) {
      merged.set(entry.uid, entry);
    }
  }

  const visible = [...merged.values()]
    .filter((release) => {
      if (dismissedUids.has(release.uid)) {
        return false;
      }
      if (release.state === 'BUILDING') {
        return true;
      }
      const finishedAt = release.readyAt ?? release.createdAt;
      return now - finishedAt <= VISIBLE_FINISHED_MS;
    })
    .sort((left, right) => right.createdAt - left.createdAt);

  return visible[0] ?? null;
}

export function useMobileReleaseCloudSync(enabled: boolean): void {
  const releases = useMobileReleaseStore((state) => state.releases);
  const dismissedUids = useMobileReleaseStore((state) => state.dismissedUids);
  const historyByProject = useMobileReleaseStore((state) => state.historyByProject);
  const selectedDeviceId = useCloudStore((state) => state.selectedDeviceId);
  const devices = useCloudStore((state) => state.devices);
  const lastPayloadRef = useRef<string>('');

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        const activeRelease = pickActiveRelease(releases, historyByProject, dismissedUids);
        const historyReleases = Object.values(historyByProject).flat();
        const merged = new Map<string, MobileActiveRelease>();

        for (const entry of [...Object.values(releases), ...historyReleases]) {
          merged.set(entry.uid, entry);
        }

        const list = [...merged.values()]
          .sort((left, right) => right.createdAt - left.createdAt)
          .slice(0, 40);

        const deviceId =
          (selectedDeviceId && devices.some((device) => device.id === selectedDeviceId)
            ? selectedDeviceId
            : null) ??
          devices.find((device) => device.is_default)?.id ??
          devices[0]?.id ??
          null;

        const snapshotPayload = {
          device_id: deviceId,
          active_release: activeRelease,
          releases: list,
        };

        const payloadKey = JSON.stringify(snapshotPayload);

        if (payloadKey === lastPayloadRef.current) {
          return;
        }

        lastPayloadRef.current = payloadKey;

        try {
          await window.nexus?.cloud?.writeMobileReleaseSnapshot?.(snapshotPayload);
        } catch {}

        const client = cloudSupabase;

        if (!client) {
          return;
        }

        try {
          const {
            data: { session },
          } = await client.auth.getSession();

          if (!session?.user?.id) {
            return;
          }

          await upsertMobileReleaseSnapshot(client, {
            user_id: session.user.id,
            device_id: deviceId,
            active_release: activeRelease,
            releases: list,
          });
        } catch {
          return;
        }
      })();
    }, 400);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [devices, dismissedUids, enabled, historyByProject, releases, selectedDeviceId]);
}

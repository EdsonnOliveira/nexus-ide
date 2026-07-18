import { useCallback, useEffect, useRef, useState } from 'react';
import { getMobileReleaseSnapshot } from '@nexus/supabase';
import { supabase } from '../lib/supabase';
import {
  isMobileActiveRelease,
  parseMobileReleases,
  type MobileActiveRelease,
} from './mobileRelease';

const POLL_INTERVAL_MS = 5_000;
const DISMISSED_RELEASE_UID_STORAGE_KEY = 'nexus-web-mobile-dismissed-release-uid';
const VISIBLE_FINISHED_MS = 60 * 60 * 1000;

function readDismissedReleaseUid(): string | null {
  try {
    return localStorage.getItem(DISMISSED_RELEASE_UID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeDismissedReleaseUid(uid: string | null): void {
  try {
    if (uid) {
      localStorage.setItem(DISMISSED_RELEASE_UID_STORAGE_KEY, uid);
      return;
    }
    localStorage.removeItem(DISMISSED_RELEASE_UID_STORAGE_KEY);
  } catch {
    return;
  }
}

function pickVisibleRelease(
  active: MobileActiveRelease | null,
  releases: MobileActiveRelease[],
  dismissedUid: string | null,
): MobileActiveRelease | null {
  const now = Date.now();
  const candidates = [active, ...releases].filter((entry): entry is MobileActiveRelease =>
    Boolean(entry),
  );
  const merged = new Map<string, MobileActiveRelease>();

  for (const entry of candidates) {
    merged.set(entry.uid, entry);
  }

  const visible = [...merged.values()]
    .filter((release) => {
      if (dismissedUid && release.uid === dismissedUid) {
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

export function useWebMobileReleases(enabled: boolean) {
  const [activeRelease, setActiveRelease] = useState<MobileActiveRelease | null>(null);
  const [releases, setReleases] = useState<MobileActiveRelease[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [dismissedUid, setDismissedUid] = useState<string | null>(() => readDismissedReleaseUid());
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user?.id) {
        if (requestIdRef.current === requestId) {
          setActiveRelease(null);
          setReleases([]);
          setDeviceId(null);
        }
        return null;
      }

      const snapshot = await getMobileReleaseSnapshot(supabase, session.user.id);

      if (requestIdRef.current !== requestId) {
        return snapshot;
      }

      if (!snapshot) {
        setActiveRelease(null);
        setReleases([]);
        setDeviceId(null);
        return null;
      }

      const parsedList = parseMobileReleases(snapshot.releases);
      const parsedActive = isMobileActiveRelease(snapshot.active_release)
        ? snapshot.active_release
        : (parsedList[0] ?? null);

      setReleases(parsedList);
      setDeviceId(typeof snapshot.device_id === 'string' ? snapshot.device_id : null);
      setActiveRelease(pickVisibleRelease(parsedActive, parsedList, dismissedUid));
      return snapshot;
    } catch {
      return null;
    }
  }, [dismissedUid]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void refresh();

    const intervalId = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    const channel = supabase
      .channel('mobile-release-snapshots')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mobile_release_snapshots',
        },
        () => {
          void refresh();
        },
      )
      .subscribe();

    return () => {
      window.clearInterval(intervalId);
      void supabase.removeChannel(channel);
    };
  }, [enabled, refresh]);

  const dismiss = useCallback(
    (uid?: string) => {
      const nextUid = uid ?? activeRelease?.uid ?? null;
      writeDismissedReleaseUid(nextUid);
      setDismissedUid(nextUid);
      setActiveRelease((current) => {
        if (!current) {
          return null;
        }
        if (nextUid && current.uid === nextUid) {
          return pickVisibleRelease(null, releases, nextUid);
        }
        return current;
      });
    },
    [activeRelease?.uid, releases],
  );

  return {
    activeRelease,
    releases,
    deviceId,
    dismiss,
    refresh,
  };
}

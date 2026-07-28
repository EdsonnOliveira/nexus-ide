import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getMobileReleaseSnapshot } from '@nexus/supabase';
import { supabase } from '../lib/supabase';
import {
  isMobileActiveRelease,
  parseMobileReleases,
  type MobileActiveRelease,
} from './mobileRelease';

const POLL_INTERVAL_MS = 5_000;
const DISMISSED_RELEASE_UIDS_STORAGE_KEY = 'nexus-web-mobile-dismissed-release-uids';
const LEGACY_DISMISSED_RELEASE_UID_STORAGE_KEY = 'nexus-web-mobile-dismissed-release-uid';
const VISIBLE_FINISHED_MS = 60 * 60 * 1000;

function readDismissedReleaseUids(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_RELEASE_UIDS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((entry): entry is string => typeof entry === 'string'));
      }
    }

    const legacy = localStorage.getItem(LEGACY_DISMISSED_RELEASE_UID_STORAGE_KEY);
    if (legacy) {
      return new Set([legacy]);
    }

    return new Set();
  } catch {
    return new Set();
  }
}

function writeDismissedReleaseUids(uids: Set<string>): void {
  try {
    localStorage.setItem(DISMISSED_RELEASE_UIDS_STORAGE_KEY, JSON.stringify([...uids]));
    localStorage.removeItem(LEGACY_DISMISSED_RELEASE_UID_STORAGE_KEY);
  } catch {
    return;
  }
}

function pickVisibleRelease(
  active: MobileActiveRelease | null,
  releases: MobileActiveRelease[],
  dismissedUids: Set<string>,
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

function collectFinishedReleaseUids(
  active: MobileActiveRelease | null,
  releases: MobileActiveRelease[],
): string[] {
  const now = Date.now();
  const candidates = [active, ...releases].filter((entry): entry is MobileActiveRelease =>
    Boolean(entry),
  );
  const merged = new Map<string, MobileActiveRelease>();

  for (const entry of candidates) {
    merged.set(entry.uid, entry);
  }

  return [...merged.values()]
    .filter((release) => {
      if (release.state === 'BUILDING') {
        return false;
      }
      const finishedAt = release.readyAt ?? release.createdAt;
      return now - finishedAt <= VISIBLE_FINISHED_MS;
    })
    .map((release) => release.uid);
}

export function useWebMobileReleases(enabled: boolean) {
  const [activeRelease, setActiveRelease] = useState<MobileActiveRelease | null>(null);
  const [releases, setReleases] = useState<MobileActiveRelease[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [dismissedUids, setDismissedUids] = useState<Set<string>>(() => readDismissedReleaseUids());
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
      setActiveRelease(parsedActive);
      return snapshot;
    } catch {
      return null;
    }
  }, []);

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

  const visibleRelease = useMemo(
    () => pickVisibleRelease(activeRelease, releases, dismissedUids),
    [activeRelease, dismissedUids, releases],
  );

  const dismiss = useCallback(
    (uid?: string) => {
      const targetUid = uid ?? visibleRelease?.uid;
      if (!targetUid) {
        return;
      }

      const next = new Set(dismissedUids);
      next.add(targetUid);

      for (const finishedUid of collectFinishedReleaseUids(activeRelease, releases)) {
        next.add(finishedUid);
      }

      writeDismissedReleaseUids(next);
      setDismissedUids(next);
    },
    [activeRelease, dismissedUids, releases, visibleRelease?.uid],
  );

  return {
    activeRelease: visibleRelease,
    releases,
    deviceId,
    dismiss,
    refresh,
  };
}

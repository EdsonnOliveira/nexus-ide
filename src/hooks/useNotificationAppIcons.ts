import { useEffect, useMemo, useState } from 'react';
import type { SystemNotificationItem } from '@/types';

export function notificationAppIconKey(appId: string, appLabel: string): string {
  return appId || appLabel;
}

export function useNotificationAppIcons(
  items: SystemNotificationItem[],
): Record<string, string | null> {
  const [icons, setIcons] = useState<Record<string, string | null>>({});

  const appsByKey = useMemo(() => {
    const map = new Map<string, { appId: string; appLabel: string }>();

    for (const item of items) {
      const key = notificationAppIconKey(item.appId, item.appLabel);

      if (!map.has(key)) {
        map.set(key, { appId: item.appId, appLabel: item.appLabel });
      }
    }

    return map;
  }, [items]);

  useEffect(() => {
    let cancelled = false;

    for (const [key, { appId, appLabel }] of appsByKey) {
      void window.nexus.systemNotifications.getAppIcon(appId, appLabel).then((iconUrl) => {
        if (!cancelled) {
          setIcons((previous) => ({ ...previous, [key]: iconUrl }));
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [appsByKey]);

  return icons;
}

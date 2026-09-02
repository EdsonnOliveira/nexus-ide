import { useCallback, useEffect, useRef, useState } from 'react';
import { upsertUserRenderTokens, upsertRenderDeploySnapshot } from '@nexus/supabase';
import { cloudSupabase } from '@/lib/nexusCloud';
import type { RenderActiveDeployment } from '@/types';
import { notifyDeployWebPush } from '@/utils/notifyDeployWebPush';
import { isRenderInProgressDeployment, isRenderNotifyDeployment } from '@/utils/renderDeployment';

const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 30_000;
const HIDDEN_POLL_MS = 120_000;
const DISMISSED_DEPLOY_UID_STORAGE_KEY = 'nexus-render-dismissed-deploy-uid';

function readDismissedDeployUid(): string | null {
  try {
    return localStorage.getItem(DISMISSED_DEPLOY_UID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeDismissedDeployUid(uid: string | null): void {
  try {
    if (uid) {
      localStorage.setItem(DISMISSED_DEPLOY_UID_STORAGE_KEY, uid);
      return;
    }

    localStorage.removeItem(DISMISSED_DEPLOY_UID_STORAGE_KEY);
  } catch {
    return;
  }
}

async function syncRenderDeployCloud(
  activeDeployment: RenderActiveDeployment | null,
  deployments: RenderActiveDeployment[],
): Promise<void> {
  if (!cloudSupabase || !window.nexus?.render) {
    return;
  }

  try {
    const {
      data: { session },
    } = await cloudSupabase.auth.getSession();

    if (!session?.user?.id) {
      return;
    }

    const keys = await window.nexus.render.listKeys();
    const tokens: Array<{ credential_id: string; label: string; token: string }> = [];
    for (const key of keys) {
      try {
        const token = await window.nexus.render.getKeyToken(key.id);
        if (typeof token === 'string' && token.trim()) {
          tokens.push({
            credential_id: key.id,
            label: key.label,
            token: token.trim(),
          });
        }
      } catch {
        continue;
      }
    }

    await upsertUserRenderTokens(cloudSupabase, session.user.id, tokens);
    await upsertRenderDeploySnapshot(cloudSupabase, {
      user_id: session.user.id,
      active_deployment: activeDeployment,
      deployments,
    });
  } catch {
    return;
  }
}

export function useRenderDeployments(enabled: boolean) {
  const [keysConfigured, setKeysConfigured] = useState(false);
  const [activeDeployment, setActiveDeployment] = useState<RenderActiveDeployment | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissedUid, setDismissedUid] = useState<string | null>(() => readDismissedDeployUid());
  const requestIdRef = useRef(0);
  const deployStatesRef = useRef<Map<string, string>>(new Map());
  const deployPrimedRef = useRef(false);

  const observeDeployments = useCallback((deployments: RenderActiveDeployment[]) => {
    if (!deployPrimedRef.current) {
      for (const item of deployments) {
        deployStatesRef.current.set(`${item.credentialId}:${item.uid}`, item.state);
      }
      deployPrimedRef.current = true;
      return;
    }
    for (const item of deployments) {
      const key = `${item.credentialId}:${item.uid}`;
      const previous = deployStatesRef.current.get(key);
      deployStatesRef.current.set(key, item.state);
      if (previous && previous !== item.state && isRenderNotifyDeployment(item.state)) {
        notifyDeployWebPush({
          provider: 'render',
          uid: item.uid,
          state: item.state,
          projectName: item.projectName,
          branch: item.branch,
          dedupeKey: `deploy:render:${item.credentialId}:${item.uid}:${item.state}`,
        });
      }
    }
  }, []);

  const refreshKeysConfigured = useCallback(async () => {
    if (!window.nexus?.render) {
      setKeysConfigured(false);
      return false;
    }

    try {
      const configured = await window.nexus.render.getKeysConfigured();
      setKeysConfigured(configured);
      return configured;
    } catch {
      setKeysConfigured(false);
      return false;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!window.nexus?.render) {
      setActiveDeployment(null);
      setKeysConfigured(false);
      return null;
    }

    try {
      const configured = await window.nexus.render.getKeysConfigured();
      setKeysConfigured(configured);

      if (!configured) {
        setActiveDeployment(null);
        setError(null);
        return null;
      }
    } catch {
      setKeysConfigured(false);
      setActiveDeployment(null);
      setError(null);
      return null;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);

    try {
      const deployments = await window.nexus.render.listDeployments();
      const deployment = deployments[0] ?? null;

      if (requestIdRef.current === requestId) {
        setActiveDeployment(deployment);
        setError(null);
        observeDeployments(deployments);
      }

      void syncRenderDeployCloud(deployment, deployments);

      return deployment;
    } catch {
      if (requestIdRef.current === requestId) {
        setActiveDeployment(null);
        setError('Não foi possível consultar deploys na Render');
      }

      return null;
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [observeDeployments]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void refreshKeysConfigured();
  }, [enabled, refreshKeysConfigured]);

  useEffect(() => {
    if (!enabled || !keysConfigured) {
      setActiveDeployment(null);
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    let lastHasActive = false;

    const schedule = (hasActive: boolean) => {
      if (cancelled) {
        return;
      }

      lastHasActive = hasActive;

      if (timer !== null) {
        window.clearTimeout(timer);
      }

      const delayMs =
        document.visibilityState === 'hidden'
          ? HIDDEN_POLL_MS
          : hasActive
            ? ACTIVE_POLL_MS
            : IDLE_POLL_MS;

      timer = window.setTimeout(() => {
        void refresh().then((deployment) => {
          schedule(Boolean(deployment && isRenderInProgressDeployment(deployment.state)));
        });
      }, delayMs);
    };

    const startId = window.setTimeout(() => {
      if (cancelled) {
        return;
      }

      void refresh().then((deployment) => {
        schedule(Boolean(deployment && isRenderInProgressDeployment(deployment.state)));
      });
    }, 2_500);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh().then((deployment) => {
          schedule(Boolean(deployment && isRenderInProgressDeployment(deployment.state)));
        });
        return;
      }

      schedule(lastHasActive);
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearTimeout(startId);

      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [enabled, refresh, keysConfigured]);

  const dismiss = useCallback(() => {
    const uid = activeDeployment?.uid;

    if (!uid) {
      return;
    }

    const dismissedKey = activeDeployment.credentialId
      ? `${activeDeployment.credentialId}:${uid}`
      : uid;
    setDismissedUid(dismissedKey);
    writeDismissedDeployUid(dismissedKey);
  }, [activeDeployment]);

  const visibleDeployment = (() => {
    if (!activeDeployment) {
      return null;
    }

    const dismissedKey = activeDeployment.credentialId
      ? `${activeDeployment.credentialId}:${activeDeployment.uid}`
      : activeDeployment.uid;

    if (dismissedUid === dismissedKey || dismissedUid === activeDeployment.uid) {
      return null;
    }

    return activeDeployment;
  })();

  return {
    keysConfigured,
    activeDeployment: visibleDeployment,
    loading,
    error,
    dismissedUid,
    refresh,
    refreshKeysConfigured,
    dismiss,
    setDismissedUid,
  };
}

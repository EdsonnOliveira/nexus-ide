import { useCallback, useEffect, useRef, useState } from 'react';
import { upsertUserVercelToken, upsertVercelDeploySnapshot } from '@nexus/supabase';
import { cloudSupabase } from '@/lib/nexusCloud';
import type { VercelActiveDeployment } from '@/types';

const POLL_INTERVAL_MS = 5_000;
const DISMISSED_DEPLOY_UID_STORAGE_KEY = 'nexus-vercel-dismissed-deploy-uid';

async function syncVercelDeploySnapshot(
  activeDeployment: VercelActiveDeployment | null,
  deployments: VercelActiveDeployment[],
): Promise<void> {
  if (!cloudSupabase) {
    return;
  }

  try {
    const {
      data: { session },
    } = await cloudSupabase.auth.getSession();

    if (!session?.user?.id) {
      return;
    }

    if (window.nexus?.vercel?.getToken) {
      try {
        const token = await window.nexus.vercel.getToken();
        if (typeof token === 'string' && token.trim()) {
          await upsertUserVercelToken(cloudSupabase, session.user.id, token.trim());
        }
      } catch {}
    }

    await upsertVercelDeploySnapshot(cloudSupabase, {
      user_id: session.user.id,
      active_deployment: activeDeployment,
      deployments,
    });
  } catch {
    return;
  }
}

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

export function useVercelDeployments(enabled: boolean) {
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [activeDeployment, setActiveDeployment] = useState<VercelActiveDeployment | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissedUid, setDismissedUid] = useState<string | null>(() => readDismissedDeployUid());
  const requestIdRef = useRef(0);

  const refreshTokenConfigured = useCallback(async () => {
    if (!window.nexus?.vercel) {
      setTokenConfigured(false);
      return false;
    }

    try {
      const configured = await window.nexus.vercel.getTokenConfigured();
      setTokenConfigured(configured);
      return configured;
    } catch {
      setTokenConfigured(false);
      return false;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!window.nexus?.vercel) {
      setActiveDeployment(null);
      setTokenConfigured(false);
      return null;
    }

    try {
      const configured = await window.nexus.vercel.getTokenConfigured();
      setTokenConfigured(configured);

      if (!configured) {
        setActiveDeployment(null);
        setError(null);
        return null;
      }
    } catch {
      setTokenConfigured(false);
      setActiveDeployment(null);
      setError(null);
      return null;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);

    try {
      const deployments = await window.nexus.vercel.listDeployments();
      const deployment = deployments[0] ?? null;

      if (requestIdRef.current === requestId) {
        setActiveDeployment(deployment);
        setError(null);
      }

      void syncVercelDeploySnapshot(deployment, deployments);

      return deployment;
    } catch {
      if (requestIdRef.current === requestId) {
        setActiveDeployment(null);
        setError('Não foi possível consultar deploys na Vercel');
        setTokenConfigured(false);
      }

      return null;
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void refreshTokenConfigured();
  }, [enabled, refreshTokenConfigured]);

  useEffect(() => {
    if (!enabled || !tokenConfigured) {
      setActiveDeployment(null);
      return;
    }

    void refresh();

    const intervalId = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, refresh, tokenConfigured]);

  const dismiss = useCallback(() => {
    const uid = activeDeployment?.uid;

    if (!uid) {
      return;
    }

    setDismissedUid(uid);
    writeDismissedDeployUid(uid);
  }, [activeDeployment?.uid]);

  const visibleDeployment =
    activeDeployment && activeDeployment.uid !== dismissedUid ? activeDeployment : null;

  return {
    tokenConfigured,
    activeDeployment: visibleDeployment,
    loading,
    error,
    dismissedUid,
    refresh,
    refreshTokenConfigured,
    dismiss,
    setDismissedUid,
  };
}

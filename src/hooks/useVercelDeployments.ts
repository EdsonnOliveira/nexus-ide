import { useCallback, useEffect, useRef, useState } from 'react';
import type { VercelActiveDeployment } from '@/types';

const POLL_INTERVAL_MS = 5_000;
const DISMISSED_DEPLOY_UID_STORAGE_KEY = 'nexus-vercel-dismissed-deploy-uid';

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

    const configured = await window.nexus.vercel.getTokenConfigured();
    setTokenConfigured(configured);
    return configured;
  }, []);

  const refresh = useCallback(async () => {
    if (!window.nexus?.vercel) {
      setActiveDeployment(null);
      setTokenConfigured(false);
      return null;
    }

    const configured = await window.nexus.vercel.getTokenConfigured();
    setTokenConfigured(configured);

    if (!configured) {
      setActiveDeployment(null);
      setError(null);
      return null;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);

    try {
      const deployment = await window.nexus.vercel.getActiveDeployment();

      if (requestIdRef.current === requestId) {
        setActiveDeployment(deployment);
        setError(null);
      }

      return deployment;
    } catch {
      if (requestIdRef.current === requestId) {
        setActiveDeployment(null);
        setError('Não foi possível consultar deploys na Vercel');
        setTokenConfigured(await window.nexus.vercel.getTokenConfigured());
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

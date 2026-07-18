import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteUserVercelToken,
  getVercelDeploySnapshot,
  upsertUserVercelToken,
  upsertVercelDeploySnapshot,
} from '@nexus/supabase';
import { supabase } from '../lib/supabase';
import {
  fetchWebVercelActive,
  readWebVercelToken,
  writeWebVercelToken,
} from './webVercelApi';
import {
  isVercelActiveDeployment,
  parseVercelDeployments,
  type VercelActiveDeployment,
} from './vercelTypes';

const POLL_INTERVAL_MS = 5_000;
const DISMISSED_DEPLOY_UID_STORAGE_KEY = 'nexus-web-vercel-dismissed-deploy-uid';

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

export function useWebVercelDeployments(enabled: boolean) {
  const [tokenConfigured, setTokenConfigured] = useState(() => Boolean(readWebVercelToken()));
  const [activeDeployment, setActiveDeployment] = useState<VercelActiveDeployment | null>(null);
  const [deployments, setDeployments] = useState<VercelActiveDeployment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissedUid, setDismissedUid] = useState<string | null>(() => readDismissedDeployUid());
  const requestIdRef = useRef(0);

  const applySnapshot = useCallback((active: unknown, list: unknown) => {
    const parsedList = parseVercelDeployments(list);
    const parsedActive = isVercelActiveDeployment(active) ? active : (parsedList[0] ?? null);
    setDeployments(parsedList);
    setActiveDeployment(parsedActive);
  }, []);

  const refreshFromSnapshot = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id) {
        return null;
      }
      const snapshot = await getVercelDeploySnapshot(supabase, session.user.id);
      if (!snapshot) {
        return null;
      }
      applySnapshot(snapshot.active_deployment, snapshot.deployments);
      setError(null);
      return snapshot;
    } catch {
      return null;
    }
  }, [applySnapshot]);

  const refreshFromToken = useCallback(async () => {
    const token = readWebVercelToken();
    if (!token) {
      setTokenConfigured(false);
      return null;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setTokenConfigured(true);

    try {
      const result = await fetchWebVercelActive(token);
      if (requestIdRef.current !== requestId) {
        return result.deployment;
      }
      setActiveDeployment(result.deployment);
      setDeployments(result.deployments);
      setError(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user?.id) {
        void upsertUserVercelToken(supabase, session.user.id, token);
        void upsertVercelDeploySnapshot(supabase, {
          user_id: session.user.id,
          active_deployment: result.deployment,
          deployments: result.deployments,
        });
      }

      return result.deployment;
    } catch (error) {
      if (requestIdRef.current === requestId) {
        setError('Não foi possível consultar deploys na Vercel');
        const statusCode =
          error && typeof error === 'object' && 'statusCode' in error
            ? Number((error as { statusCode?: number }).statusCode)
            : undefined;
        if (statusCode === 401) {
          setTokenConfigured(false);
          writeWebVercelToken(null);
        }
      }
      return null;
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    if (readWebVercelToken()) {
      return refreshFromToken();
    }
    await refreshFromSnapshot();
    return null;
  }, [refreshFromSnapshot, refreshFromToken]);

  const refreshTokenConfigured = useCallback(async () => {
    const configured = Boolean(readWebVercelToken());
    setTokenConfigured(configured);
    return configured;
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void refreshTokenConfigured();
    void refreshFromSnapshot();
  }, [enabled, refreshFromSnapshot, refreshTokenConfigured]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (tokenConfigured) {
      void refreshFromToken();
      const intervalId = window.setInterval(() => {
        void refreshFromToken();
      }, POLL_INTERVAL_MS);
      return () => {
        window.clearInterval(intervalId);
      };
    }

    const intervalId = window.setInterval(() => {
      void refreshFromSnapshot();
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, refreshFromSnapshot, refreshFromToken, tokenConfigured]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user?.id || cancelled) {
        return;
      }

      channel = supabase
        .channel(`vercel-deploy-snapshots:${session.user.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'vercel_deploy_snapshots',
            filter: `user_id=eq.${session.user.id}`,
          },
          (payload) => {
            const row = payload.new as {
              active_deployment?: unknown;
              deployments?: unknown;
            } | null;
            if (!row) {
              return;
            }
            applySnapshot(row.active_deployment, row.deployments);
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [applySnapshot, enabled]);

  const dismiss = useCallback(() => {
    const uid = activeDeployment?.uid;
    if (!uid) {
      return;
    }
    setDismissedUid(uid);
    writeDismissedDeployUid(uid);
  }, [activeDeployment?.uid]);

  const saveToken = useCallback(
    async (token: string) => {
      const trimmed = token.trim();
      if (!trimmed) {
        writeWebVercelToken(null);
        setTokenConfigured(false);
        return false;
      }
      writeWebVercelToken(trimmed);
      setTokenConfigured(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.id) {
        await upsertUserVercelToken(supabase, user.id, trimmed);
      }
      await refreshFromToken();
      return Boolean(readWebVercelToken());
    },
    [refreshFromToken],
  );

  const clearToken = useCallback(async () => {
    writeWebVercelToken(null);
    setTokenConfigured(false);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.id) {
      await deleteUserVercelToken(supabase, user.id);
    }
    await refreshFromSnapshot();
  }, [refreshFromSnapshot]);

  const visibleDeployment =
    activeDeployment && activeDeployment.uid !== dismissedUid ? activeDeployment : null;

  return {
    tokenConfigured,
    activeDeployment: visibleDeployment,
    deployments,
    loading,
    error,
    dismiss,
    refresh,
    refreshTokenConfigured,
    saveToken,
    clearToken,
  };
}

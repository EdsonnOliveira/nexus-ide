import { useCallback, useEffect, useRef, useState } from 'react';
import { bridge } from '../lib/supabase';
import { waitForCommandResult } from './webCommandResult';

export interface WebAgentSkillHint {
  id: string;
  label: string;
  command: string;
}

function parseSkillHints(result: Record<string, unknown>): WebAgentSkillHint[] {
  const list = Array.isArray(result.skills) ? result.skills : [];
  const hints: WebAgentSkillHint[] = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? '').trim();
    const label = String(row.label ?? '').trim();
    const command = String(row.command ?? '').trim();
    if (!id || !label || !command) {
      continue;
    }
    hints.push({ id, label, command });
  }

  return hints;
}

const SKILLS_FETCH_TIMEOUT_MS = 8000;
const SKILLS_CACHE_TTL_MS = 60_000;

const skillsCache = new Map<
  string,
  { skills: WebAgentSkillHint[]; cachedAt: number }
>();

function skillsCacheKey(
  workspaceId: string,
  deviceId: string,
  projectId: string | null,
): string {
  return `${workspaceId}:${deviceId}:${projectId ?? ''}`;
}

export function useWebAgentSkills(input: {
  workspaceId: string | null;
  deviceId: string | null;
  projectId: string | null;
  enabled?: boolean;
}): {
  skills: WebAgentSkillHint[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const { workspaceId, deviceId, projectId, enabled = true } = input;
  const cacheKey =
    workspaceId && deviceId ? skillsCacheKey(workspaceId, deviceId, projectId) : null;
  const cached = cacheKey ? skillsCache.get(cacheKey) : undefined;
  const [skills, setSkills] = useState<WebAgentSkillHint[]>(() =>
    cached && Date.now() - cached.cachedAt < SKILLS_CACHE_TTL_MS ? cached.skills : [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled || !workspaceId || !deviceId) {
      requestIdRef.current += 1;
      setSkills([]);
      setError(null);
      setLoading(false);
      return;
    }

    const key = skillsCacheKey(workspaceId, deviceId, projectId);
    const existing = skillsCache.get(key);
    if (existing && Date.now() - existing.cachedAt < SKILLS_CACHE_TTL_MS) {
      setSkills(existing.skills);
      setError(null);
      setLoading(false);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);

    try {
      const commandId = await bridge.executeCommand({
        workspace_id: workspaceId,
        project_id: projectId,
        target_device_id: deviceId,
        type: 'list_agent_skills',
        payload: {},
      });
      const result = await waitForCommandResult(commandId, SKILLS_FETCH_TIMEOUT_MS);
      if (requestIdRef.current !== requestId) {
        return;
      }
      const nextSkills = parseSkillHints(result);
      skillsCache.set(key, { skills: nextSkills, cachedAt: Date.now() });
      setSkills(nextSkills);
      setError(null);
    } catch (caught) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      setSkills([]);
      const message =
        caught instanceof Error && caught.message.trim()
          ? caught.message
          : 'Não foi possível carregar as skills';
      setError(message);
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [deviceId, enabled, projectId, workspaceId]);

  useEffect(() => {
    if (!enabled || !workspaceId || !deviceId) {
      requestIdRef.current += 1;
      setSkills([]);
      setError(null);
      setLoading(false);
      return;
    }

    void refresh();

    return () => {
      requestIdRef.current += 1;
    };
  }, [deviceId, enabled, projectId, refresh, workspaceId]);

  return { skills, loading, error, refresh };
}

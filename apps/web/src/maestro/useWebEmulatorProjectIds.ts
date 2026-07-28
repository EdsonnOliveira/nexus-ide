import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CloudProject } from '@nexus/protocol';
import { bridge } from '../lib/supabase';
import { waitForCommandResult } from './webCommandResult';

export function useWebEmulatorProjectIds(input: {
  workspaceId: string | null;
  deviceId: string | null;
  projects: CloudProject[];
  enabled?: boolean;
}): Set<string> {
  const { workspaceId, deviceId, projects, enabled = true } = input;
  const [cloudProjectIds, setCloudProjectIds] = useState<string[]>([]);
  const [localProjectIds, setLocalProjectIds] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    if (!enabled || !workspaceId || !deviceId) {
      setCloudProjectIds([]);
      setLocalProjectIds([]);
      return;
    }
    try {
      const commandId = await bridge.executeCommand({
        workspace_id: workspaceId,
        target_device_id: deviceId,
        type: 'emulator_list_sessions',
        payload: {},
      });
      const result = await waitForCommandResult(commandId, 15000);
      const list = Array.isArray(result.sessions) ? result.sessions : [];
      const nextCloud: string[] = [];
      const nextLocal: string[] = [];
      for (const item of list) {
        const row = item as Record<string, unknown>;
        const cloudId = String(row.project_id ?? row.projectId ?? '').trim();
        const localId = String(row.local_project_id ?? row.localProjectId ?? '').trim();
        if (cloudId) {
          nextCloud.push(cloudId);
        }
        if (localId) {
          nextLocal.push(localId);
        }
      }
      setCloudProjectIds(nextCloud);
      setLocalProjectIds(nextLocal);
    } catch {
      setCloudProjectIds([]);
      setLocalProjectIds([]);
    }
  }, [deviceId, enabled, workspaceId]);

  useEffect(() => {
    if (!enabled || !workspaceId || !deviceId) {
      setCloudProjectIds([]);
      setLocalProjectIds([]);
      return;
    }
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 12000);
    return () => window.clearInterval(timer);
  }, [deviceId, enabled, refresh, workspaceId]);

  return useMemo(() => {
    const ids = new Set<string>(cloudProjectIds);
    const localSet = new Set(localProjectIds);
    for (const project of projects) {
      if (project.local_id && localSet.has(project.local_id)) {
        ids.add(project.id);
      }
    }
    return ids;
  }, [cloudProjectIds, localProjectIds, projects]);
}

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NexusClient } from '@nexus/supabase';

interface LocalProject {
  id: string;
  name: string;
  path: string;
  workspaceId?: string | null;
  tabs?: unknown[];
}

interface LocalAppState {
  projects?: LocalProject[];
}

interface DesktopAgentPane {
  paneId: string;
  title: string;
  localProjectId: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function userDataDir(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'nexus-ide');
}

function collectAgentPanesFromTabs(tabs: unknown[]): Array<{ id: string; title: string }> {
  const panes: Array<{ id: string; title: string }> = [];
  const seen = new Set<string>();

  const visit = (item: unknown) => {
    if (!item || typeof item !== 'object') {
      return;
    }
    const record = item as Record<string, unknown>;
    const type = typeof record.type === 'string' ? record.type : '';

    if (type === 'split' && Array.isArray(record.panes)) {
      for (const pane of record.panes) {
        visit(pane);
      }
      return;
    }

    if (type !== 'agent') {
      return;
    }

    const id = typeof record.id === 'string' ? record.id.trim() : '';
    if (!id || !UUID_RE.test(id) || seen.has(id)) {
      return;
    }

    seen.add(id);
    const title =
      typeof record.title === 'string' && record.title.trim()
        ? record.title.trim()
        : 'Agent';
    panes.push({ id, title });
  };

  for (const tab of tabs) {
    visit(tab);
  }

  return panes;
}

function readDesktopAgentPanes(): DesktopAgentPane[] {
  const projectsPath = path.join(userDataDir(), 'projects.json');
  if (!existsSync(projectsPath)) {
    return [];
  }

  let state: LocalAppState;
  try {
    state = JSON.parse(readFileSync(projectsPath, 'utf8')) as LocalAppState;
  } catch {
    return [];
  }

  const result: DesktopAgentPane[] = [];
  for (const project of state.projects ?? []) {
    if (!project?.id || !Array.isArray(project.tabs)) {
      continue;
    }
    for (const pane of collectAgentPanesFromTabs(project.tabs)) {
      result.push({
        paneId: pane.id,
        title: pane.title,
        localProjectId: project.id,
      });
    }
  }
  return result;
}

export async function publishDesktopAgentPanes(
  client: NexusClient,
  deviceId: string,
  userId: string,
): Promise<{ published: number; closed: number }> {
  const panes = readDesktopAgentPanes();
  const activePaneIds = new Set(panes.map((pane) => pane.paneId));

  const localIds = [...new Set(panes.map((pane) => pane.localProjectId))];
  const projectByLocalId = new Map<string, { id: string; workspace_id: string }>();

  if (localIds.length > 0) {
    const { data: projects } = await client
      .from('projects')
      .select('id, workspace_id, local_id')
      .in('local_id', localIds);

    for (const project of projects ?? []) {
      if (project.local_id && project.id && project.workspace_id) {
        projectByLocalId.set(project.local_id, {
          id: project.id,
          workspace_id: project.workspace_id,
        });
      }
    }
  }

  let published = 0;
  const now = new Date().toISOString();

  for (const pane of panes) {
    const cloudProject = projectByLocalId.get(pane.localProjectId);
    if (!cloudProject) {
      continue;
    }

    const { data: existing } = await client
      .from('agent_sessions')
      .select('id, source, status')
      .eq('id', pane.paneId)
      .maybeSingle();

    if (existing?.source && existing.source !== 'desktop_pane') {
      continue;
    }

    const payload = {
      workspace_id: cloudProject.workspace_id,
      project_id: cloudProject.id,
      device_id: deviceId,
      title: pane.title.slice(0, 120),
      source: 'desktop_pane' as const,
      created_by: userId,
      updated_at: now,
    };

    if (existing?.id) {
      const { error } = await client
        .from('agent_sessions')
        .update({
          ...payload,
          ...(existing.status === 'closed' ? { status: 'active' } : {}),
        })
        .eq('id', pane.paneId)
        .eq('source', 'desktop_pane');
      if (!error) {
        published += 1;
      }
      continue;
    }

    const { error } = await client.from('agent_sessions').insert({
      id: pane.paneId,
      ...payload,
      status: 'active',
    });

    if (!error) {
      published += 1;
    }
  }

  const { data: existingDesktop } = await client
    .from('agent_sessions')
    .select('id')
    .eq('device_id', deviceId)
    .eq('source', 'desktop_pane')
    .neq('status', 'closed');

  let closed = 0;
  const staleIds = (existingDesktop ?? [])
    .map((row) => row.id as string)
    .filter((id) => !activePaneIds.has(id));

  if (staleIds.length > 0) {
    const { error } = await client
      .from('agent_sessions')
      .update({ status: 'closed', updated_at: now })
      .in('id', staleIds)
      .eq('source', 'desktop_pane')
      .eq('device_id', deviceId);

    if (!error) {
      closed = staleIds.length;
    }
  }

  return { published, closed };
}

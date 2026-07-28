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

interface DesktopAgentActivity {
  kind?: string;
  label?: string;
}

interface DesktopAgentTurn {
  id: string;
  userContent: string;
  activities: DesktopAgentActivity[];
  running: boolean;
  startedAt: number;
  completedAt?: number;
}

interface DesktopAgentPane {
  paneId: string;
  title: string;
  localProjectId: string;
  turns: DesktopAgentTurn[];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_CHARS = 50_000;

function userDataDir(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'nexus-ide');
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(0, maxChars);
}

function extractActivityLabels(activities: DesktopAgentActivity[], kind: string): string {
  return activities
    .filter((activity) => activity.kind === kind)
    .map((activity) => (typeof activity.label === 'string' ? activity.label.trim() : ''))
    .filter(Boolean)
    .join('\n\n');
}

function buildDesktopTurnStreamJson(thought: string, response: string): string {
  const lines: string[] = [];
  const thoughtText = truncateText(thought.trim(), Math.floor(MAX_MESSAGE_CHARS * 0.4));
  const responseText = truncateText(response.trim(), MAX_MESSAGE_CHARS);

  if (thoughtText) {
    lines.push(JSON.stringify({ type: 'thinking', subtype: 'delta', text: thoughtText }));
    lines.push(JSON.stringify({ type: 'thinking', subtype: 'completed' }));
  }

  if (responseText) {
    lines.push(
      JSON.stringify({
        type: 'assistant',
        message: { content: responseText },
      }),
    );
  }

  lines.push(JSON.stringify({ type: 'result', result: responseText }));
  return truncateText(lines.join('\n'), MAX_MESSAGE_CHARS);
}

function turnFingerprint(turn: DesktopAgentTurn): string {
  const thought = extractActivityLabels(turn.activities, 'thought');
  const response = extractActivityLabels(turn.activities, 'response');
  return [
    turn.running ? '1' : '0',
    String(turn.completedAt ?? ''),
    String(turn.activities.length),
    String(turn.userContent.length),
    String(thought.length),
    String(response.length),
  ].join(':');
}

function parseDesktopTurn(raw: unknown): DesktopAgentTurn | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id || !UUID_RE.test(id)) {
    return null;
  }

  const user = record.user;
  let userContent = '';
  if (user && typeof user === 'object') {
    const content = (user as { content?: unknown }).content;
    if (typeof content === 'string') {
      userContent = content;
    }
  }

  const activities = Array.isArray(record.activities)
    ? record.activities
        .filter((item): item is DesktopAgentActivity => Boolean(item) && typeof item === 'object')
        .map((item) => ({
          kind: typeof item.kind === 'string' ? item.kind : undefined,
          label: typeof item.label === 'string' ? item.label : undefined,
        }))
    : [];

  const startedAt =
    typeof record.startedAt === 'number' && Number.isFinite(record.startedAt)
      ? record.startedAt
      : Date.now();
  const completedAt =
    typeof record.completedAt === 'number' && Number.isFinite(record.completedAt)
      ? record.completedAt
      : undefined;

  return {
    id,
    userContent,
    activities,
    running: record.running === true,
    startedAt,
    completedAt,
  };
}

function collectAgentPanesFromTabs(tabs: unknown[]): Array<{
  id: string;
  title: string;
  turns: DesktopAgentTurn[];
}> {
  const panes: Array<{ id: string; title: string; turns: DesktopAgentTurn[] }> = [];
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
    const turns = Array.isArray(record.turns)
      ? record.turns
          .map(parseDesktopTurn)
          .filter((turn): turn is DesktopAgentTurn => Boolean(turn))
      : [];
    panes.push({ id, title, turns });
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
        turns: pane.turns,
      });
    }
  }
  return result;
}

async function syncDesktopPaneTurns(
  client: NexusClient,
  sessionId: string,
  turns: DesktopAgentTurn[],
): Promise<void> {
  const { data: existingRows } = await client
    .from('agent_executions')
    .select('id, result')
    .eq('session_id', sessionId);

  const existingById = new Map(
    (existingRows ?? []).map((row) => [
      row.id as string,
      row.result as Record<string, unknown> | null,
    ]),
  );
  const desiredIds = new Set(turns.map((turn) => turn.id));
  const staleIds = [...existingById.keys()].filter((id) => !desiredIds.has(id));

  if (staleIds.length > 0) {
    await client.from('agent_executions').delete().in('id', staleIds).eq('session_id', sessionId);
  }

  for (const turn of turns) {
    const fingerprint = turnFingerprint(turn);
    const existingResult = existingById.get(turn.id);
    if (
      existingResult &&
      existingResult.format === 'desktop-turns' &&
      existingResult.fingerprint === fingerprint
    ) {
      continue;
    }

    const thought = extractActivityLabels(turn.activities, 'thought');
    const response = extractActivityLabels(turn.activities, 'response');
    const stream = buildDesktopTurnStreamJson(thought, response);
    const status = turn.running ? 'running' : 'completed';
    const startedAt = new Date(turn.startedAt).toISOString();
    const completedAt =
      !turn.running && turn.completedAt
        ? new Date(turn.completedAt).toISOString()
        : turn.running
          ? null
          : startedAt;

    const { error: upsertError } = await client.from('agent_executions').upsert(
      {
        id: turn.id,
        session_id: sessionId,
        command_id: null,
        status,
        prompt: turn.userContent.slice(0, 4000),
        started_at: startedAt,
        completed_at: completedAt,
        result: {
          format: 'desktop-turns',
          fingerprint,
        },
      },
      { onConflict: 'id' },
    );

    if (upsertError) {
      continue;
    }

    await client.from('agent_messages').delete().eq('execution_id', turn.id);

    const messages: Array<{
      session_id: string;
      execution_id: string;
      role: string;
      content: string;
      sequence: number;
    }> = [];

    if (turn.userContent.trim()) {
      messages.push({
        session_id: sessionId,
        execution_id: turn.id,
        role: 'user',
        content: truncateText(turn.userContent, MAX_MESSAGE_CHARS),
        sequence: 0,
      });
    }

    if (stream.trim()) {
      messages.push({
        session_id: sessionId,
        execution_id: turn.id,
        role: 'assistant',
        content: stream,
        sequence: 1,
      });
    }

    if (messages.length > 0) {
      await client.from('agent_messages').insert(messages);
    }
  }
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
        await syncDesktopPaneTurns(client, pane.paneId, pane.turns);
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
      await syncDesktopPaneTurns(client, pane.paneId, pane.turns);
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

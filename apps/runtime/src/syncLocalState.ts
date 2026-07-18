import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { NexusClient } from '@nexus/supabase';

interface LocalWorkspace {
  id: string;
  name: string;
  color?: string | null;
  icon?: string | null;
  logo?: string | null;
}

interface LocalProject {
  id: string;
  name: string;
  path: string;
  workspaceId?: string | null;
  color?: string | null;
  icon?: string | null;
  logo?: string | null;
  automations?: unknown[];
  tasks?: unknown[];
  tabs?: unknown[];
  passwordCollections?: Array<{ id: string; name: string; fields?: unknown[] }>;
  testEntries?: unknown[];
  whatsappLink?: string | null;
  flag?: unknown;
}

interface LocalAppState {
  projects?: LocalProject[];
  workspaces?: LocalWorkspace[];
  activeWorkspaceId?: string | null;
  activeProjectId?: string | null;
}

interface BrainManual {
  documents?: Array<{ id?: string; title?: string; content?: string; body?: string }>;
  meetings?: Array<{ id?: string; title?: string; notes?: string; content?: string; occurredAt?: string }>;
  decisions?: Array<{ id?: string; title?: string; body?: string; content?: string; status?: string }>;
}

function userDataDir(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'nexus-ide');
}

function summarizeProjectMetadata(project: LocalProject): Record<string, unknown> {
  const passwordCollections = (project.passwordCollections ?? []).map((collection) => ({
    id: collection.id,
    name: collection.name,
    fieldCount: Array.isArray(collection.fields) ? collection.fields.length : 0,
  }));

  return {
    automationsCount: Array.isArray(project.automations) ? project.automations.length : 0,
    tasksCount: Array.isArray(project.tasks) ? project.tasks.length : 0,
    tabsCount: Array.isArray(project.tabs) ? project.tabs.length : 0,
    testEntriesCount: Array.isArray(project.testEntries) ? project.testEntries.length : 0,
    automations: project.automations ?? [],
    tasks: project.tasks ?? [],
    passwordCollections,
    whatsappLink: project.whatsappLink ?? null,
    flag: project.flag ?? null,
    localPath: project.path,
  };
}

async function ensureMembership(
  client: NexusClient,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const { data } = await client
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (data?.id) {
    return;
  }

  await client.from('workspace_members').insert({
    workspace_id: workspaceId,
    user_id: userId,
    role: 'owner',
  });
}

async function upsertWorkspace(
  client: NexusClient,
  ownerId: string,
  workspace: LocalWorkspace,
  sortOrder: number,
): Promise<string> {
  const { data: existing } = await client
    .from('workspaces')
    .select('id')
    .eq('owner_id', ownerId)
    .eq('local_id', workspace.id)
    .maybeSingle();

  if (existing?.id) {
    await client
      .from('workspaces')
      .update({
        name: workspace.name,
        color: workspace.color ?? null,
        icon: workspace.icon ?? null,
        logo_url: workspace.logo ?? null,
        sort_order: sortOrder,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    await ensureMembership(client, existing.id, ownerId);
    return existing.id;
  }

  const byName = await client
    .from('workspaces')
    .select('id, local_id')
    .eq('owner_id', ownerId)
    .eq('name', workspace.name)
    .maybeSingle();

  if (byName.data?.id && !byName.data.local_id) {
    await client
      .from('workspaces')
      .update({
        local_id: workspace.id,
        color: workspace.color ?? null,
        icon: workspace.icon ?? null,
        logo_url: workspace.logo ?? null,
        sort_order: sortOrder,
        updated_at: new Date().toISOString(),
      })
      .eq('id', byName.data.id);
    await ensureMembership(client, byName.data.id, ownerId);
    return byName.data.id;
  }

  const { data: created, error } = await client
    .from('workspaces')
    .insert({
      name: workspace.name,
      owner_id: ownerId,
      local_id: workspace.id,
      color: workspace.color ?? null,
      icon: workspace.icon ?? null,
      logo_url: workspace.logo ?? null,
      sort_order: sortOrder,
    })
    .select('id')
    .single();

  if (error || !created?.id) {
    throw error ?? new Error(`Failed to create workspace ${workspace.name}`);
  }

  await ensureMembership(client, created.id, ownerId);
  return created.id;
}

async function uploadLogoIfNeeded(
  client: NexusClient,
  ownerId: string,
  localId: string,
  logoRef: string | null | undefined,
): Promise<string | null> {
  if (!logoRef) {
    return null;
  }

  if (logoRef.startsWith('http://') || logoRef.startsWith('https://')) {
    return logoRef;
  }

  const logosDir = path.join(userDataDir(), 'project-logos');
  const candidates = [
    path.isAbsolute(logoRef) ? logoRef : path.join(logosDir, logoRef),
    path.join(logosDir, `${localId}.png`),
    path.join(logosDir, `${localId}.jpg`),
    path.join(logosDir, `${localId}.webp`),
  ];

  const filePath = candidates.find((candidate) => existsSync(candidate));
  if (!filePath) {
    return logoRef.startsWith('data:') ? null : logoRef;
  }

  const ext = path.extname(filePath) || '.png';
  const objectPath = `${ownerId}/${localId}${ext}`;
  const bytes = readFileSync(filePath);
  const contentType =
    ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.webp'
        ? 'image/webp'
        : 'image/png';

  const { error } = await client.storage.from('project-logos').upload(objectPath, bytes, {
    upsert: true,
    contentType,
  });

  if (error) {
    console.warn('[sync] logo upload failed', localId, error.message);
    return null;
  }

  const { data } = client.storage.from('project-logos').getPublicUrl(objectPath);
  return data.publicUrl;
}

async function syncBrain(
  client: NexusClient,
  workspaceId: string,
  projectId: string,
  userId: string,
  projectPath: string,
): Promise<number> {
  const brainPath = path.join(projectPath, '.nexus', 'brain', 'manual.json');
  if (!existsSync(brainPath)) {
    return 0;
  }

  let brain: BrainManual;
  try {
    brain = JSON.parse(readFileSync(brainPath, 'utf8')) as BrainManual;
  } catch {
    return 0;
  }

  let count = 0;

  for (const doc of brain.documents ?? []) {
    const title = String(doc.title ?? 'Documento').trim();
    if (!title) {
      continue;
    }
    const content = String(doc.content ?? doc.body ?? '');
    const { data: existing } = await client
      .from('brain_documents')
      .select('id')
      .eq('project_id', projectId)
      .eq('title', title)
      .maybeSingle();

    if (existing?.id) {
      await client
        .from('brain_documents')
        .update({ content, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await client.from('brain_documents').insert({
        workspace_id: workspaceId,
        project_id: projectId,
        title,
        content,
        created_by: userId,
      });
    }
    count += 1;
  }

  for (const meeting of brain.meetings ?? []) {
    const title = String(meeting.title ?? 'Reunião').trim();
    if (!title) {
      continue;
    }
    const notes = String(meeting.notes ?? meeting.content ?? '');
    const { data: existing } = await client
      .from('brain_meetings')
      .select('id')
      .eq('project_id', projectId)
      .eq('title', title)
      .maybeSingle();

    if (existing?.id) {
      await client
        .from('brain_meetings')
        .update({ notes, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await client.from('brain_meetings').insert({
        workspace_id: workspaceId,
        project_id: projectId,
        title,
        notes,
        occurred_at: meeting.occurredAt ?? null,
        created_by: userId,
      });
    }
    count += 1;
  }

  for (const decision of brain.decisions ?? []) {
    const title = String(decision.title ?? 'Decisão').trim();
    if (!title) {
      continue;
    }
    const body = String(decision.body ?? decision.content ?? '');
    const { data: existing } = await client
      .from('brain_decisions')
      .select('id')
      .eq('project_id', projectId)
      .eq('title', title)
      .maybeSingle();

    if (existing?.id) {
      await client
        .from('brain_decisions')
        .update({ body, status: decision.status ?? 'open', updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await client.from('brain_decisions').insert({
        workspace_id: workspaceId,
        project_id: projectId,
        title,
        body,
        status: decision.status ?? 'open',
        created_by: userId,
      });
    }
    count += 1;
  }

  return count;
}

export async function syncLocalState(
  client: NexusClient,
  deviceId: string,
  userId: string,
): Promise<Record<string, unknown>> {
  const projectsPath = path.join(userDataDir(), 'projects.json');
  if (!existsSync(projectsPath)) {
    throw new Error(`projects.json not found at ${projectsPath}`);
  }

  const state = JSON.parse(readFileSync(projectsPath, 'utf8')) as LocalAppState;
  const localWorkspaces = state.workspaces ?? [];
  const localProjects = state.projects ?? [];

  const primaryLocalWorkspaceId =
    state.activeWorkspaceId ?? localWorkspaces[0]?.id ?? null;

  let syncRunId: string | null = null;
  let primaryCloudWorkspaceId: string | null = null;

  const workspaceMap = new Map<string, string>();

  for (const [index, workspace] of localWorkspaces.entries()) {
    const cloudId = await upsertWorkspace(client, userId, workspace, index);
    workspaceMap.set(workspace.id, cloudId);
    if (workspace.id === primaryLocalWorkspaceId || !primaryCloudWorkspaceId) {
      primaryCloudWorkspaceId = cloudId;
    }
  }

  if (!primaryCloudWorkspaceId) {
    const { data: membership } = await client
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    primaryCloudWorkspaceId = membership?.workspace_id ?? null;
  }

  if (!primaryCloudWorkspaceId) {
    throw new Error('No cloud workspace available for sync');
  }

  const { data: syncRun } = await client
    .from('local_sync_runs')
    .insert({
      workspace_id: primaryCloudWorkspaceId,
      device_id: deviceId,
      status: 'running',
      metadata: { source: 'projects.json' },
    })
    .select('id')
    .single();
  syncRunId = syncRun?.id ?? null;

  await client
    .from('devices')
    .update({ workspace_id: primaryCloudWorkspaceId })
    .eq('id', deviceId)
    .eq('owner_id', userId);

  let brainCount = 0;
  const syncedProjects: Array<{ name: string; id: string; path: string }> = [];

  for (const [index, project] of localProjects.entries()) {
    const localWorkspaceId = project.workspaceId ?? primaryLocalWorkspaceId;
    const cloudWorkspaceId =
      (localWorkspaceId ? workspaceMap.get(localWorkspaceId) : null) ?? primaryCloudWorkspaceId;

    const logoUrl = await uploadLogoIfNeeded(client, userId, project.id, project.logo);
    const metadata = summarizeProjectMetadata(project);

    const { data: existing } = await client
      .from('projects')
      .select('id')
      .eq('local_id', project.id)
      .maybeSingle();

    let projectId = existing?.id ?? null;

    if (projectId) {
      await client
        .from('projects')
        .update({
          workspace_id: cloudWorkspaceId,
          name: project.name,
          color: project.color ?? null,
          icon: project.icon ?? null,
          logo_url: logoUrl,
          sort_order: index,
          metadata,
          updated_at: new Date().toISOString(),
        })
        .eq('id', projectId);
    } else {
      const { data: created, error } = await client
        .from('projects')
        .insert({
          workspace_id: cloudWorkspaceId,
          name: project.name,
          local_id: project.id,
          color: project.color ?? null,
          icon: project.icon ?? null,
          logo_url: logoUrl,
          sort_order: index,
          metadata,
          created_by: userId,
        })
        .select('id')
        .single();

      if (error || !created?.id) {
        throw error ?? new Error(`Failed to create project ${project.name}`);
      }
      projectId = created.id;
    }

    await client.from('device_projects').upsert(
      {
        device_id: deviceId,
        project_id: projectId,
        local_path: project.path,
        is_available: existsSync(project.path),
        last_scanned_at: new Date().toISOString(),
      },
      { onConflict: 'device_id,project_id' },
    );

    brainCount += await syncBrain(client, cloudWorkspaceId, projectId, userId, project.path);
    syncedProjects.push({ name: project.name, id: projectId, path: project.path });
  }

  if (syncRunId) {
    await client
      .from('local_sync_runs')
      .update({
        status: 'completed',
        projects_count: syncedProjects.length,
        workspaces_count: localWorkspaces.length,
        brain_count: brainCount,
        completed_at: new Date().toISOString(),
      })
      .eq('id', syncRunId);
  }

  return {
    workspaces: localWorkspaces.length,
    projects: syncedProjects.length,
    brain: brainCount,
    primary_workspace_id: primaryCloudWorkspaceId,
    projects_list: syncedProjects.map((item) => item.name),
  };
}

export function listLocalLogoFiles(): string[] {
  const logosDir = path.join(userDataDir(), 'project-logos');
  if (!existsSync(logosDir)) {
    return [];
  }
  return readdirSync(logosDir);
}

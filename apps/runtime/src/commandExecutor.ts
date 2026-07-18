import { createHash } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import type { CommandRow, NexusClient } from '@nexus/supabase';
import { createEventEnvelope } from '@nexus/protocol';
import { assertPathInsideSandbox } from './sandbox';
import {
  closeTerminal,
  createTerminalSession,
  interruptTerminal,
  resizeTerminal,
  writeTerminal,
} from './terminalSessions';
import { syncLocalState } from './syncLocalState';
import { streamChunkIndicatesPlanWaiting } from './detectPlanWaiting';
import { notifyPush } from './notifyPush';

const execFileAsync = promisify(execFile);

interface ActiveAgentProcess {
  child: ChildProcess;
  commandId: string;
  sessionId: string;
  cancelled: boolean;
}

const activeAgentProcesses = new Map<string, ActiveAgentProcess>();

function registerActiveAgent(entry: ActiveAgentProcess): void {
  activeAgentProcesses.set(entry.commandId, entry);
  if (entry.sessionId) {
    activeAgentProcesses.set(`session:${entry.sessionId}`, entry);
  }
}

function unregisterActiveAgent(commandId: string, sessionId: string): void {
  activeAgentProcesses.delete(commandId);
  if (sessionId) {
    activeAgentProcesses.delete(`session:${sessionId}`);
  }
}

function findActiveAgent(commandId: string, sessionId: string): ActiveAgentProcess | null {
  if (commandId && activeAgentProcesses.has(commandId)) {
    return activeAgentProcesses.get(commandId) ?? null;
  }
  if (sessionId && activeAgentProcesses.has(`session:${sessionId}`)) {
    return activeAgentProcesses.get(`session:${sessionId}`) ?? null;
  }
  return null;
}

export function cancelActiveAgentProcess(input: {
  commandId?: string | null;
  sessionId?: string | null;
}): boolean {
  const entry = findActiveAgent(
    String(input.commandId ?? '').trim(),
    String(input.sessionId ?? '').trim(),
  );
  if (!entry) {
    return false;
  }
  entry.cancelled = true;
  try {
    entry.child.kill('SIGTERM');
  } catch {
  }
  setTimeout(() => {
    try {
      if (!entry.child.killed) {
        entry.child.kill('SIGKILL');
      }
    } catch {
    }
  }, 2000);
  return true;
}

function resolveCursorAgentExecutable(agentCommand: string): string {
  if (agentCommand !== 'cursor-agent' && path.isAbsolute(agentCommand)) {
    return agentCommand;
  }

  const home = os.homedir();
  const candidates = [
    path.join(home, '.local', 'bin', 'cursor-agent'),
    path.join(home, '.cursor', 'bin', 'cursor-agent'),
    '/opt/homebrew/bin/cursor-agent',
    '/usr/local/bin/cursor-agent',
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return agentCommand || 'cursor-agent';
}

function buildCliPathEnv(): string {
  const home = os.homedir();
  const extras = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.cursor', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  const current = process.env.PATH ?? '';
  return [...extras, current].filter(Boolean).join(path.delimiter);
}

async function broadcast(
  client: NexusClient,
  channelName: string,
  envelope: unknown,
): Promise<void> {
  const channel = client.channel(channelName);
  await channel.subscribe();
  await channel.send({
    type: 'broadcast',
    event: 'nexus',
    payload: envelope,
  });
  await client.removeChannel(channel);
}

async function getProjectRoot(
  client: NexusClient,
  deviceId: string,
  projectId: string | null,
): Promise<string | null> {
  if (!projectId) {
    return null;
  }
  const { data } = await client
    .from('device_projects')
    .select('local_path')
    .eq('device_id', deviceId)
    .eq('project_id', projectId)
    .maybeSingle();
  return data?.local_path ?? null;
}

async function runAgentPrompt(
  client: NexusClient,
  command: CommandRow,
  deviceId: string,
): Promise<Record<string, unknown>> {
  const prompt = String(command.payload?.prompt ?? '');
  const agentCommand = String(command.payload?.agent_command ?? 'cursor-agent');
  const resumeChatId = String(command.payload?.resume_chat_id ?? '').trim();
  const continueSession = Boolean(command.payload?.continue_session);
  const model = String(command.payload?.model ?? '').trim();
  const mode = String(command.payload?.mode ?? '').trim().toLowerCase();
  const sessionId = String(command.payload?.session_id ?? '').trim();
  const cwd =
    (await getProjectRoot(client, deviceId, command.project_id)) ??
    String(command.payload?.cwd ?? process.cwd());

  let session: { id: string } | null = null;
  if (sessionId) {
    const { data: existing } = await client
      .from('agent_sessions')
      .select('id')
      .eq('id', sessionId)
      .maybeSingle();
    if (existing?.id) {
      const { data: updated, error: updateError } = await client
        .from('agent_sessions')
        .update({
          status: 'running',
          device_id: deviceId,
          project_id: command.project_id,
          model_id: model || null,
          title: prompt.slice(0, 80),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('id')
        .single();
      if (updateError) {
        throw updateError;
      }
      session = updated;
    }
  }

  if (!session) {
    const { data: created, error: createError } = await client
      .from('agent_sessions')
      .insert({
        id: sessionId || undefined,
        workspace_id: command.workspace_id,
        project_id: command.project_id,
        device_id: deviceId,
        title: prompt.slice(0, 80),
        status: 'running',
        model_id: model || null,
        created_by: command.created_by,
      })
      .select('id')
      .single();
    if (createError) {
      throw createError;
    }
    session = created;
  }

  const { data: execution } = await client
    .from('agent_executions')
    .insert({
      session_id: session!.id,
      command_id: command.id,
      status: 'running',
      prompt,
      started_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  let output = '';
  let sequence = 0;
  let planWaitingNotified = false;
  const executable = resolveCursorAgentExecutable(agentCommand);
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--trust',
    '--force',
    '--workspace',
    cwd,
  ];

  if (resumeChatId) {
    args.push('--resume', resumeChatId);
  } else if (continueSession) {
    args.push('--continue');
  }

  if (model && model.toLowerCase() !== 'auto') {
    args.push('--model', model);
  }

  if (mode === 'plan' || mode === 'ask') {
    args.push('--mode', mode);
  }

  if (prompt.trim()) {
    args.push(prompt);
  }

  let projectName = 'Projeto';
  if (command.project_id) {
    const { data: project } = await client
      .from('projects')
      .select('name')
      .eq('id', command.project_id)
      .maybeSingle();
    if (project?.name) {
      projectName = String(project.name);
    }
  }

  const emitChunk = (chunk: string) => {
    if (!chunk) {
      return;
    }
    output += chunk;
    sequence += 1;
    const envelope = createEventEnvelope({
      workspace_id: command.workspace_id,
      device_id: deviceId,
      project_id: command.project_id,
      execution_id: execution!.id,
      type: 'terminal.output',
      sequence,
      payload: { chunk, format: 'stream-json' },
    });
    void broadcast(client, `execution:${execution!.id}`, envelope);
    void broadcast(client, `execution:${command.id}`, envelope);

    if (!planWaitingNotified && streamChunkIndicatesPlanWaiting(chunk)) {
      planWaitingNotified = true;
      void (async () => {
        await client
          .from('commands')
          .update({ status: 'waiting_user' })
          .eq('id', command.id);
        await client
          .from('agent_sessions')
          .update({ status: 'waiting_user', updated_at: new Date().toISOString() })
          .eq('id', session!.id);
        const waitingEnvelope = createEventEnvelope({
          workspace_id: command.workspace_id,
          device_id: deviceId,
          project_id: command.project_id,
          execution_id: execution!.id,
          type: 'agent.waiting_user',
          sequence: sequence + 1,
          payload: { reason: 'plan', project_name: projectName },
        });
        await broadcast(client, `execution:${execution!.id}`, waitingEnvelope);
        await broadcast(client, `execution:${command.id}`, waitingEnvelope);
        if (command.created_by) {
          await notifyPush({
            userId: command.created_by,
            kind: 'agent',
            title: 'Agent aguarda resposta',
            body: `${projectName}: revise o plan`,
            dedupeKey: `agent:${execution!.id}:waiting_user`,
            data: {
              sessionId: session!.id,
              executionId: execution!.id,
              reason: 'plan',
            },
          });
        }
      })();
    }
  };

  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, PATH: buildCliPathEnv() },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const active: ActiveAgentProcess = {
      child,
      commandId: command.id,
      sessionId: session!.id,
      cancelled: false,
    };
    registerActiveAgent(active);

    child.stdout.on('data', (buffer: Buffer) => {
      emitChunk(buffer.toString('utf8'));
    });
    child.stderr.on('data', (buffer: Buffer) => {
      emitChunk(buffer.toString('utf8'));
    });
    child.on('error', (error) => {
      unregisterActiveAgent(command.id, session!.id);
      reject(error);
    });
    child.on('close', (code) => {
      const wasCancelled = active.cancelled;
      unregisterActiveAgent(command.id, session!.id);
      resolve(wasCancelled ? 130 : (code ?? 0));
    });
  });

  const cancelled = exitCode === 130;
  const failed = !cancelled && exitCode !== 0;
  await client.from('agent_messages').insert({
    session_id: session!.id,
    execution_id: execution!.id,
    role: 'assistant',
    content: output.slice(-50_000),
    sequence,
  });

  await client
    .from('agent_executions')
    .update({
      status: cancelled ? 'cancelled' : failed ? 'failed' : 'completed',
      completed_at: new Date().toISOString(),
      result: {
        bytes: output.length,
        exit_code: exitCode,
        format: 'stream-json',
        cancelled,
      },
    })
    .eq('id', execution!.id);

  const cursorFromStream = (() => {
    const match = output.match(/"session_id"\s*:\s*"([^"]+)"/);
    return match?.[1] ?? null;
  })();

  await client
    .from('agent_sessions')
    .update({
      status: cancelled ? 'active' : failed ? 'error' : 'active',
      cursor_chat_id: resumeChatId || cursorFromStream,
      model_id: model || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', session!.id);

  if (cancelled) {
    await client
      .from('commands')
      .update({
        status: 'cancelled',
        completed_at: new Date().toISOString(),
      })
      .eq('id', command.id);
  }

  const doneEnvelope = createEventEnvelope({
    workspace_id: command.workspace_id,
    device_id: deviceId,
    project_id: command.project_id,
    execution_id: execution!.id,
    type: cancelled ? 'command.cancelled' : failed ? 'agent.failed' : 'agent.completed',
    sequence: sequence + 1,
    payload: {
      status: cancelled ? 'cancelled' : failed ? 'failed' : 'completed',
      exit_code: exitCode,
      format: 'stream-json',
    },
  });
  await broadcast(client, `execution:${execution!.id}`, doneEnvelope);
  await broadcast(client, `execution:${command.id}`, doneEnvelope);

  if (command.created_by && !cancelled) {
    await notifyPush({
      userId: command.created_by,
      kind: 'agent',
      title: failed ? 'Agent falhou' : 'Agent concluiu',
      body: projectName,
      dedupeKey: `agent:${execution!.id}:${failed ? 'failed' : 'completed'}`,
      data: {
        sessionId: session!.id,
        executionId: execution!.id,
        status: failed ? 'failed' : 'completed',
      },
    });
  }

  return {
    execution_id: execution!.id,
    session_id: session!.id,
    exit_code: exitCode,
    format: 'stream-json',
    failed,
    cancelled,
  };
}

async function handleFileRead(
  client: NexusClient,
  command: CommandRow,
  deviceId: string,
): Promise<Record<string, unknown>> {
  const root = await getProjectRoot(client, deviceId, command.project_id);
  if (!root) {
    throw new Error('Project path not found on device');
  }
  const relativePath = String(command.payload?.path ?? '');
  const fullPath = assertPathInsideSandbox(path.join(root, relativePath), [root]);
  const content = readFileSync(fullPath, 'utf8');
  const hash = createHash('sha256').update(content).digest('hex');
  return { path: relativePath, content, hash };
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

const IMAGE_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'release',
  '.next',
  'coverage',
  'Pods',
]);

function normalizeRuntimeImageRef(imageRef: string): string {
  let trimmed = imageRef.trim().replace(/&amp;/g, '&');

  if (!trimmed) {
    return '';
  }

  if (/^nexus-file:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      trimmed = decodeURIComponent(url.pathname);
    } catch {
      trimmed = decodeURIComponent(trimmed.replace(/^nexus-file:\/\//i, ''));
    }
  } else if (/^file:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      trimmed = decodeURIComponent(url.pathname);
    } catch {
      trimmed = decodeURIComponent(trimmed.replace(/^file:\/\//i, ''));
    }
  }

  return trimmed;
}

function findImageByBasenameSync(rootDir: string, fileName: string, maxDepth = 5): string | null {
  const target = fileName.toLowerCase();
  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      break;
    }

    let entries;

    try {
      entries = readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== fileName) {
        continue;
      }

      const fullPath = path.join(current.dir, entry.name);

      if (entry.isDirectory()) {
        if (current.depth >= maxDepth || IMAGE_SKIP_DIRS.has(entry.name)) {
          continue;
        }

        queue.push({ dir: fullPath, depth: current.depth + 1 });
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase() === target) {
        return fullPath;
      }
    }
  }

  return null;
}

function readImageFileAsDataUrl(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const fileStats = statSync(filePath);

    if (!fileStats.isFile() || fileStats.size === 0 || fileStats.size > 4 * 1024 * 1024) {
      return null;
    }
  } catch {
    return null;
  }

  const buffer = readFileSync(filePath);
  const mimeType = IMAGE_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

async function handleFileReadImage(
  client: NexusClient,
  command: CommandRow,
  deviceId: string,
): Promise<Record<string, unknown>> {
  const root = await getProjectRoot(client, deviceId, command.project_id);
  if (!root) {
    throw new Error('Project path not found on device');
  }

  const normalized = normalizeRuntimeImageRef(String(command.payload?.path ?? ''));

  if (!normalized) {
    throw new Error('Image path is required');
  }

  const allowedRoots = [
    root,
    os.tmpdir(),
    '/tmp',
    path.join(os.homedir(), '.cursor'),
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'Downloads'),
  ];

  const candidates: string[] = [];

  if (path.isAbsolute(normalized)) {
    candidates.push(assertPathInsideSandbox(normalized, allowedRoots));
  } else {
    candidates.push(assertPathInsideSandbox(path.join(root, normalized), [root]));
    candidates.push(
      assertPathInsideSandbox(path.join(root, path.basename(normalized)), [root]),
    );
  }

  for (const candidate of candidates) {
    const dataUrl = readImageFileAsDataUrl(candidate);

    if (dataUrl) {
      return { path: normalized, data_url: dataUrl };
    }
  }

  const found = findImageByBasenameSync(root, path.basename(normalized));

  if (found) {
    const safePath = assertPathInsideSandbox(found, [root]);
    const dataUrl = readImageFileAsDataUrl(safePath);

    if (dataUrl) {
      return { path: normalized, data_url: dataUrl };
    }
  }

  throw new Error(`Image not found: ${normalized}`);
}

const MAX_ARTIFACT_DOWNLOAD_BYTES = 500 * 1024 * 1024;

async function handleFileDownload(
  client: NexusClient,
  command: CommandRow,
  deviceId: string,
): Promise<Record<string, unknown>> {
  const rawPath = String(command.payload?.path ?? '').trim();

  if (!rawPath) {
    throw new Error('File path is required');
  }

  const { data: deviceProjects } = await client
    .from('device_projects')
    .select('local_path')
    .eq('device_id', deviceId);

  const roots = [
    ...(deviceProjects ?? [])
      .map((row) => (typeof row.local_path === 'string' ? row.local_path : null))
      .filter((entry): entry is string => Boolean(entry)),
    path.join(os.homedir(), 'DEV'),
    os.homedir(),
  ];

  const projectRoot = await getProjectRoot(client, deviceId, command.project_id);

  if (projectRoot) {
    roots.unshift(projectRoot);
  }

  const resolved = path.isAbsolute(rawPath)
    ? assertPathInsideSandbox(rawPath, roots)
    : assertPathInsideSandbox(path.join(projectRoot ?? roots[0] ?? os.homedir(), rawPath), roots);

  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  const stats = statSync(resolved);

  if (!stats.isFile()) {
    throw new Error('Path is not a file');
  }

  if (stats.size > MAX_ARTIFACT_DOWNLOAD_BYTES) {
    throw new Error('Arquivo muito grande para download remoto');
  }

  const ext = path.extname(resolved).toLowerCase();

  if (!['.apk', '.aab', '.ipa'].includes(ext)) {
    throw new Error('Somente APK, AAB ou IPA podem ser baixados');
  }

  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user?.id) {
    throw new Error('Usuário não autenticado no runtime');
  }

  const fileName = path.basename(resolved);
  const storagePath = `${user.id}/${deviceId}/${Date.now()}-${fileName}`;
  const buffer = readFileSync(resolved);
  const contentType =
    ext === '.apk' ? 'application/vnd.android.package-archive' : 'application/octet-stream';

  const { error: uploadError } = await client.storage
    .from('mobile-artifacts')
    .upload(storagePath, buffer, {
      contentType,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(uploadError.message || 'Falha ao enviar artefato');
  }

  const { data: signed, error: signError } = await client.storage
    .from('mobile-artifacts')
    .createSignedUrl(storagePath, 60 * 60);

  if (signError || !signed?.signedUrl) {
    throw new Error(signError?.message || 'Falha ao gerar URL de download');
  }

  return {
    path: resolved,
    file_name: fileName,
    download_url: signed.signedUrl,
    size: stats.size,
  };
}

async function handleApplyPatch(
  client: NexusClient,
  command: CommandRow,
  deviceId: string,
): Promise<Record<string, unknown>> {
  const root = await getProjectRoot(client, deviceId, command.project_id);
  if (!root) {
    throw new Error('Project path not found on device');
  }
  const relativePath = String(command.payload?.path ?? '');
  const baseHash = String(command.payload?.base_hash ?? '');
  const nextContent = String(command.payload?.content ?? command.payload?.patch ?? '');
  const fullPath = assertPathInsideSandbox(path.join(root, relativePath), [root]);
  const current = existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : '';
  const currentHash = createHash('sha256').update(current).digest('hex');
  if (baseHash && currentHash !== baseHash) {
    return {
      conflict: true,
      path: relativePath,
      current_hash: currentHash,
      base_hash: baseHash,
      current,
    };
  }
  writeFileSync(fullPath, nextContent, 'utf8');
  const hash = createHash('sha256').update(nextContent).digest('hex');
  return { conflict: false, path: relativePath, hash };
}

async function handleGitStatus(
  client: NexusClient,
  command: CommandRow,
  deviceId: string,
): Promise<Record<string, unknown>> {
  const root = await getProjectRoot(client, deviceId, command.project_id);
  if (!root) {
    throw new Error('Project path not found on device');
  }
  const { stdout: status } = await execFileAsync('git', ['status', '--porcelain=v1', '-b'], {
    cwd: root,
  });
  const { stdout: branch } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: root,
  });
  await client.from('project_git_status').upsert(
    {
      project_id: command.project_id!,
      device_id: deviceId,
      branch: branch.trim(),
      dirty: status.split('\n').filter(Boolean).length > 1,
      summary: { porcelain: status },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_id,device_id' },
  );
  return { branch: branch.trim(), status };
}

async function handleGitCommit(
  client: NexusClient,
  command: CommandRow,
  deviceId: string,
): Promise<Record<string, unknown>> {
  const root = await getProjectRoot(client, deviceId, command.project_id);
  if (!root) {
    throw new Error('Project path not found on device');
  }
  const message = String(command.payload?.message ?? 'chore: nexus cloud commit');
  await execFileAsync('git', ['add', '-A'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', message], { cwd: root });
  return { ok: true, message };
}

async function handleScanProjects(
  client: NexusClient,
  command: CommandRow,
  deviceId: string,
): Promise<Record<string, unknown>> {
  const roots = (command.payload?.roots as string[] | undefined) ?? [
    path.join(process.env.HOME ?? '', 'DEV'),
  ];
  const found: Array<{ name: string; local_path: string }> = [];

  for (const root of roots) {
    if (!existsSync(root)) {
      continue;
    }
    for (const entry of readdirSync(root)) {
      const full = path.join(root, entry);
      try {
        if (!statSync(full).isDirectory()) {
          continue;
        }
        if (existsSync(path.join(full, '.git')) || existsSync(path.join(full, 'package.json'))) {
          found.push({ name: entry, local_path: full });
        }
      } catch {
        continue;
      }
    }
  }

  for (const item of found) {
    const { data: existing } = await client
      .from('projects')
      .select('id')
      .eq('workspace_id', command.workspace_id)
      .eq('name', item.name)
      .maybeSingle();

    let projectId = existing?.id;
    if (!projectId) {
      const { data: created } = await client
        .from('projects')
        .insert({
          workspace_id: command.workspace_id,
          name: item.name,
          created_by: command.created_by,
        })
        .select('id')
        .single();
      projectId = created!.id;
    }

    await client.from('device_projects').upsert(
      {
        device_id: deviceId,
        project_id: projectId!,
        local_path: item.local_path,
        is_available: true,
        last_scanned_at: new Date().toISOString(),
      },
      { onConflict: 'device_id,project_id' },
    );
  }

  return { count: found.length, projects: found };
}

export async function executeCommand(
  client: NexusClient,
  command: CommandRow,
  deviceId: string,
): Promise<Record<string, unknown>> {
  await client
    .from('commands')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', command.id);

  try {
    let result: Record<string, unknown>;

    switch (command.type) {
      case 'agent_prompt':
        result = await runAgentPrompt(client, command, deviceId);
        break;
      case 'agent_cancel': {
        const targetCommandId = String(command.payload?.command_id ?? '').trim();
        const targetSessionId = String(command.payload?.session_id ?? '').trim();
        const killed = cancelActiveAgentProcess({
          commandId: targetCommandId,
          sessionId: targetSessionId,
        });
        if (targetCommandId) {
          await client
            .from('commands')
            .update({
              status: 'cancelled',
              completed_at: new Date().toISOString(),
            })
            .eq('id', targetCommandId)
            .in('status', ['pending', 'claimed', 'running', 'waiting_user']);
        }
        if (targetSessionId) {
          await client
            .from('agent_sessions')
            .update({
              status: 'active',
              updated_at: new Date().toISOString(),
            })
            .eq('id', targetSessionId)
            .eq('status', 'running');
          await client
            .from('agent_executions')
            .update({
              status: 'cancelled',
              completed_at: new Date().toISOString(),
            })
            .eq('session_id', targetSessionId)
            .eq('status', 'running');
        }
        result = { ok: true, killed };
        break;
      }
      case 'terminal_create': {
        const cwd =
          (await getProjectRoot(client, deviceId, command.project_id)) ??
          String(command.payload?.cwd ?? process.env.HOME);
        let sequence = 0;
        const { data: session } = await client
          .from('terminal_sessions')
          .insert({
            workspace_id: command.workspace_id,
            project_id: command.project_id,
            device_id: deviceId,
            title: String(command.payload?.title ?? 'Terminal'),
            cwd,
            cols: Number(command.payload?.cols ?? 80),
            rows: Number(command.payload?.rows ?? 24),
            created_by: command.created_by,
          })
          .select('*')
          .single();

        const terminalId = createTerminalSession({
          id: session!.id,
          cwd,
          cols: session!.cols,
          rows: session!.rows,
          onData: (chunk, seq) => {
            sequence = seq;
            void client.from('terminal_chunks').insert({
              session_id: session!.id,
              sequence: seq,
              content: chunk,
            });
            void broadcast(
              client,
              `terminal:${session!.id}`,
              createEventEnvelope({
                workspace_id: command.workspace_id,
                device_id: deviceId,
                project_id: command.project_id,
                type: 'terminal.output',
                sequence: seq,
                payload: { chunk, session_id: session!.id },
              }),
            );
          },
        });
        result = { terminal_session_id: terminalId, sequence };
        break;
      }
      case 'terminal_stdin':
        writeTerminal(String(command.payload?.session_id), String(command.payload?.data ?? ''));
        result = { ok: true };
        break;
      case 'terminal_resize':
        resizeTerminal(
          String(command.payload?.session_id),
          Number(command.payload?.cols ?? 80),
          Number(command.payload?.rows ?? 24),
        );
        result = { ok: true };
        break;
      case 'terminal_interrupt':
        interruptTerminal(String(command.payload?.session_id));
        result = { ok: true };
        break;
      case 'terminal_close':
        closeTerminal(String(command.payload?.session_id));
        await client
          .from('terminal_sessions')
          .update({ status: 'closed' })
          .eq('id', String(command.payload?.session_id));
        result = { ok: true };
        break;
      case 'file_read':
        result = await handleFileRead(client, command, deviceId);
        break;
      case 'file_read_image':
        result = await handleFileReadImage(client, command, deviceId);
        break;
      case 'file_download':
        result = await handleFileDownload(client, command, deviceId);
        break;
      case 'apply_file_patch':
      case 'file_write':
        result = await handleApplyPatch(client, command, deviceId);
        break;
      case 'git_status':
        result = await handleGitStatus(client, command, deviceId);
        break;
      case 'git_commit':
        result = await handleGitCommit(client, command, deviceId);
        break;
      case 'git_push': {
        const root = await getProjectRoot(client, deviceId, command.project_id);
        if (!root) {
          throw new Error('Project path not found on device');
        }
        await execFileAsync('git', ['push'], { cwd: root });
        result = { ok: true };
        break;
      }
      case 'scan_projects':
        result = await handleScanProjects(client, command, deviceId);
        break;
      case 'sync_local_state':
        result = await syncLocalState(client, deviceId, command.created_by);
        break;
      default:
        throw new Error(`Unsupported command type: ${command.type}`);
    }

    const cancelled = Boolean(
      result && typeof result === 'object' && (result as { cancelled?: unknown }).cancelled === true,
    );

    await client
      .from('commands')
      .update({
        status: cancelled ? 'cancelled' : 'completed',
        completed_at: new Date().toISOString(),
        result,
      })
      .eq('id', command.id);

    await client.from('command_results').insert({
      command_id: command.id,
      payload: result,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await client
      .from('commands')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: message,
      })
      .eq('id', command.id);
    throw error;
  }
}

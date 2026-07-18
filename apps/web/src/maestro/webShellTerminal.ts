import { bridge, supabase } from '../lib/supabase';
import {
  useWebStore,
  type WebAgentTerminal,
  type WebAgentTerminalStatus,
} from '../store';
import { waitForCommandResult } from './webCommandResult';
import type { WebShellToolEvent } from './webStreamJson';

export type { WebShellToolEvent };

const AGENT_TERMINAL_SCRIPT_NAMES = new Set([
  'dev',
  'start',
  'serve',
  'ios',
  'android',
  'web',
]);

const SCRIPT_TITLE_LABELS: Record<string, string> = {
  dev: 'Start dev server',
  start: 'Start dev server',
  serve: 'Start dev server',
  ios: 'Run iOS',
  android: 'Run Android',
  web: 'Run web',
};

interface RemoteTerminalContext {
  deviceId: string;
  projectId: string | null;
  workspaceId: string;
}

const pendingTerminalIdsByAgent = new Map<string, string[]>();
const remoteUnsubscribes = new Map<string, () => void>();

function normalizeShellCommand(command: string): string {
  return command.replace(/\s+/g, ' ').trim();
}

function matchesNativeRunCommand(segment: string): boolean {
  return (
    /^(?:npx\s+)?expo\s+run:(?:ios|android)(?:\s|$)/.test(segment) ||
    /^(?:npx\s+)?react-native\s+run-(?:ios|android)(?:\s|$)/.test(segment) ||
    /^(?:npx\s+)?expo\s+start(?:\s|$)/.test(segment)
  );
}

function matchesDevTerminalScript(segment: string): boolean {
  const trimmed = segment.trim();

  if (!trimmed) {
    return false;
  }

  const yarnMatch = trimmed.match(/^yarn(?:\s+run)?\s+([a-zA-Z0-9:_-]+)/);

  if (yarnMatch && AGENT_TERMINAL_SCRIPT_NAMES.has(yarnMatch[1].toLowerCase())) {
    return true;
  }

  if (/^npm\s+start(?:\s|$)/.test(trimmed)) {
    return true;
  }

  const npmMatch = trimmed.match(/^npm\s+run\s+([a-zA-Z0-9:_-]+)/);

  if (npmMatch && AGENT_TERMINAL_SCRIPT_NAMES.has(npmMatch[1].toLowerCase())) {
    return true;
  }

  const pnpmMatch = trimmed.match(/^pnpm(?:\s+run)?\s+([a-zA-Z0-9:_-]+)/);

  if (pnpmMatch && AGENT_TERMINAL_SCRIPT_NAMES.has(pnpmMatch[1].toLowerCase())) {
    return true;
  }

  const bunMatch = trimmed.match(/^bun(?:\s+run)?\s+([a-zA-Z0-9:_-]+)/);

  if (bunMatch && AGENT_TERMINAL_SCRIPT_NAMES.has(bunMatch[1].toLowerCase())) {
    return true;
  }

  return matchesNativeRunCommand(trimmed);
}

export function shouldOpenWebAgentShellTerminal(command: string): boolean {
  const normalized = normalizeShellCommand(command);

  if (!normalized) {
    return false;
  }

  return normalized.split(/\s*(?:&&|\|\||;)\s*/).some((segment) => matchesDevTerminalScript(segment));
}

function resolveSegmentScriptName(segment: string): string | null {
  const trimmed = segment.trim();

  if (!trimmed) {
    return null;
  }

  const yarnMatch = trimmed.match(/^yarn(?:\s+run)?\s+([a-zA-Z0-9:_-]+)/);

  if (yarnMatch) {
    return yarnMatch[1].toLowerCase();
  }

  if (/^npm\s+start(?:\s|$)/.test(trimmed)) {
    return 'start';
  }

  const npmMatch = trimmed.match(/^npm\s+run\s+([a-zA-Z0-9:_-]+)/);

  if (npmMatch) {
    return npmMatch[1].toLowerCase();
  }

  const pnpmMatch = trimmed.match(/^pnpm(?:\s+run)?\s+([a-zA-Z0-9:_-]+)/);

  if (pnpmMatch) {
    return pnpmMatch[1].toLowerCase();
  }

  const bunMatch = trimmed.match(/^bun(?:\s+run)?\s+([a-zA-Z0-9:_-]+)/);

  if (bunMatch) {
    return bunMatch[1].toLowerCase();
  }

  if (/^(?:npx\s+)?expo\s+start(?:\s|$)/.test(trimmed)) {
    return 'start';
  }

  if (/^(?:npx\s+)?expo\s+run:ios(?:\s|$)/.test(trimmed)) {
    return 'ios';
  }

  if (/^(?:npx\s+)?expo\s+run:android(?:\s|$)/.test(trimmed)) {
    return 'android';
  }

  if (/^(?:npx\s+)?react-native\s+run-ios(?:\s|$)/.test(trimmed)) {
    return 'ios';
  }

  if (/^(?:npx\s+)?react-native\s+run-android(?:\s|$)/.test(trimmed)) {
    return 'android';
  }

  return null;
}

function resolveScriptName(command: string): string | null {
  const normalized = normalizeShellCommand(command);
  const segments = normalized.split(/\s*(?:&&|\|\||;)\s*/);
  let fallback: string | null = null;

  for (const segment of segments) {
    const scriptName = resolveSegmentScriptName(segment);

    if (!scriptName) {
      continue;
    }

    if (AGENT_TERMINAL_SCRIPT_NAMES.has(scriptName)) {
      return scriptName;
    }

    if (!fallback) {
      fallback = scriptName;
    }
  }

  return fallback;
}

export function buildWebShellTerminalTitle(command: string): string {
  const scriptName = resolveScriptName(command);

  if (scriptName && SCRIPT_TITLE_LABELS[scriptName]) {
    return SCRIPT_TITLE_LABELS[scriptName];
  }

  const preview = normalizeShellCommand(command);
  return preview.length > 40 ? `${preview.slice(0, 37)}…` : preview;
}

function isLongRunningScript(command: string): boolean {
  const scriptName = resolveScriptName(command);
  return scriptName
    ? ['dev', 'start', 'serve', 'ios', 'android', 'web'].includes(scriptName)
    : false;
}

function enqueuePendingTerminal(agentId: string, terminalId: string): void {
  const queue = pendingTerminalIdsByAgent.get(agentId) ?? [];
  queue.push(terminalId);
  pendingTerminalIdsByAgent.set(agentId, queue);
}

function dequeuePendingTerminal(agentId: string): string | null {
  const queue = pendingTerminalIdsByAgent.get(agentId);

  if (!queue?.length) {
    return null;
  }

  const terminalId = queue.shift() ?? null;

  if (!queue.length) {
    pendingTerminalIdsByAgent.delete(agentId);
  } else {
    pendingTerminalIdsByAgent.set(agentId, queue);
  }

  return terminalId;
}

function appendTerminalOutput(agentId: string, terminalId: string, chunk: string): void {
  if (!chunk) {
    return;
  }

  const agent = useWebStore.getState().agents.find((entry) => entry.id === agentId);
  const current = agent?.terminals.find((entry) => entry.id === terminalId);
  const nextOutput = `${current?.output ?? ''}${chunk}`.slice(-200_000);

  useWebStore.getState().patchAgentTerminal(agentId, terminalId, {
    output: nextOutput,
    status: 'running',
  });
}

function stopRemoteTerminalSubscription(terminalId: string): void {
  const unsubscribe = remoteUnsubscribes.get(terminalId);

  if (unsubscribe) {
    unsubscribe();
    remoteUnsubscribes.delete(terminalId);
  }
}

export async function ensureWebAgentRemoteTerminal(
  agentId: string,
  terminal: WebAgentTerminal,
  context: RemoteTerminalContext,
): Promise<string | null> {
  if (terminal.remoteSessionId) {
    if (!remoteUnsubscribes.has(terminal.id)) {
      const channel = supabase
        .channel(`terminal:${terminal.remoteSessionId}`)
        .on('broadcast', { event: 'nexus' }, (message) => {
          const payload = message.payload as {
            payload?: { chunk?: string; session_id?: string };
          };
          const chunk = payload?.payload?.chunk;
          if (typeof chunk === 'string') {
            appendTerminalOutput(agentId, terminal.id, chunk);
          }
        })
        .subscribe();

      remoteUnsubscribes.set(terminal.id, () => {
        void supabase.removeChannel(channel);
      });
    }

    return terminal.remoteSessionId;
  }

  const createCommandId = await bridge.executeCommand({
    workspace_id: context.workspaceId,
    project_id: context.projectId,
    target_device_id: context.deviceId,
    type: 'terminal_create',
    payload: {
      title: terminal.title,
      cols: 100,
      rows: 28,
    },
    idempotency_key: crypto.randomUUID(),
  });

  const result = await waitForCommandResult(createCommandId);
  const sessionId =
    typeof result.terminal_session_id === 'string' ? result.terminal_session_id : null;

  if (!sessionId) {
    throw new Error('Sessão de terminal não retornada');
  }

  useWebStore.getState().patchAgentTerminal(agentId, terminal.id, {
    remoteSessionId: sessionId,
    status: 'running',
  });

  const { data: chunks } = await supabase
    .from('terminal_chunks')
    .select('content,sequence')
    .eq('session_id', sessionId)
    .order('sequence', { ascending: true })
    .limit(500);

  if (chunks?.length) {
    const replay = chunks
      .map((chunk) => (typeof chunk.content === 'string' ? chunk.content : ''))
      .join('');
    if (replay) {
      appendTerminalOutput(agentId, terminal.id, replay);
    }
  }

  const channel = supabase
    .channel(`terminal:${sessionId}`)
    .on('broadcast', { event: 'nexus' }, (message) => {
      const payload = message.payload as {
        payload?: { chunk?: string; session_id?: string };
      };
      const chunk = payload?.payload?.chunk;
      if (typeof chunk === 'string') {
        appendTerminalOutput(agentId, terminal.id, chunk);
      }
    })
    .subscribe();

  remoteUnsubscribes.set(terminal.id, () => {
    void supabase.removeChannel(channel);
  });

  await bridge.executeCommand({
    workspace_id: context.workspaceId,
    project_id: context.projectId,
    target_device_id: context.deviceId,
    type: 'terminal_stdin',
    payload: {
      session_id: sessionId,
      data: `${terminal.command}\n`,
    },
    terminal_session_id: sessionId,
    idempotency_key: crypto.randomUUID(),
  });

  return sessionId;
}

export async function dismissWebAgentTerminal(
  agentId: string,
  terminal: WebAgentTerminal,
  context: RemoteTerminalContext | null,
): Promise<void> {
  stopRemoteTerminalSubscription(terminal.id);

  if (terminal.remoteSessionId && context) {
    try {
      await bridge.executeCommand({
        workspace_id: context.workspaceId,
        project_id: context.projectId,
        target_device_id: context.deviceId,
        type: 'terminal_close',
        payload: { session_id: terminal.remoteSessionId },
        terminal_session_id: terminal.remoteSessionId,
        idempotency_key: crypto.randomUUID(),
      });
    } catch {
    }
  }

  useWebStore.getState().removeAgentTerminal(agentId, terminal.id);
}

function registerShellToolStarted(agentId: string, command: string): string {
  const trimmed = normalizeShellCommand(command);
  const terminalId = crypto.randomUUID();
  const entry: WebAgentTerminal = {
    id: terminalId,
    command: trimmed,
    title: buildWebShellTerminalTitle(trimmed),
    startedAt: Date.now(),
    status: 'starting',
    exitCode: null,
    output: '',
    remoteSessionId: null,
  };

  useWebStore.getState().upsertAgentTerminal(agentId, entry);
  enqueuePendingTerminal(agentId, terminalId);
  return terminalId;
}

function registerShellToolCompleted(agentId: string, event: WebShellToolEvent): void {
  const terminalId = dequeuePendingTerminal(agentId);

  if (!terminalId) {
    return;
  }

  const longRunning = isLongRunningScript(event.command);
  const status: WebAgentTerminalStatus = longRunning
    ? 'running'
    : event.exitCode === 0 || event.exitCode === null
      ? 'completed'
      : 'failed';

  useWebStore.getState().patchAgentTerminal(agentId, terminalId, {
    status,
    exitCode: event.exitCode,
    ...(event.output
      ? {
          output: event.output,
        }
      : {}),
  });

  if (status === 'completed' || status === 'failed') {
    window.setTimeout(() => {
      const agent = useWebStore.getState().agents.find((entry) => entry.id === agentId);
      const terminal = agent?.terminals.find((entry) => entry.id === terminalId);
      if (terminal && (terminal.status === 'completed' || terminal.status === 'failed')) {
        useWebStore.getState().removeAgentTerminal(agentId, terminalId);
      }
    }, 4000);
  }
}

export function handleWebAgentShellToolEvents(
  agentId: string,
  events: WebShellToolEvent[],
): void {
  for (const event of events) {
    if (!shouldOpenWebAgentShellTerminal(event.command)) {
      continue;
    }

    if (event.type === 'started') {
      registerShellToolStarted(agentId, event.command);
      continue;
    }

    registerShellToolCompleted(agentId, event);
  }
}

export function collectWebShellTerminalsFromEvents(
  events: WebShellToolEvent[],
): WebAgentTerminal[] {
  const terminals: WebAgentTerminal[] = [];
  const pending: string[] = [];

  for (const event of events) {
    if (!shouldOpenWebAgentShellTerminal(event.command)) {
      continue;
    }

    if (event.type === 'started') {
      const id = crypto.randomUUID();
      pending.push(id);
      terminals.push({
        id,
        command: normalizeShellCommand(event.command),
        title: buildWebShellTerminalTitle(event.command),
        startedAt: Date.now(),
        status: 'starting',
        exitCode: null,
        output: '',
        remoteSessionId: null,
      });
      continue;
    }

    const id = pending.shift();

    if (!id) {
      continue;
    }

    const longRunning = isLongRunningScript(event.command);
    const index = terminals.findIndex((entry) => entry.id === id);

    if (index < 0) {
      continue;
    }

    if (longRunning) {
      terminals[index] = {
        ...terminals[index],
        status: 'running',
        output: event.output || terminals[index].output,
      };
      continue;
    }

    terminals.splice(index, 1);
  }

  return terminals.filter(
    (entry) => entry.status === 'starting' || entry.status === 'running',
  );
}

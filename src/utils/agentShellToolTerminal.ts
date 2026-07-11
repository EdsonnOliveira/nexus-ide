import { useAgentShellTerminalStore } from '@/stores/useAgentShellTerminalStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import type { StreamJsonShellToolEvent } from '@/utils/agentStreamJsonParser';
import { findPaneTab } from '@/utils/tabGroups';
import { useProjectStore } from '@/stores/useProjectStore';

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

export function shouldOpenAgentShellToolTerminal(command: string): boolean {
  const normalized = normalizeShellCommand(command);

  if (!normalized) {
    return false;
  }

  const segments = normalized.split(/\s*(?:&&|\|\||;)\s*/);

  return segments.some((segment) => matchesDevTerminalScript(segment));
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

function buildShellToolTerminalTitle(command: string): string {
  const scriptName = resolveScriptName(command);

  if (scriptName && SCRIPT_TITLE_LABELS[scriptName]) {
    return SCRIPT_TITLE_LABELS[scriptName];
  }

  const preview = normalizeShellCommand(command);
  return preview.length > 40 ? `${preview.slice(0, 37)}…` : preview;
}

function resolveShellToolCwd(agentPaneId: string, cwd: string | null): string {
  const project = useProjectStore.getState().getActiveProject();
  const agentTab = project ? findPaneTab(project.tabs, agentPaneId) : null;

  return (
    cwd?.trim() ||
    (agentTab?.type === 'agent' ? agentTab.workingDirectory?.trim() : null) ||
    project?.path ||
    ''
  );
}

const pendingTerminalPanesByAgent = new Map<string, string[]>();

function enqueuePendingTerminal(agentPaneId: string, terminalPaneId: string): void {
  const queue = pendingTerminalPanesByAgent.get(agentPaneId) ?? [];
  queue.push(terminalPaneId);
  pendingTerminalPanesByAgent.set(agentPaneId, queue);
}

function dequeuePendingTerminal(agentPaneId: string): string | null {
  const queue = pendingTerminalPanesByAgent.get(agentPaneId);

  if (!queue?.length) {
    return null;
  }

  const paneId = queue.shift() ?? null;

  if (!queue.length) {
    pendingTerminalPanesByAgent.delete(agentPaneId);
  } else {
    pendingTerminalPanesByAgent.set(agentPaneId, queue);
  }

  return paneId;
}

function registerShellToolStarted(
  agentPaneId: string,
  command: string,
  cwd: string | null,
): string {
  const paneId = crypto.randomUUID();
  const resolvedCwd = resolveShellToolCwd(agentPaneId, cwd);
  const trimmed = normalizeShellCommand(command);

  useAgentShellTerminalStore.getState().addEntry(agentPaneId, {
    paneId,
    command: trimmed,
    title: buildShellToolTerminalTitle(trimmed),
    cwd: resolvedCwd,
    startedAt: Date.now(),
    status: 'starting',
    exitCode: null,
    ptyId: null,
  });

  useTerminalSessionStore.getState().setPendingLaunchCommand(paneId, trimmed);
  enqueuePendingTerminal(agentPaneId, paneId);

  return paneId;
}

function registerShellToolCompleted(
  agentPaneId: string,
  event: StreamJsonShellToolEvent,
): void {
  const paneId = dequeuePendingTerminal(agentPaneId);

  if (!paneId) {
    return;
  }

  const scriptName = resolveScriptName(event.command);
  const isLongRunning = scriptName
    ? ['dev', 'start', 'serve', 'ios', 'android', 'web'].includes(scriptName)
    : false;

  if (isLongRunning) {
    useAgentShellTerminalStore.getState().updateEntry(agentPaneId, paneId, {
      status: 'running',
    });
    return;
  }

  useAgentShellTerminalStore.getState().updateEntry(agentPaneId, paneId, {
    status: event.exitCode === 0 || event.exitCode === null ? 'completed' : 'failed',
    exitCode: event.exitCode,
  });
}

export async function handleAgentShellToolTerminalEvents(
  agentPaneId: string,
  events: StreamJsonShellToolEvent[],
  cwd: string | null,
): Promise<void> {
  for (const event of events) {
    if (!shouldOpenAgentShellToolTerminal(event.command)) {
      continue;
    }

    if (event.type === 'started') {
      registerShellToolStarted(agentPaneId, event.command, cwd);
      continue;
    }

    registerShellToolCompleted(agentPaneId, event);
  }
}

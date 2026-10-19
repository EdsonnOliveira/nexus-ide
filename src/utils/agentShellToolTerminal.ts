import { useAgentShellTerminalStore } from '@/stores/useAgentShellTerminalStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import type { StreamJsonShellToolEvent } from '@/utils/agentStreamJsonParser';
import { findProjectIdByPaneId } from '@/utils/findProjectIdByPaneId';
import { findPaneTab } from '@/utils/tabGroups';
import { useProjectStore } from '@/stores/useProjectStore';

const AGENT_TERMINAL_SCRIPT_NAMES = new Set(['dev', 'start', 'serve', 'ios', 'android', 'web']);

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

export function shouldKeepAgentShellsAlive(
  agentPaneId: string,
  activities: Array<{ kind: string; streaming?: boolean; toolCommand?: string }>,
): boolean {
  const entries = useAgentShellTerminalStore.getState().entriesByAgentPane[agentPaneId] ?? [];

  if (entries.some((entry) => entry.status === 'starting' || entry.status === 'running')) {
    return true;
  }

  return activities.some(
    (entry) =>
      entry.kind === 'tool_run' &&
      Boolean(entry.streaming) &&
      shouldOpenAgentShellToolTerminal(entry.toolCommand ?? ''),
  );
}

export function hasStreamingDevServerShell(
  activities: Array<{ kind: string; streaming?: boolean; toolCommand?: string }>,
): boolean {
  return activities.some(
    (entry) =>
      entry.kind === 'tool_run' &&
      Boolean(entry.streaming) &&
      shouldOpenAgentShellToolTerminal(entry.toolCommand ?? ''),
  );
}

export function hasBlockingAgentToolWork(
  activities: Array<{ kind: string; streaming?: boolean; toolCommand?: string }>,
): boolean {
  return activities.some((entry) => {
    if (entry.kind === 'task' && entry.streaming) {
      return true;
    }

    return entry.kind === 'tool_run' && Boolean(entry.streaming);
  });
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
  const trimmedCwd = cwd?.trim();

  if (trimmedCwd) {
    return trimmedCwd;
  }

  const projectId = findProjectIdByPaneId(agentPaneId);
  const project = projectId
    ? (useProjectStore.getState().projects.find((entry) => entry.id === projectId) ?? null)
    : useProjectStore.getState().getActiveProject();
  const agentTab = project ? findPaneTab(project.tabs, agentPaneId) : null;

  return (
    (agentTab?.type === 'agent' ? agentTab.workingDirectory?.trim() : null) || project?.path || ''
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
    kind: 'tool',
    command: trimmed,
    title: buildShellToolTerminalTitle(trimmed),
    cwd: resolvedCwd,
    startedAt: Date.now(),
    status: 'starting',
    exitCode: null,
    ptyId: null,
    commandDispatched: false,
    dispatchedAt: null,
    launchRetryCount: 0,
  });

  enqueuePendingTerminal(agentPaneId, paneId);

  return paneId;
}

const SHELL_HANDOFF_LAUNCH_DELAY_MS = 2_000;
const SHELL_HANDOFF_RETRY_DELAY_MS = 1_500;
const SHELL_HANDOFF_RETRY_WINDOW_MS = 40_000;
const SHELL_HANDOFF_MAX_RETRIES = 8;
const DEV_SERVER_PROBE_TIMEOUT_MS = 800;
const PORT_BUSY_PATTERN = /EADDRINUSE|address already in use|port \d+ is already in use/i;
const VITE_PROBE_PORTS = Array.from({ length: 20 }, (_, index) => 5173 + index);
const RETRY_PROBE_PORTS = [
  ...VITE_PROBE_PORTS,
  3000,
  3001,
  4173,
  8080,
  4200,
  8000,
  4321,
  5000,
  24678,
];
const handoffLaunchTimers = new Map<string, number>();
const handoffRetryTimers = new Map<string, number>();
const shellKeepAliveTimers = new Map<string, number>();

function isLongRunningScript(command: string): boolean {
  const scriptName = resolveScriptName(command);

  if (!scriptName) {
    return false;
  }

  return AGENT_TERMINAL_SCRIPT_NAMES.has(scriptName);
}

function extractExplicitPortsFromCommand(command: string): number[] {
  const ports = new Set<number>();
  const flagMatches = command.matchAll(/(?:--port|-p|--listen)\s+(\d{2,5})/gi);

  for (const match of flagMatches) {
    const port = Number(match[1]);

    if (Number.isFinite(port) && port >= 1 && port <= 65535) {
      ports.add(port);
    }
  }

  const urlMatches = command.matchAll(/localhost:(\d{2,5})|127\.0\.0\.1:(\d{2,5})/gi);

  for (const match of urlMatches) {
    const port = Number(match[1] || match[2]);

    if (Number.isFinite(port) && port >= 1 && port <= 65535) {
      ports.add(port);
    }
  }

  return [...ports];
}

async function isLocalPortOpen(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(DEV_SERVER_PROBE_TIMEOUT_MS),
    });
    return true;
  } catch {
    return false;
  }
}

async function isAnyPortOpen(ports: number[]): Promise<boolean> {
  for (const port of ports) {
    if (await isLocalPortOpen(port)) {
      return true;
    }
  }

  return false;
}

export async function isDevServerAlreadyUp(
  command: string,
  options?: { afterFailedLaunch?: boolean; viteOnly?: boolean },
): Promise<boolean> {
  const explicitPorts = extractExplicitPortsFromCommand(command);

  if (explicitPorts.length > 0) {
    return isAnyPortOpen(explicitPorts);
  }

  if (!options?.afterFailedLaunch) {
    return false;
  }

  if (options.viteOnly) {
    return isAnyPortOpen(VITE_PROBE_PORTS);
  }

  return isAnyPortOpen(RETRY_PROBE_PORTS);
}

export function isPortBusyShellOutput(output: string): boolean {
  return PORT_BUSY_PATTERN.test(output);
}

function writeLaunchCommandForAgent(
  agentPaneId: string,
  entry: { paneId: string; command: string; ptyId: string | null },
): void {
  const latest =
    useAgentShellTerminalStore
      .getState()
      .getEntries(agentPaneId)
      .find((item) => item.paneId === entry.paneId) ?? entry;
  const session = useTerminalSessionStore.getState();

  if (latest.ptyId) {
    session.takePendingLaunchCommand(latest.paneId);
    window.nexus.terminal.write(latest.ptyId, `\x15${latest.command}\n`);
    session.setLastCommand(latest.paneId, latest.command);
    return;
  }

  session.setPendingLaunchCommand(latest.paneId, latest.command);
}

export function prepareAgentShellHandoffRelaunch(agentPaneId: string, paneId?: string): void {
  const store = useAgentShellTerminalStore.getState();

  for (const entry of store.getEntries(agentPaneId)) {
    if (paneId && entry.paneId !== paneId) {
      continue;
    }

    if (!isLongRunningScript(entry.command)) {
      continue;
    }

    const retryKey = `${agentPaneId}:${entry.paneId}`;
    const retryTimer = handoffRetryTimers.get(retryKey);

    if (retryTimer) {
      window.clearTimeout(retryTimer);
      handoffRetryTimers.delete(retryKey);
    }

    store.updateEntry(agentPaneId, entry.paneId, {
      commandDispatched: false,
      dispatchedAt: null,
      launchRetryCount: 0,
      status: 'starting',
      exitCode: null,
    });
  }
}

async function waitForPortsToFree(command: string, attempts = 6): Promise<void> {
  const ports = extractExplicitPortsFromCommand(command);

  if (ports.length === 0) {
    return;
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!(await isAnyPortOpen(ports))) {
      return;
    }

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 500);
    });
  }
}

async function launchUndispatchedShellCommands(agentPaneId: string, paneId?: string): Promise<void> {
  const store = useAgentShellTerminalStore.getState();

  for (const entry of store.getEntries(agentPaneId)) {
    if (paneId && entry.paneId !== paneId) {
      continue;
    }

    if (entry.commandDispatched || !isLongRunningScript(entry.command)) {
      continue;
    }

    if (entry.cwd.trim()) {
      try {
        await window.nexus.terminal.cleanupProjectDevProcesses(entry.cwd);
      } catch {
      }
    }

    await waitForPortsToFree(entry.command);

    store.updateEntry(agentPaneId, entry.paneId, {
      commandDispatched: true,
      dispatchedAt: Date.now(),
      launchRetryCount: 0,
      status: 'starting',
    });
    writeLaunchCommandForAgent(
      agentPaneId,
      store.getEntries(agentPaneId).find((item) => item.paneId === entry.paneId) ?? entry,
    );
    ensureAgentShellKeepAlive(agentPaneId, entry.paneId);
  }
}

export function scheduleAgentShellCommandHandoff(agentPaneId: string, paneId?: string): void {
  const timerKey = paneId ? `${agentPaneId}:${paneId}` : agentPaneId;
  const existing = handoffLaunchTimers.get(timerKey);

  if (existing) {
    window.clearTimeout(existing);
  }

  const timer = window.setTimeout(() => {
    handoffLaunchTimers.delete(timerKey);
    void launchUndispatchedShellCommands(agentPaneId, paneId);
  }, SHELL_HANDOFF_LAUNCH_DELAY_MS);

  handoffLaunchTimers.set(timerKey, timer);
}

function ensureAgentShellKeepAlive(agentPaneId: string, paneId: string): void {
  const key = `${agentPaneId}:${paneId}`;

  if (shellKeepAliveTimers.has(key)) {
    return;
  }

  let inFlight = false;

  const timer = window.setInterval(() => {
    void (async () => {
      if (inFlight) {
        return;
      }

      inFlight = true;

      try {
        const entry = useAgentShellTerminalStore
          .getState()
          .getEntries(agentPaneId)
          .find((item) => item.paneId === paneId);

        if (!entry || !isLongRunningScript(entry.command)) {
          window.clearInterval(timer);
          shellKeepAliveTimers.delete(key);
          return;
        }

        if (entry.status !== 'starting' && entry.status !== 'running') {
          window.clearInterval(timer);
          shellKeepAliveTimers.delete(key);
          return;
        }

        if (!entry.commandDispatched) {
          return;
        }

        if (await isDevServerAlreadyUp(entry.command, { afterFailedLaunch: true, viteOnly: true })) {
          if (entry.status !== 'running') {
            useAgentShellTerminalStore.getState().updateEntry(agentPaneId, paneId, {
              status: 'running',
              exitCode: null,
            });
          }
          return;
        }

        if (entry.status === 'running') {
          return;
        }

        if (entry.launchRetryCount >= SHELL_HANDOFF_MAX_RETRIES) {
          return;
        }

        if (entry.cwd.trim()) {
          try {
            await window.nexus.terminal.cleanupProjectDevProcesses(entry.cwd);
          } catch {
          }
        }

        useAgentShellTerminalStore.getState().updateEntry(agentPaneId, paneId, {
          launchRetryCount: entry.launchRetryCount + 1,
          dispatchedAt: Date.now(),
          status: 'starting',
          exitCode: null,
        });
        writeLaunchCommandForAgent(agentPaneId, entry);
      } finally {
        inFlight = false;
      }
    })();
  }, 5_000);

  shellKeepAliveTimers.set(key, timer);
}

export async function retryAgentShellCommandIfNeeded(
  agentPaneId: string,
  paneId: string,
  options?: { outputHint?: string },
): Promise<boolean> {
  const store = useAgentShellTerminalStore.getState();
  const entry = store.getEntries(agentPaneId).find((item) => item.paneId === paneId);

  if (!entry?.commandDispatched || !isLongRunningScript(entry.command)) {
    return false;
  }

  if (entry.launchRetryCount >= SHELL_HANDOFF_MAX_RETRIES) {
    return false;
  }

  const dispatchedAt = entry.dispatchedAt ?? entry.startedAt;

  if (Date.now() - dispatchedAt > SHELL_HANDOFF_RETRY_WINDOW_MS) {
    return false;
  }

  const portBusy = Boolean(options?.outputHint && isPortBusyShellOutput(options.outputHint));
  const portStillHeld = await isDevServerAlreadyUp(entry.command, { afterFailedLaunch: true });

  store.updateEntry(agentPaneId, paneId, {
    launchRetryCount: entry.launchRetryCount + 1,
    dispatchedAt: Date.now(),
    status: 'starting',
    exitCode: null,
  });

  const retryKey = `${agentPaneId}:${paneId}`;
  const existingRetry = handoffRetryTimers.get(retryKey);

  if (existingRetry) {
    window.clearTimeout(existingRetry);
  }

  const delayMs = portBusy || portStillHeld ? SHELL_HANDOFF_RETRY_DELAY_MS : 400;
  const timer = window.setTimeout(() => {
    handoffRetryTimers.delete(retryKey);
    const latest = useAgentShellTerminalStore
      .getState()
      .getEntries(agentPaneId)
      .find((item) => item.paneId === paneId);

    if (!latest || !isLongRunningScript(latest.command)) {
      return;
    }

    writeLaunchCommandForAgent(agentPaneId, latest);
    ensureAgentShellKeepAlive(agentPaneId, paneId);
  }, delayMs);

  handoffRetryTimers.set(retryKey, timer);
  return true;
}

function registerShellToolCompleted(agentPaneId: string, event: StreamJsonShellToolEvent): void {
  const paneId = dequeuePendingTerminal(agentPaneId);

  if (!paneId) {
    return;
  }

  if (isLongRunningScript(event.command)) {
    const current = useAgentShellTerminalStore
      .getState()
      .getEntries(agentPaneId)
      .find((entry) => entry.paneId === paneId);

    if (current?.status === 'completed' || current?.status === 'failed') {
      return;
    }

    prepareAgentShellHandoffRelaunch(agentPaneId, paneId);
    scheduleAgentShellCommandHandoff(agentPaneId, paneId);
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

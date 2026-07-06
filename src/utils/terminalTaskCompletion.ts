import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';

const AGENT_READY_MARKERS = ['Add a follow-up', 'Adicionar follow-up', 'Message Claude'];
const AGENT_SETUP_COMMAND_DELAY_MS = 220;
const AGENT_TASK_PROMPT_EXTRA_DELAY_MS = 320;

const AGENT_BUSY_MARKERS = [
  'Reading',
  'Read ',
  'Grepped',
  'Globbing',
  'Globbed',
  'Grepping',
  'Searching',
  'Working',
  'Thinking',
  'Fetching',
  'Fetched',
  'Executing',
  'Executed',
  'Shell',
  'Edited',
  'Wrote',
  'Linting',
  'Planning',
  'Generating',
  'AskQuestion',
  'Resolving packages',
  'Fetching packages',
  'Linking dependencies',
  'Installing dependencies',
  'Building fresh packages',
  'Collecting build',
  'Collecting page data',
  'Generating static pages',
  '⠋',
  '⠙',
  '⠹',
  '⠸',
  '⠼',
  '⠴',
  '⠦',
  '⠧',
  '⠇',
  '⠏',
];

const AGENT_READY_TAIL_LINES = 6;

export const TURN_BUFFER_SIZE = 8192;
const TURN_TAIL_SIZE = 1024;
const RUNNING_STATUS_TAIL_SIZE = 512;
const MIN_TURN_MS = 400;
export const TERMINAL_TASK_SETTLE_MS = 1500;

export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[@-_]/g, '');
}

export function isAgentBusyInPlain(plain: string): boolean {
  const recentTail = getRecentTailLines(plain).join('\n');

  if (!recentTail.trim()) {
    return false;
  }

  if (AGENT_BUSY_MARKERS.some((marker) => recentTail.includes(marker))) {
    return true;
  }

  if (/\bRunning\b/.test(recentTail)) {
    return true;
  }

  if (/\[\d+\/\d+\]/.test(recentTail)) {
    return true;
  }

  if (/(?:Working|Grepping|Reading|Running)\s+[\d.]+\s*k?\s*tokens/i.test(recentTail)) {
    return true;
  }

  return false;
}

function hasAgentQuestionMarker(plain: string): boolean {
  if (/Question\s+\d+\s+of\s+\d+/i.test(plain)) {
    return true;
  }

  if (/\(\s*type to answer\s*\)/i.test(plain)) {
    return true;
  }

  const hasQuestionNavigation =
    /(?:↑|\u2191)\/(?:↓|\u2193)\s+option/i.test(plain) ||
    /Space\s+select/i.test(plain) ||
    /Enter\s+next(?:\/submit)?/i.test(plain) ||
    /Esc\s+to\s+skip/i.test(plain);

  if (!hasQuestionNavigation) {
    return false;
  }

  return (
    /Question\s+\d+/i.test(plain) ||
    /\[\s*\]/.test(plain) ||
    /(?:^|\n)\s*\d+\.\s+.+\?\s*$/m.test(plain)
  );
}

function isShellPromptLine(line: string): boolean {
  const trimmed = line.trim();

  if (!trimmed) {
    return false;
  }

  return (
    /^[%#$]\s*$/.test(trimmed) ||
    /^[^\s]+ [%#$]\s*$/.test(trimmed) ||
    /^~(?:\/[^\s]*)?\s[%#$]\s*$/.test(trimmed) ||
    /^\/(?:[^\s]*\/)?\s[%#$]\s*$/.test(trimmed)
  );
}

export function isShellPromptInTail(plain: string): boolean {
  const lines = plain.split(/\r?\n/);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? '';

    if (!line) {
      continue;
    }

    return isShellPromptLine(line);
  }

  return false;
}

function getRecentTailLines(plain: string): string[] {
  return plain.split(/\r?\n/).slice(-AGENT_READY_TAIL_LINES);
}

function hasAgentReadyMarker(plain: string): boolean {
  const lastLines = getRecentTailLines(plain);
  const recentTail = lastLines.join('\n');

  if (AGENT_READY_MARKERS.some((marker) => recentTail.includes(marker))) {
    return true;
  }

  return lastLines.some((line) => /^\s*[→›◆](?:\s|$)/.test(line) || /\s→\s*$/.test(line));
}

export function detectAgentBusyInChunk(turnBuffer: string): boolean {
  return isAgentBusyInPlain(stripAnsi(turnBuffer.slice(-TURN_TAIL_SIZE)));
}

export function detectAgentReadyInChunk(turnBuffer: string): boolean {
  const tailPlain = stripAnsi(turnBuffer.slice(-TURN_TAIL_SIZE));

  if (isAgentBusyInPlain(tailPlain)) {
    return false;
  }

  if (isShellPromptInTail(tailPlain) && !hasAgentReadyMarker(tailPlain)) {
    return false;
  }

  return hasAgentReadyMarker(tailPlain) || hasAgentQuestionMarker(tailPlain);
}

export function detectAgentFollowUpReadyInChunk(turnBuffer: string): boolean {
  const tailPlain = stripAnsi(turnBuffer.slice(-TURN_TAIL_SIZE));

  if (hasAgentReadyMarker(tailPlain) || hasAgentQuestionMarker(tailPlain)) {
    return true;
  }

  return isShellPromptInTail(tailPlain);
}

export function syncAgentBusyFromTail(
  paneId: string,
  tail: string,
  hasActiveAgent: boolean,
  setAgentBusy: (paneId: string, busy: boolean) => void,
  onLiveAgentBusy?: () => void,
  onAgentReady?: () => void,
): void {
  if (!hasActiveAgent) {
    const session = useTerminalSessionStore.getState();
    const hasWorkload =
      session.awaitingResponseByPane[paneId] ||
      session.agentNotifyEligibleByPane[paneId] ||
      session.agentBusyByPane[paneId];

    if (hasWorkload) {
      setAgentBusy(paneId, false);
      session.resetAgentWorkload(paneId);
    }

    return;
  }

  const tailPlain = stripAnsi(tail.slice(-TURN_TAIL_SIZE));
  const session = useTerminalSessionStore.getState();
  const isAwaitingTurn = Boolean(session.awaitingResponseByPane[paneId]);

  if (detectAgentReadyInChunk(tail) || detectAgentFollowUpReadyInChunk(tail)) {
    setAgentBusy(paneId, false);
    onAgentReady?.();
    return;
  }

  if (detectAgentBusyInChunk(tail)) {
    setAgentBusy(paneId, true);
    onLiveAgentBusy?.();
    return;
  }

  if (
    isAwaitingTurn &&
    isShellPromptInTail(tailPlain) &&
    !detectAgentReadyInChunk(tail)
  ) {
    setAgentBusy(paneId, true);
    onLiveAgentBusy?.();
    return;
  }
}

export function completeShellIdleTaskIfAwaiting(paneId: string): void {
  const session = useTerminalSessionStore.getState();

  if (session.activeAgentByPane[paneId]) {
    return;
  }

  session.completeTaskIfAwaiting(paneId);
}

export function isPaneTrackingAgentCompletion(
  paneId: string,
  awaitingResponseByPane: Record<string, boolean>,
  agentNotifyEligibleByPane: Record<string, boolean>,
  agentBusyByPane: Record<string, boolean>,
): boolean {
  return (
    awaitingResponseByPane[paneId] === true ||
    agentNotifyEligibleByPane[paneId] === true ||
    Boolean(agentBusyByPane[paneId])
  );
}

export interface AgentReadyStreamDetector {
  feed: (chunk: string) => void;
  reset: () => void;
}

const resetHandlersByPane = new Map<string, Set<() => void>>();

export function trackAgentReadyDetectorReset(paneId: string, reset: () => void): () => void {
  let handlers = resetHandlersByPane.get(paneId);

  if (!handlers) {
    handlers = new Set();
    resetHandlersByPane.set(paneId, handlers);
  }

  handlers.add(reset);

  return () => {
    handlers?.delete(reset);

    if (handlers?.size === 0) {
      resetHandlersByPane.delete(paneId);
    }
  };
}

export function resetAgentReadyDetectors(paneId: string): void {
  resetHandlersByPane.get(paneId)?.forEach((reset) => reset());
}

export function createSettledCallback(onSettled: () => void, settleMs = TERMINAL_TASK_SETTLE_MS): () => void {
  let settleTimer: number | null = null;

  return () => {
    if (settleTimer !== null) {
      window.clearTimeout(settleTimer);
    }

    settleTimer = window.setTimeout(() => {
      settleTimer = null;
      onSettled();
    }, settleMs);
  };
}

export function createAgentReadyStreamDetector(
  onReady: () => void,
  options?: { isAwaiting?: () => boolean; isBlocked?: () => boolean },
): AgentReadyStreamDetector {
  let turnBuffer = '';
  let resetAt = 0;
  let settleTimer: number | null = null;

  const clearSettleTimer = () => {
    if (settleTimer !== null) {
      window.clearTimeout(settleTimer);
      settleTimer = null;
    }
  };

  const runSettleCheck = () => {
    settleTimer = null;

    if (options?.isAwaiting && !options.isAwaiting()) {
      return;
    }

    if (options?.isBlocked?.()) {
      scheduleSettleCheck();
      return;
    }

    const elapsed = Date.now() - resetAt;

    if (elapsed < MIN_TURN_MS) {
      settleTimer = window.setTimeout(runSettleCheck, MIN_TURN_MS - elapsed);
      return;
    }

    if (detectAgentBusyInChunk(turnBuffer)) {
      scheduleSettleCheck();
      return;
    }

    const tailPlain = stripAnsi(turnBuffer.slice(-TURN_TAIL_SIZE));

    if (isShellPromptInTail(tailPlain) && !detectAgentReadyInChunk(turnBuffer)) {
      scheduleSettleCheck();
      return;
    }

    if (detectAgentReadyInChunk(turnBuffer)) {
      onReady();
    }
  };

  const scheduleSettleCheck = () => {
    clearSettleTimer();
    settleTimer = window.setTimeout(runSettleCheck, TERMINAL_TASK_SETTLE_MS);
  };

  const detector: AgentReadyStreamDetector = {
    feed(chunk: string) {
      turnBuffer = (turnBuffer + chunk).slice(-TURN_BUFFER_SIZE);
      scheduleSettleCheck();
    },
    reset() {
      turnBuffer = '';
      resetAt = Date.now();
      clearSettleTimer();
    },
  };

  return detector;
}

export function dispatchPendingAgentTaskCommands(
  paneId: string,
  writeCommand: (command: string) => void,
): boolean {
  const session = useTerminalSessionStore.getState();

  if (!session.activeAgentByPane[paneId]) {
    return false;
  }

  const setupCommands = session.takePendingAgentSetup(paneId);
  const hasPendingTaskPrompt = Boolean(session.pendingTaskPromptByPane[paneId]);

  if (setupCommands.length === 0 && !hasPendingTaskPrompt) {
    return false;
  }

  setupCommands.forEach((command, index) => {
    window.setTimeout(() => {
      writeCommand(command);
      const nextSession = useTerminalSessionStore.getState();
      nextSession.setLastCommand(paneId, command);
      nextSession.markAwaitingResponse(paneId);
    }, index * AGENT_SETUP_COMMAND_DELAY_MS);
  });

  if (hasPendingTaskPrompt) {
    window.setTimeout(() => {
      const prompt = useTerminalSessionStore.getState().takePendingTaskPrompt(paneId);

      if (!prompt) {
        return;
      }

      writeCommand(prompt);
      const nextSession = useTerminalSessionStore.getState();
      nextSession.setLastCommand(paneId, prompt);
      nextSession.markAwaitingResponse(paneId);
    }, setupCommands.length * AGENT_SETUP_COMMAND_DELAY_MS + AGENT_TASK_PROMPT_EXTRA_DELAY_MS);
  }

  return true;
}

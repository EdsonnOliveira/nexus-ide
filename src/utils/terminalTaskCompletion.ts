const AGENT_READY_MARKERS = ['Add a follow-up', 'Adicionar follow-up', 'Message Claude'];

const AGENT_BUSY_MARKERS = [
  'Reading',
  'Globbing',
  'Searching',
  'Working',
  'Thinking',
  'Running',
  'Fetching',
  'Executing',
  'Linting',
  'Planning',
  'Generating',
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

const TURN_BUFFER_SIZE = 4096;
const TURN_TAIL_SIZE = 512;
const MIN_TURN_MS = 400;
export const TERMINAL_TASK_SETTLE_MS = 1000;

export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[@-_]/g, '');
}

function isAgentBusyInPlain(plain: string): boolean {
  return AGENT_BUSY_MARKERS.some((marker) => plain.includes(marker));
}

function hasAgentReadyMarker(plain: string): boolean {
  if (AGENT_READY_MARKERS.some((marker) => plain.includes(marker))) {
    return true;
  }

  return /(?:^|[\r\n])\s*[→›◆](?:\s|$)/m.test(plain) || /\s→\s*$/.test(plain);
}

export function detectAgentReadyInChunk(turnBuffer: string, sawBusySinceReset: boolean): boolean {
  const tailPlain = stripAnsi(turnBuffer.slice(-TURN_TAIL_SIZE));

  if (isAgentBusyInPlain(tailPlain)) {
    return false;
  }

  if (hasAgentReadyMarker(tailPlain)) {
    return true;
  }

  const turnPlain = stripAnsi(turnBuffer).trim();

  if (!turnPlain) {
    return false;
  }

  return sawBusySinceReset || turnPlain.length > 0;
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
  options?: { isAwaiting?: () => boolean },
): AgentReadyStreamDetector {
  let turnBuffer = '';
  let sawBusySinceReset = false;
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

    const elapsed = Date.now() - resetAt;

    if (elapsed < MIN_TURN_MS) {
      settleTimer = window.setTimeout(runSettleCheck, MIN_TURN_MS - elapsed);
      return;
    }

    if (detectAgentReadyInChunk(turnBuffer, sawBusySinceReset)) {
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

      const tailPlain = stripAnsi(turnBuffer.slice(-TURN_TAIL_SIZE));

      if (isAgentBusyInPlain(tailPlain)) {
        sawBusySinceReset = true;
      }

      scheduleSettleCheck();
    },
    reset() {
      turnBuffer = '';
      sawBusySinceReset = false;
      resetAt = Date.now();
      clearSettleTimer();
    },
  };

  return detector;
}

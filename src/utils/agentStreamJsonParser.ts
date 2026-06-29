import type { AgentActivity, AgentTurn, AgentTurnSummary, AgentTurnSummaryFileRef } from '@/types';
import { isAgentTurnSummaryVisible } from '@/utils/agentTurnSummary';
import { sanitizeResponseText } from '@/utils/agentTranscriptParser';

export interface AgentStreamJsonUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AgentStreamJsonParserState {
  jsonBuffer: string;
  activities: AgentActivity[];
  thoughtId: string | null;
  thoughtStartedAt: number | null;
  responseId: string | null;
  seenReadPaths: Set<string>;
  editedPaths: Set<string>;
  exploredFiles: AgentTurnSummaryFileRef[];
  editedFiles: AgentTurnSummaryFileRef[];
  shellCommandCount: number;
  lineAdditions: number;
  lineDeletions: number;
  responseLead: string | null;
  summaryLeadCaptured: boolean;
  sessionId: string | null;
  pendingResponseText: string;
  pendingUsage: AgentStreamJsonUsage | null;
  shouldFinalize: boolean;
}

export interface StreamJsonTurnUpdate {
  hasUpdate: boolean;
  shouldFinalize: boolean;
  sessionId: string | null;
  responseText: string | null;
  usage: AgentStreamJsonUsage | null;
}

function createActivity(
  kind: AgentActivity['kind'],
  label: string,
  extra: Partial<AgentActivity> = {},
): AgentActivity {
  return {
    id: crypto.randomUUID(),
    kind,
    label,
    createdAt: Date.now(),
    ...extra,
  };
}

export function createAgentStreamJsonParserState(): AgentStreamJsonParserState {
  return {
    jsonBuffer: '',
    activities: [],
    thoughtId: null,
    thoughtStartedAt: null,
    responseId: null,
    seenReadPaths: new Set(),
    editedPaths: new Set(),
    exploredFiles: [],
    editedFiles: [],
    shellCommandCount: 0,
    lineAdditions: 0,
    lineDeletions: 0,
    responseLead: null,
    summaryLeadCaptured: false,
    sessionId: null,
    pendingResponseText: '',
    pendingUsage: null,
    shouldFinalize: false,
  };
}

function basenamePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] ?? filePath;
}

function shortenPath(filePath: string): string {
  const home = filePath.replace(/^\/Users\/[^/]+/, '~');
  return home.length > 72 ? `…${home.slice(-68)}` : home;
}

function extractAssistantText(message: unknown): string {
  if (!message || typeof message !== 'object') {
    return '';
  }

  const content = (message as { content?: unknown }).content;

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return '';
      }

      const text = (part as { text?: unknown }).text;
      return typeof text === 'string' ? text : '';
    })
    .filter(Boolean)
    .join('');
}

function upsertThought(state: AgentStreamJsonParserState, delta: string): void {
  if (!delta) {
    return;
  }

  if (!state.thoughtId) {
    const existing = state.activities.find((entry) => entry.kind === 'thought' && entry.streaming);

    if (existing) {
      state.thoughtId = existing.id;
      state.thoughtStartedAt = state.thoughtStartedAt ?? existing.createdAt;
      state.activities = state.activities.map((entry) =>
        entry.id === existing.id
          ? { ...entry, label: `${entry.label}${delta}`.trim() }
          : entry,
      );
      return;
    }

    const thought = createActivity('thought', delta.trim(), {
      streaming: true,
      collapsed: true,
    });
    state.thoughtId = thought.id;
    state.thoughtStartedAt = thought.createdAt;
    state.activities = [...state.activities.filter((entry) => entry.kind !== 'thought'), thought];
    return;
  }

  state.activities = state.activities.map((entry) =>
    entry.id === state.thoughtId
      ? { ...entry, label: `${entry.label}${delta}`.trim() }
      : entry,
  );
}

function settleThought(state: AgentStreamJsonParserState): void {
  if (!state.thoughtId) {
    return;
  }

  const startedAt = state.thoughtStartedAt ?? Date.now();
  const durationMs = Math.max(Date.now() - startedAt, 1000);

  state.activities = state.activities.map((entry) =>
    entry.id === state.thoughtId
      ? {
          ...entry,
          streaming: undefined,
          collapsed: true,
          durationMs,
          label: entry.label.trim(),
        }
      : entry,
  );

  state.thoughtId = null;
  state.thoughtStartedAt = null;
}

function upsertResponse(state: AgentStreamJsonParserState, text: string, streaming: boolean): void {
  const trimmed = text.trim();

  if (!trimmed) {
    return;
  }

  settleThought(state);
  state.pendingResponseText = trimmed;

  if (state.responseId) {
    state.activities = state.activities.map((entry) =>
      entry.id === state.responseId
        ? { ...entry, label: trimmed, streaming: streaming ? true : undefined }
        : entry,
    );
    return;
  }

  const response = createActivity('response', trimmed, { streaming: streaming ? true : undefined });
  state.responseId = response.id;
  state.activities = [
    ...state.activities.filter((entry) => entry.kind !== 'response'),
    response,
  ];
}

function upsertFileRead(state: AgentStreamJsonParserState, filePath: string, label?: string): void {
  const normalized = filePath.trim().toLowerCase();

  if (!normalized || state.seenReadPaths.has(normalized)) {
    return;
  }

  state.seenReadPaths.add(normalized);
  const displayPath = shortenPath(filePath);
  state.exploredFiles.push({ path: displayPath });
  const read = createActivity('file_read', label ?? 'Read', {
    filePath: displayPath,
    label: label ?? `Read ${basenamePath(filePath)}`,
  });

  state.activities = [...state.activities, read];
}

function trackEditedFile(
  state: AgentStreamJsonParserState,
  filePath: string,
  additions = 0,
  deletions = 0,
): void {
  const normalized = filePath.trim().toLowerCase();

  if (!normalized) {
    return;
  }

  if (!state.editedPaths.has(normalized)) {
    state.editedPaths.add(normalized);
    state.editedFiles.push({ path: shortenPath(filePath) });
  }

  state.lineAdditions += additions;
  state.lineDeletions += deletions;
}

function captureResponseLeadBeforeTools(state: AgentStreamJsonParserState): void {
  if (state.summaryLeadCaptured) {
    return;
  }

  state.summaryLeadCaptured = true;
  const lead = state.pendingResponseText.trim();

  if (lead) {
    state.responseLead = lead;
  }
}

function handleToolCallCompleted(state: AgentStreamJsonParserState, toolCall: unknown): void {
  if (!toolCall || typeof toolCall !== 'object') {
    return;
  }

  const payload = toolCall as Record<string, unknown>;
  const editToolCall = payload.editToolCall as
    | {
        args?: { path?: string };
        result?: { success?: { path?: string; linesAdded?: number; linesRemoved?: number } };
      }
    | undefined;

  if (editToolCall?.result?.success) {
    const success = editToolCall.result.success;
    const path = success.path ?? editToolCall.args?.path ?? '';

    trackEditedFile(state, path, success.linesAdded ?? 0, success.linesRemoved ?? 0);
    return;
  }

  const writeToolCall = payload.writeToolCall as
    | {
        args?: { path?: string };
        result?: { success?: { path?: string; linesAdded?: number; linesRemoved?: number } };
      }
    | undefined;

  if (writeToolCall?.result?.success) {
    const success = writeToolCall.result.success;
    const path = success.path ?? writeToolCall.args?.path ?? '';

    trackEditedFile(state, path, success.linesAdded ?? 0, success.linesRemoved ?? 0);
    return;
  }

  if (payload.shellToolCall) {
    state.shellCommandCount += 1;
  }
}

function handleToolCallStarted(state: AgentStreamJsonParserState, toolCall: unknown): void {
  captureResponseLeadBeforeTools(state);

  if (!toolCall || typeof toolCall !== 'object') {
    return;
  }

  const payload = toolCall as Record<string, unknown>;
  const readToolCall = payload.readToolCall as { args?: { path?: string } } | undefined;

  if (readToolCall?.args?.path) {
    upsertFileRead(state, readToolCall.args.path);
    return;
  }

  const globToolCall = payload.globToolCall as
    | { args?: { globPattern?: string; targetDirectory?: string } }
    | undefined;

  if (globToolCall?.args) {
    const pattern = globToolCall.args.globPattern?.trim() || '**/*';
    const directory = globToolCall.args.targetDirectory?.trim();
    const label = directory
      ? `Glob ${pattern} in ${basenamePath(directory)}`
      : `Glob ${pattern}`;
    upsertFileRead(state, directory ?? pattern, label);
    return;
  }

  const grepToolCall = payload.grepToolCall as { args?: { pattern?: string; path?: string } } | undefined;

  if (grepToolCall?.args?.pattern) {
    const pattern = grepToolCall.args.pattern.trim();
    const path = grepToolCall.args.path?.trim();
    const label = path ? `Grep ${pattern} in ${basenamePath(path)}` : `Grep ${pattern}`;
    upsertFileRead(state, path ?? pattern, label);
  }
}

function parseUsage(raw: unknown): AgentStreamJsonUsage | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const usage = raw as Record<string, unknown>;
  const inputTokens = typeof usage.inputTokens === 'number' ? usage.inputTokens : 0;
  const outputTokens = typeof usage.outputTokens === 'number' ? usage.outputTokens : 0;
  const cacheReadTokens = typeof usage.cacheReadTokens === 'number' ? usage.cacheReadTokens : 0;
  const cacheWriteTokens = typeof usage.cacheWriteTokens === 'number' ? usage.cacheWriteTokens : 0;

  if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens <= 0) {
    return null;
  }

  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
}

function handleStreamJsonEvent(state: AgentStreamJsonParserState, event: Record<string, unknown>): void {
  const type = typeof event.type === 'string' ? event.type : '';

  if (type === 'system' && event.subtype === 'init' && typeof event.session_id === 'string') {
    state.sessionId = event.session_id;
    return;
  }

  if (type === 'thinking') {
    if (event.subtype === 'delta' && typeof event.text === 'string') {
      upsertThought(state, event.text);
      return;
    }

    if (event.subtype === 'completed') {
      settleThought(state);
    }

    return;
  }

  if (type === 'tool_call' && event.subtype === 'started') {
    handleToolCallStarted(state, event.tool_call);
    return;
  }

  if (type === 'tool_call' && event.subtype === 'completed') {
    handleToolCallCompleted(state, event.tool_call);
    return;
  }

  if (type === 'assistant') {
    const text = extractAssistantText(event.message);
    upsertResponse(state, text, true);
    return;
  }

  if (type === 'result') {
    if (typeof event.session_id === 'string') {
      state.sessionId = event.session_id;
    }

    const usage = parseUsage(event.usage);

    if (usage) {
      state.pendingUsage = usage;
    }

    if (event.subtype === 'success') {
      const resultText = typeof event.result === 'string' ? event.result : state.pendingResponseText;
      upsertResponse(state, resultText, false);
      state.shouldFinalize = true;
    }
  }
}

function findJsonObjectEnd(value: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function consumeJsonObjects(state: AgentStreamJsonParserState): void {
  while (state.jsonBuffer.length > 0) {
    const start = state.jsonBuffer.indexOf('{');

    if (start === -1) {
      state.jsonBuffer = '';
      return;
    }

    if (start > 0) {
      state.jsonBuffer = state.jsonBuffer.slice(start);
    }

    const end = findJsonObjectEnd(state.jsonBuffer);

    if (end === -1) {
      return;
    }

    const candidate = state.jsonBuffer.slice(0, end + 1);
    state.jsonBuffer = state.jsonBuffer.slice(end + 1);

    try {
      handleStreamJsonEvent(state, JSON.parse(candidate) as Record<string, unknown>);
    } catch {
      state.jsonBuffer = state.jsonBuffer.slice(1);
    }
  }
}

export function feedAgentStreamJsonChunk(
  state: AgentStreamJsonParserState,
  chunk: string,
): StreamJsonTurnUpdate {
  const previousFinalize = state.shouldFinalize;
  const previousActivityCount = state.activities.length;
  const previousResponseText = state.pendingResponseText;
  const previousThoughtLabel =
    state.activities.find((entry) => entry.kind === 'thought')?.label ?? '';

  state.jsonBuffer += chunk;
  consumeJsonObjects(state);

  const nextThoughtLabel =
    state.activities.find((entry) => entry.kind === 'thought')?.label ?? '';
  const hasUpdate =
    state.activities.length !== previousActivityCount ||
    state.pendingResponseText !== previousResponseText ||
    nextThoughtLabel !== previousThoughtLabel;
  const shouldFinalize = state.shouldFinalize && !previousFinalize;

  return {
    hasUpdate,
    shouldFinalize,
    sessionId: state.sessionId,
    responseText: state.pendingResponseText || null,
    usage: state.pendingUsage,
  };
}

export function buildAgentTurnSummaryFromStreamJsonState(
  state: AgentStreamJsonParserState,
): AgentTurnSummary | undefined {
  const summary: AgentTurnSummary = {
    editedFileCount: state.editedPaths.size,
    exploredFileCount: state.seenReadPaths.size,
    commandCount: state.shellCommandCount,
    additions: state.lineAdditions,
    deletions: state.lineDeletions,
    ...(state.responseLead ? { responseLead: state.responseLead } : {}),
    ...(state.exploredFiles.length > 0 ? { exploredFiles: [...state.exploredFiles] } : {}),
    ...(state.editedFiles.length > 0 ? { editedFiles: [...state.editedFiles] } : {}),
  };

  return isAgentTurnSummaryVisible(summary) ? summary : undefined;
}

export function finalizeStreamJsonTurn(turn: AgentTurn, state: AgentStreamJsonParserState): AgentTurn {
  consumeJsonObjects(state);
  state.jsonBuffer = '';

  let activities = state.activities
    .filter((entry) => entry.kind !== 'live_status')
    .map((entry) => {
      if (entry.kind === 'thought' && entry.streaming) {
        return {
          ...entry,
          streaming: undefined,
          collapsed: true,
          durationMs: entry.durationMs ?? Math.max(Date.now() - turn.startedAt, 1000),
        };
      }

      if (entry.kind === 'response') {
        return { ...entry, streaming: undefined };
      }

      return entry;
    });

  if (!activities.some((entry) => entry.kind === 'response') && state.pendingResponseText.trim()) {
    activities = [
      ...activities.filter((entry) => entry.kind !== 'response'),
      createActivity('response', state.pendingResponseText.trim()),
    ];
  }

  activities = activities.filter(
    (entry) => entry.kind === 'response' && sanitizeResponseText(entry.label).trim().length > 0,
  );

  const summary = buildAgentTurnSummaryFromStreamJsonState(state);

  if (activities.length === 0 && isAgentTurnSummaryVisible(summary)) {
    activities = [createActivity('response', 'Skill executada.')];
  }

  return {
    ...turn,
    activities,
    ...(summary ? { summary } : {}),
    running: false,
    completedAt: Date.now(),
  };
}

export function resetAgentStreamJsonTurn(state: AgentStreamJsonParserState): void {
  state.jsonBuffer = '';
  state.activities = [];
  state.thoughtId = null;
  state.thoughtStartedAt = null;
  state.responseId = null;
  state.seenReadPaths.clear();
  state.editedPaths.clear();
  state.exploredFiles = [];
  state.editedFiles = [];
  state.shellCommandCount = 0;
  state.lineAdditions = 0;
  state.lineDeletions = 0;
  state.responseLead = null;
  state.summaryLeadCaptured = false;
  state.pendingResponseText = '';
  state.pendingUsage = null;
  state.shouldFinalize = false;
}

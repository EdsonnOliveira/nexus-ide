import type {
  AgentActivity,
  AgentPlanTodo,
  AgentQuestionItem,
  AgentQuestionOption,
  AgentTurn,
  AgentTurnSummary,
  AgentTurnSummaryCommandRef,
  AgentTurnSummaryFileRef,
} from '@/types';
import { isAgentTurnSummaryVisible } from '@/utils/agentTurnSummary';
import { writeDebugSessionLog } from '@/utils/debugSessionLog';
import { sanitizeResponseText } from '@/utils/agentTranscriptParser';
import { shouldOpenAgentShellToolTerminal } from '@/utils/agentShellToolTerminal';
import { ensureOtherOption } from '@/utils/agentQuestionPrompt';
import {
  deduplicatePlanResponseActivities,
  normalizePlanTodos,
  parsePlanTodosFromMarkdown,
} from '@/utils/agentPlanPrompt';

const MAX_THOUGHT_LABEL_CHARS = 200_000;

export interface AgentStreamJsonUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface StreamJsonShellToolEvent {
  type: 'started' | 'completed';
  command: string;
  output: string;
  exitCode: number | null;
}

export interface AgentStreamJsonParserState {
  jsonBuffer: string;
  activities: AgentActivity[];
  thoughtId: string | null;
  thoughtStartedAt: number | null;
  thoughtSessionStartedAt: number | null;
  responseId: string | null;
  seenReadPaths: Set<string>;
  editedPaths: Set<string>;
  exploredFiles: AgentTurnSummaryFileRef[];
  editedFiles: AgentTurnSummaryFileRef[];
  shellCommands: AgentTurnSummaryCommandRef[];
  shellCommandCount: number;
  lineAdditions: number;
  lineDeletions: number;
  responseLead: string | null;
  summaryLeadCaptured: boolean;
  sessionId: string | null;
  pendingResponseText: string;
  pendingUsage: AgentStreamJsonUsage | null;
  shouldFinalize: boolean;
  pendingQuestion: boolean;
  questionActivityId: string | null;
  pendingPlan: boolean;
  planActivityId: string | null;
  shellToolEvents: StreamJsonShellToolEvent[];
  runningToolRunStack: string[];
  runningTaskStack: string[];
  sawStreamingAssistantDelta: boolean;
  handoffComplete: boolean;
}

export interface StreamJsonTurnUpdate {
  hasUpdate: boolean;
  shouldFinalize: boolean;
  sessionId: string | null;
  responseText: string | null;
  usage: AgentStreamJsonUsage | null;
  shellToolEvents: StreamJsonShellToolEvent[];
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
    thoughtSessionStartedAt: null,
    responseId: null,
    seenReadPaths: new Set(),
    editedPaths: new Set(),
    exploredFiles: [],
    editedFiles: [],
    shellCommands: [],
    shellCommandCount: 0,
    lineAdditions: 0,
    lineDeletions: 0,
    responseLead: null,
    summaryLeadCaptured: false,
    sessionId: null,
    pendingResponseText: '',
    pendingUsage: null,
    shouldFinalize: false,
    pendingQuestion: false,
    questionActivityId: null,
    pendingPlan: false,
    planActivityId: null,
    shellToolEvents: [],
    runningToolRunStack: [],
    runningTaskStack: [],
    sawStreamingAssistantDelta: false,
    handoffComplete: false,
  };
}

function extractShellToolOutput(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }

  if (!result || typeof result !== 'object') {
    return '';
  }

  const record = result as Record<string, unknown>;
  const success = record.success;

  if (success && typeof success === 'object') {
    const successRecord = success as Record<string, unknown>;

    return [
      successRecord.stdout,
      successRecord.stderr,
      successRecord.output,
      successRecord.content,
      successRecord.text,
    ]
      .filter((value): value is string => typeof value === 'string')
      .join('\n');
  }

  const directOutput = [record.stdout, record.stderr, record.output, record.content, record.text]
    .filter((value): value is string => typeof value === 'string')
    .join('\n');

  if (directOutput.trim()) {
    return directOutput;
  }

  const failure = record.error ?? record.rejected ?? record.failure;

  if (failure && typeof failure === 'object') {
    const failureRecord = failure as Record<string, unknown>;

    return [failureRecord.message, failureRecord.stderr, failureRecord.stdout, failureRecord.output]
      .filter((value): value is string => typeof value === 'string')
      .join('\n');
  }

  return '';
}

function extractShellToolExitCode(result: unknown): number | null {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const record = result as Record<string, unknown>;
  const success = record.success;
  const failure = record.error ?? record.rejected ?? record.failure;
  const candidates = [
    record.exitCode,
    record.exit_code,
    success && typeof success === 'object'
      ? ((success as Record<string, unknown>).exitCode ??
        (success as Record<string, unknown>).exit_code)
      : null,
    failure && typeof failure === 'object'
      ? ((failure as Record<string, unknown>).exitCode ??
        (failure as Record<string, unknown>).exit_code)
      : null,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return null;
}

function basenamePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] ?? filePath;
}

function toStoredAgentFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/Users\/[^/]+/, '~');
}

function isSafeAssistantImageSrc(src: string): boolean {
  const trimmed = src.trim();

  if (!trimmed || /[\s<>"']/.test(trimmed)) {
    return false;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return true;
  }

  if (/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(trimmed)) {
    return true;
  }

  if (/^file:\/\/.+\.(png|jpe?g|gif|webp|bmp|svg)(?:\?.*)?$/i.test(trimmed)) {
    return true;
  }

  return /(?:\/|\.\.?\/|[A-Za-z]:[\\/]|^)[^\s]+\.(png|jpe?g|gif|webp|bmp|svg)(?:\?.*)?$/i.test(
    trimmed,
  );
}

function extractAssistantImageMarkdown(part: Record<string, unknown>): string {
  const type = typeof part.type === 'string' ? part.type.toLowerCase() : '';

  if (type === 'image_url') {
    const imageUrl = part.image_url;

    if (typeof imageUrl === 'string' && isSafeAssistantImageSrc(imageUrl)) {
      return `\n\n![](${imageUrl})\n\n`;
    }

    if (imageUrl && typeof imageUrl === 'object') {
      const url = (imageUrl as { url?: unknown }).url;

      if (typeof url === 'string' && isSafeAssistantImageSrc(url)) {
        return `\n\n![](${url})\n\n`;
      }
    }
  }

  if (type === 'image' || type === 'input_image' || type === 'media_image') {
    if (typeof part.url === 'string' && isSafeAssistantImageSrc(part.url)) {
      return `\n\n![](${part.url})\n\n`;
    }

    if (typeof part.image === 'string' && isSafeAssistantImageSrc(part.image)) {
      return `\n\n![](${part.image})\n\n`;
    }

    const source = part.source;

    if (source && typeof source === 'object') {
      const record = source as Record<string, unknown>;

      if (typeof record.url === 'string' && isSafeAssistantImageSrc(record.url)) {
        return `\n\n![](${record.url})\n\n`;
      }

      if (typeof record.data === 'string' && record.data.length > 0) {
        const mediaType =
          typeof record.media_type === 'string'
            ? record.media_type
            : typeof record.mediaType === 'string'
              ? record.mediaType
              : 'image/png';

        if (mediaType.startsWith('image/')) {
          const dataUrl = record.data.startsWith('data:')
            ? record.data
            : `data:${mediaType};base64,${record.data}`;

          if (isSafeAssistantImageSrc(dataUrl)) {
            return `\n\n![](${dataUrl})\n\n`;
          }
        }
      }
    }

    if (typeof part.data === 'string' && part.data.length > 0) {
      const mediaType =
        typeof part.media_type === 'string'
          ? part.media_type
          : typeof part.mimeType === 'string'
            ? part.mimeType
            : 'image/png';

      if (mediaType.startsWith('image/')) {
        const dataUrl = part.data.startsWith('data:')
          ? part.data
          : `data:${mediaType};base64,${part.data}`;

        if (isSafeAssistantImageSrc(dataUrl)) {
          return `\n\n![](${dataUrl})\n\n`;
        }
      }
    }
  }

  return '';
}

function isThinkingContentType(type: string): boolean {
  return type === 'thinking' || type === 'reasoning';
}

function extractThinkingFromMessage(message: unknown): string {
  if (!message || typeof message !== 'object') {
    return '';
  }

  const content = (message as { content?: unknown }).content;

  if (typeof content === 'string') {
    return '';
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return '';
      }

      const entry = part as Record<string, unknown>;
      const partType = typeof entry.type === 'string' ? entry.type.toLowerCase() : '';

      if (!isThinkingContentType(partType)) {
        return '';
      }

      if (typeof entry.thinking === 'string' && entry.thinking) {
        return entry.thinking;
      }

      if (typeof entry.text === 'string' && entry.text) {
        return entry.text;
      }

      return '';
    })
    .filter(Boolean)
    .join('');
}

function extractThinkingDelta(event: Record<string, unknown>): string {
  if (typeof event.text === 'string' && event.text) {
    return event.text;
  }

  if (typeof event.delta === 'string' && event.delta) {
    return event.delta;
  }

  if (event.delta && typeof event.delta === 'object') {
    const delta = event.delta as { text?: unknown; thinking?: unknown };

    if (typeof delta.text === 'string' && delta.text) {
      return delta.text;
    }

    if (typeof delta.thinking === 'string' && delta.thinking) {
      return delta.thinking;
    }
  }

  if (typeof event.thinking === 'string' && event.thinking) {
    return event.thinking;
  }

  const fromMessage = extractThinkingFromMessage(event.message);

  if (fromMessage) {
    return fromMessage;
  }

  return extractThinkingFromMessage(event);
}

function extractSessionId(event: Record<string, unknown>): string | null {
  if (typeof event.session_id === 'string' && event.session_id.trim()) {
    return event.session_id;
  }

  if (typeof event.sessionId === 'string' && event.sessionId.trim()) {
    return event.sessionId;
  }

  if (typeof event.sessionID === 'string' && event.sessionID.trim()) {
    return event.sessionID;
  }

  return null;
}

function extractAssistantText(message: unknown): string {
  if (typeof message === 'string') {
    return message;
  }

  if (!message || typeof message !== 'object') {
    return '';
  }

  const record = message as { content?: unknown; text?: unknown };

  if (typeof record.text === 'string') {
    return record.text;
  }

  const content = record.content;

  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      if (!part || typeof part !== 'object') {
        return '';
      }

      const entry = part as Record<string, unknown>;
      const partType = typeof entry.type === 'string' ? entry.type.toLowerCase() : '';

      if (isThinkingContentType(partType)) {
        return '';
      }

      const text = entry.text;

      if (typeof text === 'string' && text) {
        return text;
      }

      return extractAssistantImageMarkdown(entry);
    })
    .filter(Boolean)
    .join('');
}

function getStreamActivitySignature(activities: AgentActivity[]): string {
  return activities
    .map(
      (entry) =>
        `${entry.id}:${entry.kind}:${entry.label.length}:${entry.streaming ? 1 : 0}:${entry.filePath ?? ''}:${entry.additions ?? ''}:${entry.deletions ?? ''}`,
    )
    .join('|');
}

function findLatestThoughtActivity(state: AgentStreamJsonParserState): AgentActivity | undefined {
  for (let index = state.activities.length - 1; index >= 0; index -= 1) {
    const entry = state.activities[index];

    if (entry?.kind === 'thought') {
      return entry;
    }
  }

  return undefined;
}

function findStreamingThoughtActivity(
  state: AgentStreamJsonParserState,
): AgentActivity | undefined {
  if (state.thoughtId) {
    const tracked = state.activities.find((entry) => entry.id === state.thoughtId);

    if (tracked?.kind === 'thought') {
      return tracked;
    }
  }

  return state.activities.find((entry) => entry.kind === 'thought' && entry.streaming);
}

function appendThoughtDelta(currentLabel: string, delta: string): string {
  if (!currentLabel) {
    return delta.length > MAX_THOUGHT_LABEL_CHARS
      ? delta.slice(delta.length - MAX_THOUGHT_LABEL_CHARS)
      : delta;
  }

  if (!delta) {
    return currentLabel;
  }

  const combined = `${currentLabel}${delta}`;

  return combined.length > MAX_THOUGHT_LABEL_CHARS
    ? combined.slice(combined.length - MAX_THOUGHT_LABEL_CHARS)
    : combined;
}

function upsertThought(state: AgentStreamJsonParserState, delta: string): void {
  if (!delta) {
    return;
  }

  clearStreamJsonLiveStatus(state);

  const streamingThought = findStreamingThoughtActivity(state);

  if (streamingThought?.streaming) {
    state.thoughtId = streamingThought.id;
    state.thoughtStartedAt = state.thoughtSessionStartedAt ?? streamingThought.createdAt;
    state.thoughtSessionStartedAt = state.thoughtSessionStartedAt ?? streamingThought.createdAt;
    state.activities = state.activities.map((entry) =>
      entry.id === streamingThought.id
        ? {
            ...entry,
            label: appendThoughtDelta(entry.label, delta),
            collapsed: false,
          }
        : entry,
    );
    return;
  }

  const thought = createActivity('thought', delta.trim(), {
    streaming: true,
    collapsed: false,
  });
  state.thoughtId = thought.id;
  state.thoughtStartedAt = thought.createdAt;
  state.thoughtSessionStartedAt = thought.createdAt;
  state.activities = [...state.activities, thought];
}

function hasVisibleStreamJsonProgress(state: AgentStreamJsonParserState): boolean {
  return state.activities.some((entry) => {
    if (entry.kind === 'thought') {
      return Boolean(entry.label.trim());
    }

    if (entry.kind === 'file_read' || entry.kind === 'file_edit') {
      return Boolean(entry.filePath?.trim());
    }

    if (entry.kind === 'tool_run' || entry.kind === 'status') {
      return Boolean(entry.label.trim() || entry.toolCommand?.trim());
    }

    if (entry.kind === 'task') {
      return Boolean(entry.label.trim());
    }

    if (entry.kind === 'response') {
      return Boolean(entry.label.trim());
    }

    if (entry.kind === 'question' || entry.kind === 'plan') {
      return true;
    }

    return false;
  });
}

export function hasStreamJsonVisibleProgress(state: AgentStreamJsonParserState): boolean {
  return hasVisibleStreamJsonProgress(state);
}

function hasStreamingThoughtContent(state: AgentStreamJsonParserState): boolean {
  const thought = findStreamingThoughtActivity(state);
  return Boolean(thought?.streaming && thought.label.trim());
}

export function hasActiveStreamJsonToolOrTask(state: AgentStreamJsonParserState): boolean {
  if (state.runningToolRunStack.length > 0 || state.runningTaskStack.length > 0) {
    return true;
  }

  return state.activities.some(
    (entry) => (entry.kind === 'tool_run' || entry.kind === 'task') && Boolean(entry.streaming),
  );
}

function pruneEmptyThoughtPlaceholders(state: AgentStreamJsonParserState): boolean {
  const hasOtherProgress = state.activities.some((entry) => {
    if (entry.kind === 'thought') {
      return Boolean(entry.label.trim());
    }

    if (entry.kind === 'file_read' || entry.kind === 'file_edit') {
      return Boolean(entry.filePath?.trim());
    }

    if (entry.kind === 'tool_run' || entry.kind === 'live_status' || entry.kind === 'status') {
      return Boolean(entry.label.trim() || entry.toolCommand?.trim());
    }

    if (entry.kind === 'task') {
      return Boolean(entry.label.trim());
    }

    if (entry.kind === 'response') {
      return Boolean(entry.label.trim());
    }

    return entry.kind === 'question' || entry.kind === 'plan';
  });

  if (!hasOtherProgress) {
    return false;
  }

  const lastIndex = state.activities.length - 1;
  const keepTrailingToolThought = hasActiveStreamJsonToolOrTask(state);
  const next = state.activities.filter((entry, index) => {
    if (!(entry.kind === 'thought' && !entry.label.trim())) {
      return true;
    }

    return Boolean(keepTrailingToolThought && entry.streaming && index === lastIndex);
  });

  if (next.length === state.activities.length) {
    return false;
  }

  state.activities = next;

  if (state.thoughtId && !next.some((entry) => entry.id === state.thoughtId)) {
    state.thoughtId = null;
    state.thoughtStartedAt = null;
    state.thoughtSessionStartedAt = null;
  }

  return true;
}

function hasActiveTurnProgressUi(state: AgentStreamJsonParserState): boolean {
  if (hasActiveStreamJsonToolOrTask(state)) {
    return true;
  }

  return state.activities.some((entry) => {
    if (entry.kind === 'thought' && entry.streaming) {
      return true;
    }

    if (entry.kind === 'live_status' && entry.label.trim()) {
      return true;
    }

    if (entry.kind === 'response' && entry.streaming) {
      return true;
    }

    return false;
  });
}

function ensureTrailingStreamingThought(state: AgentStreamJsonParserState): boolean {
  const streamingThought = findStreamingThoughtActivity(state);

  if (streamingThought?.streaming) {
    if (streamingThought.label.trim()) {
      return false;
    }

    const last = state.activities[state.activities.length - 1];

    if (last?.id === streamingThought.id) {
      return false;
    }

    state.activities = [
      ...state.activities.filter((entry) => entry.id !== streamingThought.id),
      streamingThought,
    ];
    return true;
  }

  const thought = createActivity('thought', '', {
    streaming: true,
    collapsed: false,
  });

  state.thoughtId = thought.id;
  state.thoughtStartedAt = thought.createdAt;
  state.thoughtSessionStartedAt = thought.createdAt;
  state.activities = [...state.activities, thought];
  return true;
}

function ensureRunningProgressPlaceholder(state: AgentStreamJsonParserState): boolean {
  if (hasActiveTurnProgressUi(state)) {
    return false;
  }

  if (!hasVisibleStreamJsonProgress(state)) {
    return ensureTrailingStreamingThought(state);
  }

  return upsertStreamJsonLiveStatus(state, 'Planning next moves...');
}

function settleThought(state: AgentStreamJsonParserState): void {
  const thought = findStreamingThoughtActivity(state) ?? findLatestThoughtActivity(state);

  if (!thought) {
    return;
  }

  if (!thought.label.trim()) {
    const hasOtherProgress = state.activities.some((entry) => {
      if (entry.id === thought.id) {
        return false;
      }

      if (entry.kind === 'thought') {
        return Boolean(entry.label.trim());
      }

      if (entry.kind === 'file_read' || entry.kind === 'file_edit') {
        return Boolean(entry.filePath?.trim());
      }

      if (entry.kind === 'tool_run' || entry.kind === 'live_status' || entry.kind === 'status') {
        return Boolean(entry.label.trim() || entry.toolCommand?.trim());
      }

      if (entry.kind === 'response') {
        return Boolean(entry.label.trim());
      }

      return entry.kind === 'question' || entry.kind === 'plan';
    });

    if (!hasOtherProgress) {
      state.thoughtId = thought.id;
      state.thoughtStartedAt = state.thoughtStartedAt ?? thought.createdAt;
      state.thoughtSessionStartedAt = state.thoughtSessionStartedAt ?? thought.createdAt;
      state.activities = state.activities.map((entry) =>
        entry.id === thought.id
          ? {
              ...entry,
              streaming: true,
              collapsed: false,
            }
          : entry,
      );
      return;
    }

    state.activities = state.activities.filter((entry) => entry.id !== thought.id);
    state.thoughtId = null;
    state.thoughtStartedAt = null;
    state.thoughtSessionStartedAt = null;
    return;
  }

  const startedAt = state.thoughtSessionStartedAt ?? thought.createdAt ?? Date.now();
  const durationMs = Math.max(Date.now() - startedAt, 1000);

  state.activities = state.activities.map((entry) =>
    entry.id === thought.id
      ? {
          ...entry,
          streaming: undefined,
          collapsed: false,
          durationMs,
          label: entry.label.trim(),
        }
      : entry,
  );

  state.thoughtId = null;
  state.thoughtStartedAt = null;
  state.thoughtSessionStartedAt = null;
}

function sealActiveResponseSegment(state: AgentStreamJsonParserState): void {
  if (!state.responseId) {
    return;
  }

  const responseId = state.responseId;

  state.activities = state.activities.map((entry) =>
    entry.id === responseId && entry.kind === 'response'
      ? { ...entry, streaming: undefined }
      : entry,
  );
  state.responseId = null;
}

function compactResponseText(value: string): string {
  return value.replace(/\s+/g, '');
}

function findLastResponseActivity(activities: AgentActivity[]): AgentActivity | undefined {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const entry = activities[index];

    if (entry?.kind === 'response' && entry.label.trim()) {
      return entry;
    }
  }

  return undefined;
}

function hasBlockingActivityAfterResponse(
  activities: AgentActivity[],
  responseId: string,
): boolean {
  const responseIndex = activities.findIndex((entry) => entry.id === responseId);

  if (responseIndex < 0) {
    return false;
  }

  for (let index = responseIndex + 1; index < activities.length; index += 1) {
    const entry = activities[index];

    if (!entry) {
      continue;
    }

    if (entry.kind === 'live_status') {
      continue;
    }

    if (entry.kind === 'thought' && !entry.label.trim()) {
      continue;
    }

    if (entry.kind === 'status' && !entry.label.trim()) {
      continue;
    }

    return true;
  }

  return false;
}

function extractAssistantImageMarkdownBlocks(label: string): string[] {
  return (
    label.match(
      /!\[[^\]]*\]\((?:data:image\/[^)\s]+|https?:\/\/[^)\s]+|file:\/\/[^)\s]+|nexus-file:\/\/[^)\s]+|\/[^)\s]+\.(?:png|jpe?g|gif|webp|bmp|svg)(?:\?[^)\s]*)?)\)/gi,
    ) ?? []
  );
}

function preserveAssistantImages(previousLabel: string, nextLabel: string): string {
  const images = extractAssistantImageMarkdownBlocks(previousLabel);
  const missing = images.filter((image) => !nextLabel.includes(image));

  if (missing.length === 0) {
    return nextLabel;
  }

  return `${nextLabel.replace(/\s+$/u, '')}\n\n${missing.join('\n\n')}\n`;
}

function appendResponseDelta(currentLabel: string, delta: string): string {
  if (!delta) {
    return currentLabel;
  }

  if (!currentLabel) {
    return delta.replace(/^\s+/u, '');
  }

  if (delta.startsWith(currentLabel)) {
    return delta;
  }

  if (currentLabel.endsWith(delta)) {
    return currentLabel;
  }

  const compactCurrent = compactResponseText(currentLabel);
  const compactDelta = compactResponseText(delta);

  if (compactDelta && compactDelta === compactCurrent) {
    return currentLabel;
  }

  const maxOverlap = Math.min(currentLabel.length, delta.length);

  for (let size = maxOverlap; size >= 1; size -= 1) {
    if (currentLabel.endsWith(delta.slice(0, size))) {
      return `${currentLabel}${delta.slice(size)}`;
    }
  }

  return `${currentLabel}${delta}`;
}

function mergeAssistantSnapshot(currentLabel: string, incoming: string): string {
  const trimmed = incoming.trim();

  if (!trimmed) {
    return currentLabel;
  }

  if (!currentLabel.trim()) {
    return trimmed;
  }

  const currentTrimmed = currentLabel.trim();

  if (trimmed === currentTrimmed) {
    return currentLabel;
  }

  const compactCurrent = compactResponseText(currentTrimmed);
  const compactIncoming = compactResponseText(trimmed);

  if (compactIncoming === compactCurrent) {
    return currentLabel;
  }

  if (trimmed.startsWith(currentTrimmed) || compactIncoming.startsWith(compactCurrent)) {
    return preserveAssistantImages(currentLabel, trimmed);
  }

  if (currentTrimmed.startsWith(trimmed) || compactCurrent.startsWith(compactIncoming)) {
    return currentLabel;
  }

  const shouldKeepExisting =
    currentTrimmed.length > trimmed.length &&
    !compactCurrent.includes(compactIncoming) &&
    !compactIncoming.includes(compactCurrent);

  const nextLabel = shouldKeepExisting ? currentLabel : trimmed;
  return preserveAssistantImages(currentLabel, nextLabel);
}

function resolveAssistantEventMode(
  event: Record<string, unknown>,
  sawStreamingAssistantDelta: boolean,
): 'delta' | 'snapshot' | 'ignore' {
  const hasTimestamp =
    typeof event.timestamp_ms === 'number' ||
    (typeof event.timestamp_ms === 'string' && event.timestamp_ms.trim().length > 0);
  const modelCallId = event.model_call_id;
  const hasModelCallId =
    (typeof modelCallId === 'string' && modelCallId.trim().length > 0) ||
    typeof modelCallId === 'number';

  if (hasTimestamp && !hasModelCallId) {
    return 'delta';
  }

  if (hasTimestamp && hasModelCallId) {
    return 'snapshot';
  }

  if (!hasTimestamp && sawStreamingAssistantDelta) {
    return 'ignore';
  }

  return 'snapshot';
}

function upsertResponse(
  state: AgentStreamJsonParserState,
  text: string,
  mode: 'delta' | 'snapshot' | 'final',
): void {
  if (!text || !/\S/u.test(text)) {
    return;
  }

  clearStreamJsonLiveStatus(state);
  settleThought(state);

  if (!state.responseId) {
    const lastResponse = findLastResponseActivity(state.activities);
    const compactIncoming = compactResponseText(text);
    const compactLast = lastResponse ? compactResponseText(lastResponse.label) : '';

    if (lastResponse && compactLast && compactIncoming && compactIncoming === compactLast) {
      return;
    }

    if (lastResponse && !hasBlockingActivityAfterResponse(state.activities, lastResponse.id)) {
      state.responseId = lastResponse.id;
    }
  }

  if (state.responseId) {
    const current = state.activities.find((entry) => entry.id === state.responseId);
    const currentLabel = current?.label ?? '';
    const nextLabel =
      mode === 'delta'
        ? appendResponseDelta(currentLabel, text)
        : mergeAssistantSnapshot(currentLabel, text);
    state.pendingResponseText = nextLabel;
    state.activities = state.activities.map((entry) =>
      entry.id === state.responseId
        ? { ...entry, label: nextLabel, streaming: mode === 'final' ? undefined : true }
        : entry,
    );
    return;
  }

  const initialLabel = mode === 'delta' ? text.replace(/^\s+/u, '') : text.trim();
  state.pendingResponseText = initialLabel;
  const response = createActivity('response', initialLabel, {
    streaming: mode === 'final' ? undefined : true,
  });
  state.responseId = response.id;
  state.activities = [...state.activities, response];
}

function upsertFileRead(state: AgentStreamJsonParserState, filePath: string, label?: string): void {
  const normalized = filePath.trim().toLowerCase();

  if (!normalized || state.seenReadPaths.has(normalized)) {
    return;
  }

  state.seenReadPaths.add(normalized);
  const storedPath = toStoredAgentFilePath(filePath);
  state.exploredFiles.push({ path: storedPath });
  const read = createActivity('file_read', label ?? 'Read', {
    filePath: storedPath,
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

  const storedPath = toStoredAgentFilePath(filePath);

  if (!state.editedPaths.has(normalized)) {
    state.editedPaths.add(normalized);
    state.editedFiles.push({
      path: storedPath,
      ...(additions > 0 ? { additions } : {}),
      ...(deletions > 0 ? { deletions } : {}),
    });
  } else {
    const existing = state.editedFiles.find(
      (entry) =>
        entry.path.replace(/\\/g, '/').toLowerCase() ===
        storedPath.replace(/\\/g, '/').toLowerCase(),
    );

    if (existing) {
      if (additions > 0) {
        existing.additions = (existing.additions ?? 0) + additions;
      }

      if (deletions > 0) {
        existing.deletions = (existing.deletions ?? 0) + deletions;
      }
    }
  }

  state.lineAdditions += additions;
  state.lineDeletions += deletions;
}

function upsertFileEdit(
  state: AgentStreamJsonParserState,
  filePath: string,
  additions = 0,
  deletions = 0,
): void {
  const normalized = filePath.trim().toLowerCase();

  if (!normalized) {
    return;
  }

  trackEditedFile(state, filePath, additions, deletions);
  const storedPath = toStoredAgentFilePath(filePath);
  const storedPathKey = storedPath.toLowerCase();
  const existingIndex = state.activities.findIndex(
    (entry) =>
      entry.kind === 'file_edit' &&
      (entry.filePath?.trim().toLowerCase() === normalized ||
        entry.filePath?.trim().toLowerCase() === storedPathKey),
  );

  if (existingIndex >= 0) {
    const existing = state.activities[existingIndex]!;
    const nextAdditions = (existing.additions ?? 0) + additions;
    const nextDeletions = (existing.deletions ?? 0) + deletions;

    state.activities = [
      ...state.activities.slice(0, existingIndex),
      {
        ...existing,
        filePath: storedPath,
        label: `Edited ${basenamePath(filePath)}`,
        additions: nextAdditions > 0 ? nextAdditions : undefined,
        deletions: nextDeletions > 0 ? nextDeletions : undefined,
      },
      ...state.activities.slice(existingIndex + 1),
    ];
    return;
  }

  state.activities = [
    ...state.activities,
    createActivity('file_edit', 'Edited', {
      filePath: storedPath,
      label: `Edited ${basenamePath(filePath)}`,
      additions: additions > 0 ? additions : undefined,
      deletions: deletions > 0 ? deletions : undefined,
    }),
  ];
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

function normalizeQuestionOption(raw: unknown): AgentQuestionOption | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const option = raw as Record<string, unknown>;
  const id = typeof option.id === 'string' ? option.id.trim() : '';
  const label = typeof option.label === 'string' ? option.label.trim() : '';

  if (!id || !label) {
    return null;
  }

  return { id, label };
}

function normalizeQuestionItem(raw: unknown): AgentQuestionItem | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const item = raw as Record<string, unknown>;
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';

  if (!id || !prompt) {
    return null;
  }

  const allowMultiple =
    item.allowMultiple === true ||
    item.allow_multiple === true ||
    item.allowMultiple === 'true' ||
    item.allow_multiple === 'true';

  const rawOptions = Array.isArray(item.options) ? item.options : [];
  const options = rawOptions
    .map((entry) => normalizeQuestionOption(entry))
    .filter((entry): entry is AgentQuestionOption => Boolean(entry));

  return {
    id,
    prompt,
    ...(allowMultiple ? { allowMultiple: true } : {}),
    ...(options.length > 0 ? { options: ensureOtherOption(options) } : {}),
  };
}

function extractAskQuestionArgs(toolCall: Record<string, unknown>): {
  title?: string;
  questions: AgentQuestionItem[];
} | null {
  const askQuestionToolCall = toolCall.askQuestionToolCall as Record<string, unknown> | undefined;
  const askQuestion = toolCall.askQuestion as Record<string, unknown> | undefined;
  const payload = askQuestionToolCall ?? askQuestion;

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const args = (payload.args ?? payload) as Record<string, unknown>;
  const title = typeof args.title === 'string' ? args.title.trim() : undefined;
  const rawQuestions = Array.isArray(args.questions) ? args.questions : [];
  const questions = rawQuestions
    .map((entry) => normalizeQuestionItem(entry))
    .filter((entry): entry is AgentQuestionItem => Boolean(entry));

  if (questions.length === 0) {
    return null;
  }

  return {
    ...(title ? { title } : {}),
    questions,
  };
}

function upsertQuestionActivity(
  state: AgentStreamJsonParserState,
  payload: { title?: string; questions: AgentQuestionItem[] },
): void {
  settleThought(state);
  state.pendingQuestion = true;

  const label = payload.title?.trim() || payload.questions[0]?.prompt.trim() || 'Pergunta';

  if (state.questionActivityId) {
    state.activities = state.activities.map((entry) =>
      entry.id === state.questionActivityId
        ? {
            ...entry,
            label,
            questionTitle: payload.title,
            questions: payload.questions,
            questionStatus: 'pending',
          }
        : entry,
    );
    return;
  }

  const question = createActivity('question', label, {
    questionTitle: payload.title,
    questions: payload.questions,
    questionStatus: 'pending',
  });

  state.questionActivityId = question.id;
  state.activities = [...state.activities.filter((entry) => entry.kind !== 'question'), question];
}

function readPlanStringField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function extractCreatePlanArgs(toolCall: Record<string, unknown>): {
  planName?: string;
  planOverview?: string;
  planBody: string;
  planTodos: AgentPlanTodo[];
  planUri?: string;
} | null {
  const createPlanToolCall = toolCall.createPlanToolCall as Record<string, unknown> | undefined;
  const createPlan = toolCall.createPlan as Record<string, unknown> | undefined;
  const payload = createPlanToolCall ?? createPlan;

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const args = (payload.args ?? payload) as Record<string, unknown>;
  const planName = readPlanStringField(args, ['name', 'title']) || undefined;
  const planOverview = readPlanStringField(args, ['overview', 'description']) || undefined;
  const rawPlan = args.plan;
  const planBody =
    typeof rawPlan === 'string'
      ? rawPlan.trim()
      : Array.isArray(rawPlan)
        ? rawPlan
            .map((entry) => String(entry))
            .join('\n')
            .trim()
        : '';
  let planTodos = normalizePlanTodos(args.todos);

  if (planTodos.length === 0 && planBody) {
    planTodos = parsePlanTodosFromMarkdown(planBody);
  }

  const result = payload.result as Record<string, unknown> | undefined;
  const success = result?.success as Record<string, unknown> | undefined;
  const planUri =
    readPlanStringField(result ?? {}, ['planUri', 'plan_uri']) ||
    readPlanStringField(success ?? {}, ['planUri', 'plan_uri']) ||
    undefined;

  if (!planBody && !planOverview && !planName && !planUri) {
    return null;
  }

  return {
    ...(planName ? { planName } : {}),
    ...(planOverview ? { planOverview } : {}),
    planBody,
    planTodos,
    ...(planUri ? { planUri } : {}),
  };
}

function upsertPlanActivity(
  state: AgentStreamJsonParserState,
  payload: {
    planName?: string;
    planOverview?: string;
    planBody: string;
    planTodos: AgentPlanTodo[];
    planUri?: string;
  },
): void {
  settleThought(state);
  state.pendingPlan = true;

  const label = payload.planName?.trim() || payload.planOverview?.trim() || 'Plano';

  if (state.planActivityId) {
    state.activities = state.activities.map((entry) =>
      entry.id === state.planActivityId
        ? {
            ...entry,
            label,
            planName: payload.planName,
            planOverview: payload.planOverview,
            planBody: payload.planBody,
            planTodos: payload.planTodos,
            planUri: payload.planUri,
            planStatus: 'pending',
          }
        : entry,
    );
    return;
  }

  const plan = createActivity('plan', label, {
    planName: payload.planName,
    planOverview: payload.planOverview,
    planBody: payload.planBody,
    planTodos: payload.planTodos,
    planUri: payload.planUri,
    planStatus: 'pending',
  });

  state.planActivityId = plan.id;
  state.activities = [...state.activities.filter((entry) => entry.kind !== 'plan'), plan];
}

function isPendingInteractionActivity(entry: AgentActivity): boolean {
  if (entry.kind === 'question') {
    return entry.questionStatus === 'pending' && Boolean(entry.questions?.length);
  }

  if (entry.kind === 'plan') {
    return (
      entry.planStatus === 'pending' &&
      Boolean(
        entry.planBody?.trim() ||
        entry.planOverview?.trim() ||
        entry.planName?.trim() ||
        entry.planUri?.trim(),
      )
    );
  }

  return false;
}

function mergeInteractionActivitiesFromTurn(
  activities: AgentActivity[],
  turn: AgentTurn,
): AgentActivity[] {
  const merged = [...activities];
  const seenIds = new Set(merged.map((entry) => entry.id));

  for (const entry of turn.activities) {
    if (seenIds.has(entry.id) || !isPendingInteractionActivity(entry)) {
      continue;
    }

    merged.push({ ...entry });
    seenIds.add(entry.id);
  }

  return merged;
}

function mergeStatusActivitiesFromTurn(
  activities: AgentActivity[],
  turn: AgentTurn,
): AgentActivity[] {
  const merged = [...activities];
  const seenIds = new Set(merged.map((entry) => entry.id));

  for (const entry of turn.activities) {
    if (entry.kind !== 'status' || !entry.label.trim() || seenIds.has(entry.id)) {
      continue;
    }

    merged.push({ ...entry });
    seenIds.add(entry.id);
  }

  return merged;
}

function hasStreamJsonStateContent(state: AgentStreamJsonParserState): boolean {
  if (state.pendingResponseText.trim()) {
    return true;
  }

  return state.activities.some(
    (entry) =>
      (entry.kind === 'thought' && Boolean(entry.label.trim())) ||
      entry.kind === 'response' ||
      entry.kind === 'file_edit' ||
      entry.kind === 'file_read' ||
      entry.kind === 'question' ||
      entry.kind === 'plan' ||
      entry.kind === 'status' ||
      (entry.kind === 'tool_run' && Boolean(entry.label.trim() || entry.toolCommand?.trim())),
  );
}

export function hasMeaningfulStreamJsonTurnOutput(state: AgentStreamJsonParserState): boolean {
  if (state.pendingResponseText.trim()) {
    return true;
  }

  return state.activities.some(
    (entry) =>
      (entry.kind === 'response' && entry.label.trim().length > 0) ||
      entry.kind === 'file_edit' ||
      (entry.kind === 'question' && entry.questionStatus === 'pending') ||
      (entry.kind === 'plan' && entry.planStatus === 'pending'),
  );
}

export function hasPendingStreamJsonInteraction(
  state: AgentStreamJsonParserState,
  activities: AgentActivity[] = state.activities,
): boolean {
  if (state.pendingQuestion || state.pendingPlan) {
    return true;
  }

  return activities.some((entry) => isPendingInteractionActivity(entry));
}

function isRenderableStreamJsonActivity(entry: AgentActivity): boolean {
  if (entry.kind === 'question') {
    return Boolean(entry.questions && entry.questions.length > 0);
  }

  if (entry.kind === 'plan') {
    return Boolean(
      entry.planBody?.trim() ||
      entry.planOverview?.trim() ||
      entry.planName?.trim() ||
      entry.planUri?.trim(),
    );
  }

  if (entry.kind === 'response') {
    const sanitized = sanitizeResponseText(entry.label).trim();
    return sanitized.length > 0 || entry.label.trim().length > 0;
  }

  if (entry.kind === 'thought') {
    return Boolean(entry.label.trim()) || Boolean(entry.durationMs);
  }

  if (entry.kind === 'file_edit') {
    return Boolean(entry.filePath?.trim());
  }

  if (entry.kind === 'file_read') {
    return Boolean(entry.filePath?.trim());
  }

  if (entry.kind === 'tool_run') {
    return Boolean(entry.label.trim() || entry.toolCommand?.trim());
  }

  if (entry.kind === 'status') {
    return Boolean(entry.label.trim());
  }

  return false;
}

export function hasPendingAgentPlanFromActivities(activities: AgentActivity[]): boolean {
  return activities.some((entry) => entry.kind === 'plan' && entry.planStatus === 'pending');
}

export function hasPendingAgentQuestionFromActivities(activities: AgentActivity[]): boolean {
  return activities.some(
    (entry) => entry.kind === 'question' && entry.questionStatus === 'pending',
  );
}

function trackFileMutationToolCall(
  state: AgentStreamJsonParserState,
  toolCall:
    | {
        args?: { path?: string };
        result?: { success?: { path?: string; linesAdded?: number; linesRemoved?: number } };
      }
    | undefined,
  fallbackDeletions = 0,
): void {
  if (!toolCall?.result?.success) {
    return;
  }

  const success = toolCall.result.success;
  const path = success.path ?? toolCall.args?.path ?? '';

  upsertFileEdit(state, path, success.linesAdded ?? 0, success.linesRemoved ?? fallbackDeletions);
  completeToolRun(state);
}

function handleToolCallCompleted(state: AgentStreamJsonParserState, toolCall: unknown): void {
  if (!toolCall || typeof toolCall !== 'object') {
    return;
  }

  const payload = toolCall as Record<string, unknown>;
  const askQuestionPayload = extractAskQuestionArgs(payload);

  if (askQuestionPayload) {
    upsertQuestionActivity(state, askQuestionPayload);
    return;
  }

  const createPlanPayload = extractCreatePlanArgs(payload);

  if (createPlanPayload) {
    if (createPlanPayload.planUri || createPlanPayload.planBody || createPlanPayload.planOverview) {
      upsertPlanActivity(state, createPlanPayload);
    }

    return;
  }

  const editToolCall = payload.editToolCall as
    | {
        args?: { path?: string };
        result?: { success?: { path?: string; linesAdded?: number; linesRemoved?: number } };
      }
    | undefined;

  if (editToolCall?.result?.success) {
    trackFileMutationToolCall(state, editToolCall);
    return;
  }

  const writeToolCall = payload.writeToolCall as
    | {
        args?: { path?: string };
        result?: { success?: { path?: string; linesAdded?: number; linesRemoved?: number } };
      }
    | undefined;

  if (writeToolCall?.result?.success) {
    trackFileMutationToolCall(state, writeToolCall);
    return;
  }

  const applyAgentDiffToolCall = payload.applyAgentDiffToolCall as
    | {
        args?: { path?: string };
        result?: { success?: { path?: string; linesAdded?: number; linesRemoved?: number } };
      }
    | undefined;

  if (applyAgentDiffToolCall?.result?.success) {
    trackFileMutationToolCall(state, applyAgentDiffToolCall);
    return;
  }

  const deleteToolCall = payload.deleteToolCall as
    | {
        args?: { path?: string };
        result?: { success?: { path?: string; linesAdded?: number; linesRemoved?: number } };
      }
    | undefined;

  if (deleteToolCall?.result?.success) {
    trackFileMutationToolCall(state, deleteToolCall, 1);
    return;
  }

  const readToolCall = payload.readToolCall as { args?: { path?: string } } | undefined;

  if (readToolCall) {
    completeToolRun(state);
    return;
  }

  const globToolCall = payload.globToolCall as { args?: { globPattern?: string } } | undefined;

  if (globToolCall) {
    completeToolRun(state);
    return;
  }

  const grepToolCall = payload.grepToolCall as { args?: { pattern?: string } } | undefined;

  if (grepToolCall) {
    completeToolRun(state);
    return;
  }

  const shellToolCall = payload.shellToolCall as
    | {
        args?: { command?: string };
        result?: unknown;
      }
    | undefined;

  if (shellToolCall?.args?.command) {
    const command = shellToolCall.args.command.trim();
    state.shellToolEvents.push({
      type: 'completed',
      command,
      output: extractShellToolOutput(shellToolCall.result),
      exitCode: extractShellToolExitCode(shellToolCall.result),
    });
    completeToolRun(state, {
      label: 'Run',
      toolCommand: command,
      toolOutput: extractShellToolOutput(shellToolCall.result),
      toolExitCode: extractShellToolExitCode(shellToolCall.result),
    });
    return;
  }

  const taskToolCall = payload.taskToolCall as
    | {
        args?: {
          description?: string;
          prompt?: string;
          subagentType?: string;
          agentId?: string;
        };
        result?: {
          success?: {
            durationMs?: number | string;
            isBackground?: boolean;
            agentId?: string;
          };
          error?: { error?: string };
        };
      }
    | undefined;

  if (taskToolCall) {
    completeTaskActivity(state, taskToolCall);
    return;
  }

  if (payload.mcpToolCall || payload.shellToolCall) {
    completeToolRun(state, { label: 'Ran tool' });
  }
}

function trackShellCommand(state: AgentStreamJsonParserState, command: string): void {
  const normalized = command.replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return;
  }

  state.shellCommands.push({ command: normalized });
  state.shellCommandCount = state.shellCommands.length;
}

function startToolRun(
  state: AgentStreamJsonParserState,
  label: string,
  extra: Partial<AgentActivity> = {},
): void {
  const trimmed = label.trim();

  if (!trimmed) {
    return;
  }

  clearStreamJsonLiveStatus(state);

  const activity = createActivity('tool_run', trimmed, {
    streaming: true,
    ...extra,
  });

  state.activities = [...state.activities, activity];
  state.runningToolRunStack.push(activity.id);
}

function completeToolRun(
  state: AgentStreamJsonParserState,
  extra: Partial<AgentActivity> = {},
): void {
  const id = state.runningToolRunStack.pop();

  if (!id) {
    return;
  }

  state.activities = state.activities.map((entry) =>
    entry.id === id
      ? {
          ...entry,
          streaming: undefined,
          ...extra,
        }
      : entry,
  );
}

function resolveTaskSummary(prompt: string | undefined): string | undefined {
  if (!prompt?.trim()) {
    return undefined;
  }

  const firstLine = prompt
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return undefined;
  }

  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
}

function startTaskActivity(
  state: AgentStreamJsonParserState,
  args: {
    description?: string;
    prompt?: string;
    subagentType?: string;
    agentId?: string;
  },
): void {
  clearStreamJsonLiveStatus(state);

  const description = args.description?.trim() || 'Subagent task';
  const prompt = args.prompt?.trim() || '';
  const activity = createActivity('task', description, {
    streaming: true,
    taskPrompt: prompt || undefined,
    taskSubagentType: args.subagentType?.trim() || undefined,
    taskAgentId: args.agentId?.trim() || undefined,
    taskSummary: resolveTaskSummary(prompt),
  });

  state.activities = [...state.activities, activity];
  state.runningTaskStack.push(activity.id);
}

function completeTaskActivity(
  state: AgentStreamJsonParserState,
  toolCall: {
    args?: {
      description?: string;
      prompt?: string;
      subagentType?: string;
      agentId?: string;
    };
    result?: {
      success?: {
        durationMs?: number | string;
        isBackground?: boolean;
        agentId?: string;
      };
      error?: { error?: string };
    };
  },
): void {
  const id = state.runningTaskStack.pop();
  const args = toolCall.args;
  const success = toolCall.result?.success;
  const durationRaw = success?.durationMs;
  const durationMs =
    typeof durationRaw === 'number'
      ? durationRaw
      : typeof durationRaw === 'string'
        ? Number(durationRaw)
        : undefined;
  const prompt = args?.prompt?.trim() || '';
  const description = args?.description?.trim();
  const agentId = success?.agentId?.trim() || args?.agentId?.trim();

  if (!id) {
    if (!description && !prompt) {
      return;
    }

    state.activities = [
      ...state.activities,
      createActivity('task', description || 'Subagent task', {
        taskPrompt: prompt || undefined,
        taskSubagentType: args?.subagentType?.trim() || undefined,
        taskAgentId: agentId || undefined,
        taskSummary: resolveTaskSummary(prompt),
        durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
      }),
    ];
    return;
  }

  state.activities = state.activities.map((entry) =>
    entry.id === id
      ? {
          ...entry,
          streaming: undefined,
          label: description || entry.label,
          taskPrompt: prompt || entry.taskPrompt,
          taskSubagentType: args?.subagentType?.trim() || entry.taskSubagentType,
          taskAgentId: agentId || entry.taskAgentId,
          taskSummary: resolveTaskSummary(prompt) || entry.taskSummary,
          durationMs: Number.isFinite(durationMs) ? durationMs : entry.durationMs,
        }
      : entry,
  );
}

function handleToolCallStarted(state: AgentStreamJsonParserState, toolCall: unknown): void {
  captureResponseLeadBeforeTools(state);
  sealActiveResponseSegment(state);
  settleThought(state);

  if (!toolCall || typeof toolCall !== 'object') {
    return;
  }

  const payload = toolCall as Record<string, unknown>;
  const askQuestionPayload = extractAskQuestionArgs(payload);

  if (askQuestionPayload) {
    upsertQuestionActivity(state, askQuestionPayload);
    return;
  }

  const createPlanPayload = extractCreatePlanArgs(payload);

  if (createPlanPayload) {
    upsertPlanActivity(state, createPlanPayload);
    return;
  }

  const readToolCall = payload.readToolCall as { args?: { path?: string } } | undefined;

  if (readToolCall?.args?.path) {
    startToolRun(state, `Reading ${basenamePath(readToolCall.args.path)}`, {
      filePath: readToolCall.args.path,
    });
    upsertFileRead(state, readToolCall.args.path);
    return;
  }

  const editToolCall = payload.editToolCall as { args?: { path?: string } } | undefined;

  if (editToolCall?.args?.path) {
    startToolRun(state, `Editing ${basenamePath(editToolCall.args.path)}`, {
      filePath: editToolCall.args.path,
    });
    return;
  }

  const writeToolCall = payload.writeToolCall as { args?: { path?: string } } | undefined;

  if (writeToolCall?.args?.path) {
    startToolRun(state, `Writing ${basenamePath(writeToolCall.args.path)}`, {
      filePath: writeToolCall.args.path,
    });
    return;
  }

  const shellToolCall = payload.shellToolCall as { args?: { command?: string } } | undefined;

  if (shellToolCall?.args?.command) {
    const command = shellToolCall.args.command.trim();
    trackShellCommand(state, command);
    state.shellToolEvents.push({
      type: 'started',
      command,
      output: '',
      exitCode: null,
    });
    startToolRun(state, 'Running', {
      toolCommand: command,
    });
    return;
  }

  const globToolCall = payload.globToolCall as
    { args?: { globPattern?: string; targetDirectory?: string } } | undefined;

  if (globToolCall?.args) {
    const pattern = globToolCall.args.globPattern?.trim() || '**/*';
    const directory = globToolCall.args.targetDirectory?.trim();
    const label = directory ? `Glob ${pattern} in ${basenamePath(directory)}` : `Glob ${pattern}`;
    startToolRun(state, label);
    upsertFileRead(state, directory ?? pattern, label);
    return;
  }

  const grepToolCall = payload.grepToolCall as
    { args?: { pattern?: string; path?: string } } | undefined;

  if (grepToolCall?.args?.pattern) {
    const pattern = grepToolCall.args.pattern.trim();
    const path = grepToolCall.args.path?.trim();
    const label = path ? `Grep ${pattern} in ${basenamePath(path)}` : `Grep ${pattern}`;
    startToolRun(state, label);
    upsertFileRead(state, path ?? pattern, label);
    return;
  }

  const taskToolCall = payload.taskToolCall as
    | {
        args?: {
          description?: string;
          prompt?: string;
          subagentType?: string;
          agentId?: string;
        };
      }
    | undefined;

  if (taskToolCall?.args) {
    startTaskActivity(state, taskToolCall.args);
    return;
  }

  if (payload.mcpToolCall) {
    startToolRun(state, 'Running tool');
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

function extractOpenCodePart(event: Record<string, unknown>): Record<string, unknown> | null {
  const part = event.part;

  if (!part || typeof part !== 'object') {
    return null;
  }

  return part as Record<string, unknown>;
}

function handleOpenCodeToolUse(state: AgentStreamJsonParserState, part: Record<string, unknown>): void {
  captureResponseLeadBeforeTools(state);
  sealActiveResponseSegment(state);
  settleThought(state);

  const tool = typeof part.tool === 'string' ? part.tool.toLowerCase() : '';
  const toolState = part.state as Record<string, unknown> | undefined;
  const status = typeof toolState?.status === 'string' ? toolState.status : '';

  if (status !== 'completed' && status !== 'error') {
    return;
  }

  const input = toolState?.input as Record<string, unknown> | undefined;

  if (tool === 'bash') {
    const command = typeof input?.command === 'string' ? input.command.trim() : '';

    if (command) {
      trackShellCommand(state, command);
      state.shellToolEvents.push({
        type: 'started',
        command,
        output: '',
        exitCode: null,
      });
      startToolRun(state, 'Running', { toolCommand: command });
      completeToolRun(state, { label: 'Ran command' });
    }

    return;
  }

  if (tool === 'read') {
    const filePath =
      typeof input?.path === 'string'
        ? input.path
        : typeof input?.filePath === 'string'
          ? input.filePath
          : '';

    if (filePath) {
      startToolRun(state, `Reading ${basenamePath(filePath)}`, { filePath });
      upsertFileRead(state, filePath);
      completeToolRun(state);
    }

    return;
  }

  if (tool === 'write' || tool === 'edit') {
    const filePath =
      typeof input?.path === 'string'
        ? input.path
        : typeof input?.filePath === 'string'
          ? input.filePath
          : '';

    if (filePath) {
      const label =
        tool === 'write'
          ? `Writing ${basenamePath(filePath)}`
          : `Editing ${basenamePath(filePath)}`;
      startToolRun(state, label, { filePath });
      completeToolRun(state);
    }

    return;
  }

  if (tool === 'glob') {
    const pattern = typeof input?.pattern === 'string' ? input.pattern.trim() : '**/*';
    const directory = typeof input?.path === 'string' ? input.path.trim() : '';
    const label = directory ? `Glob ${pattern} in ${basenamePath(directory)}` : `Glob ${pattern}`;
    startToolRun(state, label);
    upsertFileRead(state, directory || pattern, label);
    completeToolRun(state);
    return;
  }

  if (tool === 'grep') {
    const pattern = typeof input?.pattern === 'string' ? input.pattern.trim() : '';
    const filePath = typeof input?.path === 'string' ? input.path.trim() : '';
    const label = filePath ? `Grep ${pattern} in ${basenamePath(filePath)}` : `Grep ${pattern}`;
    startToolRun(state, label);
    upsertFileRead(state, filePath || pattern, label);
    completeToolRun(state);
    return;
  }

  if (tool === 'task') {
    const description =
      typeof input?.description === 'string' ? input.description : 'Subagent task';
    const prompt = typeof input?.prompt === 'string' ? input.prompt : '';
    startTaskActivity(state, {
      description,
      prompt,
      subagentType: typeof input?.subagentType === 'string' ? input.subagentType : undefined,
      agentId: typeof input?.agentId === 'string' ? input.agentId : undefined,
    });
    completeTaskActivity(state, {
      args: {
        description,
        prompt,
        subagentType: typeof input?.subagentType === 'string' ? input.subagentType : undefined,
        agentId: typeof input?.agentId === 'string' ? input.agentId : undefined,
      },
    });
    return;
  }

  const title = typeof toolState?.title === 'string' ? toolState.title.trim() : '';
  startToolRun(state, title || `Running ${tool || 'tool'}`);
  completeToolRun(state);
}

function maybeFinalizeOpenCodeStep(state: AgentStreamJsonParserState): void {
  const hasLiveDevShell = state.activities.some(
    (entry) =>
      entry.kind === 'tool_run' &&
      Boolean(entry.streaming) &&
      shouldOpenAgentShellToolTerminal(entry.toolCommand ?? ''),
  );

  if (
    !hasLiveDevShell &&
    !hasPendingStreamJsonInteraction(state) &&
    hasMeaningfulStreamJsonTurnOutput(state)
  ) {
    forceSettleStreamJsonInFlightWork(state);
    state.shouldFinalize = true;
  }
}

function handleStreamJsonEvent(
  state: AgentStreamJsonParserState,
  event: Record<string, unknown>,
): void {
  const type = typeof event.type === 'string' ? event.type : '';

  if (type === 'system' && event.subtype === 'init') {
    const sessionId = extractSessionId(event);

    if (sessionId) {
      state.sessionId = sessionId;
    }

    return;
  }

  if (type === 'thinking' || type === 'reasoning') {
    const openCodePart = extractOpenCodePart(event);
    const openCodeText = typeof openCodePart?.text === 'string' ? openCodePart.text : '';

    if (openCodeText) {
      upsertThought(state, openCodeText);
      return;
    }

    if (event.subtype === 'completed' || event.subtype === 'end') {
      settleThought(state);
      return;
    }

    const thinkingText = extractThinkingDelta(event);

    if (thinkingText) {
      upsertThought(state, thinkingText);
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
    const thinkingText = extractThinkingFromMessage(event.message);

    if (thinkingText) {
      upsertThought(state, thinkingText);
    }

    const mode = resolveAssistantEventMode(event, state.sawStreamingAssistantDelta);

    if (mode === 'ignore') {
      return;
    }

    const text = extractAssistantText(event.message);

    if (!text) {
      return;
    }

    if (mode === 'delta') {
      state.sawStreamingAssistantDelta = true;
    }

    upsertResponse(state, text, mode);
    return;
  }

  if (type === 'result') {
    const resultSessionId = extractSessionId(event);

    if (resultSessionId) {
      state.sessionId = resultSessionId;
    }

    const usage = parseUsage(event.usage);

    if (usage) {
      state.pendingUsage = usage;
    }

    const resultText =
      typeof event.result === 'string' ? event.result.trim() : state.pendingResponseText.trim();

    if (resultText && !isAggregatedPriorResponseText(resultText, state.activities)) {
      upsertResponse(state, resultText, 'final');
    }

    const hasLiveDevShell = state.activities.some(
      (entry) =>
        entry.kind === 'tool_run' &&
        Boolean(entry.streaming) &&
        shouldOpenAgentShellToolTerminal(entry.toolCommand ?? ''),
    );

    if (
      !hasLiveDevShell &&
      !hasPendingStreamJsonInteraction(state) &&
      (hasMeaningfulStreamJsonTurnOutput(state) || Boolean(resultText))
    ) {
      forceSettleStreamJsonInFlightWork(state);
      state.shouldFinalize = true;
      // #region agent log
      writeDebugSessionLog({
        location: 'agentStreamJsonParser.ts:result',
        message: 'shouldFinalize set from result',
        data: {
          subtype: event.subtype,
          resultTextLength: resultText.length,
          activityKinds: state.activities.map((entry) => entry.kind),
          hasPendingResponse: Boolean(state.pendingResponseText.trim()),
        },
        hypothesisId: 'B',
      });
      // #endregion
    }

    return;
  }

  if (type === 'step_start') {
    const sessionId = extractSessionId(event);

    if (sessionId) {
      state.sessionId = sessionId;
    }

    return;
  }

  if (type === 'tool_use') {
    const part = extractOpenCodePart(event);

    if (part) {
      handleOpenCodeToolUse(state, part);
    }

    return;
  }

  if (type === 'text') {
    const part = extractOpenCodePart(event);
    const text = typeof part?.text === 'string' ? part.text.trim() : '';

    if (text) {
      upsertResponse(state, text, 'final');
    }

    const sessionId = extractSessionId(event);

    if (sessionId) {
      state.sessionId = sessionId;
    }

    return;
  }

  if (type === 'step_finish') {
    const part = extractOpenCodePart(event);
    const reason = typeof part?.reason === 'string' ? part.reason : '';

    if (reason === 'stop') {
      maybeFinalizeOpenCodeStep(state);
    }

    return;
  }

  if (type === 'error') {
    const errorPayload = event.error as Record<string, unknown> | undefined;
    const errorData = errorPayload?.data as Record<string, unknown> | undefined;
    const message =
      typeof errorData?.message === 'string'
        ? errorData.message
        : typeof errorPayload?.message === 'string'
          ? errorPayload.message
          : 'Erro no agent.';

    upsertResponse(state, message, 'final');
    forceSettleStreamJsonInFlightWork(state);
    state.shouldFinalize = true;
    return;
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

export function upsertStreamJsonLiveStatus(
  state: AgentStreamJsonParserState,
  label: string,
): boolean {
  const trimmed = label.trim();

  if (!trimmed) {
    return false;
  }

  const existing = state.activities.find((entry) => entry.kind === 'live_status');

  if (existing?.label === trimmed) {
    return false;
  }

  if (existing) {
    state.activities = state.activities.map((entry) =>
      entry.id === existing.id ? { ...entry, label: trimmed } : entry,
    );
    return true;
  }

  state.activities = [
    ...state.activities.filter((entry) => entry.kind !== 'live_status'),
    createActivity('live_status', trimmed),
  ];
  return true;
}

export function clearStreamJsonLiveStatus(state: AgentStreamJsonParserState): boolean {
  if (!state.activities.some((entry) => entry.kind === 'live_status')) {
    return false;
  }

  state.activities = state.activities.filter((entry) => entry.kind !== 'live_status');
  return true;
}

export function ensureStreamJsonStallProgressUi(state: AgentStreamJsonParserState): boolean {
  if (hasActiveStreamJsonToolOrTask(state)) {
    let changed = clearStreamJsonLiveStatus(state);

    if (ensureTrailingStreamingThought(state)) {
      changed = true;
    }

    return changed;
  }

  let changed = false;

  if (state.responseId) {
    sealActiveResponseSegment(state);
    changed = true;
  }

  if (hasStreamingThoughtContent(state) || findStreamingThoughtActivity(state)?.streaming) {
    if (clearStreamJsonLiveStatus(state)) {
      changed = true;
    }

    return changed;
  }

  if (state.shouldFinalize) {
    if (clearStreamJsonLiveStatus(state)) {
      changed = true;
    }

    return changed;
  }

  if (ensureRunningProgressPlaceholder(state)) {
    changed = true;
  }

  return changed;
}

export function resolveStreamJsonStallLiveStatus(
  state: AgentStreamJsonParserState,
  idleMs: number,
): string | null {
  if (state.shouldFinalize) {
    return null;
  }

  if (hasStreamingThoughtContent(state)) {
    return null;
  }

  if (findStreamingThoughtActivity(state)?.streaming) {
    return null;
  }

  if (hasActiveStreamJsonToolOrTask(state)) {
    return null;
  }

  const idleSeconds = Math.max(1, Math.round(idleMs / 1000));
  const hasStreamingResponse =
    Boolean(state.responseId) ||
    state.activities.some((entry) => entry.kind === 'response' && Boolean(entry.streaming));

  if (hasStreamingResponse) {
    if (idleMs < 30_000) {
      return null;
    }

    return `Agent executando… (${idleSeconds}s)`;
  }

  if (idleMs >= 30_000) {
    return `Aguardando resposta do agent… (${idleSeconds}s)`;
  }

  return 'Planning next moves...';
}

export function forceSettleStreamJsonInFlightWork(state: AgentStreamJsonParserState): void {
  while (state.runningToolRunStack.length > 0) {
    completeToolRun(state);
  }

  while (state.runningTaskStack.length > 0) {
    const id = state.runningTaskStack.pop();

    if (!id) {
      continue;
    }

    state.activities = state.activities.map((entry) =>
      entry.id === id ? { ...entry, streaming: undefined } : entry,
    );
  }

  settleThought(state);
  sealActiveResponseSegment(state);
  state.activities = state.activities.filter((entry) => entry.kind !== 'live_status');
}

export function feedAgentStreamJsonChunk(
  state: AgentStreamJsonParserState,
  chunk: string,
): StreamJsonTurnUpdate {
  const previousFinalize = state.shouldFinalize;
  const previousActivityCount = state.activities.length;
  const previousResponseText = state.pendingResponseText;
  const previousActivitySignature = getStreamActivitySignature(state.activities);

  state.jsonBuffer += chunk;
  consumeJsonObjects(state);
  pruneEmptyThoughtPlaceholders(state);

  if (!state.shouldFinalize) {
    ensureRunningProgressPlaceholder(state);
  }

  const nextActivitySignature = getStreamActivitySignature(state.activities);
  const hasUpdate =
    state.activities.length !== previousActivityCount ||
    state.pendingResponseText !== previousResponseText ||
    nextActivitySignature !== previousActivitySignature;
  const shouldFinalize = state.shouldFinalize && !previousFinalize;
  const shellToolEvents = [...state.shellToolEvents];
  state.shellToolEvents = [];

  return {
    hasUpdate,
    shouldFinalize,
    sessionId: state.sessionId,
    responseText: state.pendingResponseText || null,
    usage: state.pendingUsage,
    shellToolEvents,
  };
}

export function isAgentStreamJsonStateAwaitingCompletion(
  state: AgentStreamJsonParserState,
): boolean {
  if (state.shouldFinalize) {
    return false;
  }

  if (hasPendingStreamJsonInteraction(state)) {
    return true;
  }

  if (state.runningToolRunStack.length > 0 || state.runningTaskStack.length > 0) {
    return true;
  }

  if (state.responseId) {
    return true;
  }

  if (findStreamingThoughtActivity(state)?.streaming) {
    return true;
  }

  if (hasIncompleteStreamJsonEnding(state)) {
    return true;
  }

  if (
    !hasMeaningfulStreamJsonTurnOutput(state) &&
    state.activities.some((entry) => entry.kind === 'thought')
  ) {
    return true;
  }

  return state.activities.some(
    (entry) =>
      (entry.kind === 'tool_run' ||
        entry.kind === 'task' ||
        entry.kind === 'live_status' ||
        entry.kind === 'response') &&
      Boolean(entry.streaming),
  );
}

export function tryMarkStreamJsonReadyToFinalize(state: AgentStreamJsonParserState): boolean {
  if (state.shouldFinalize) {
    return true;
  }

  if (isAgentStreamJsonStateAwaitingCompletion(state)) {
    return false;
  }

  if (hasPendingStreamJsonInteraction(state)) {
    return false;
  }

  if (state.runningToolRunStack.length > 0 || state.runningTaskStack.length > 0) {
    return false;
  }

  if (findStreamingThoughtActivity(state)?.streaming) {
    return false;
  }

  if (hasIncompleteStreamJsonEnding(state)) {
    return false;
  }

  if (
    state.activities.some(
      (entry) =>
        entry.kind === 'thought' ||
        entry.kind === 'file_read' ||
        entry.kind === 'file_edit' ||
        entry.kind === 'tool_run' ||
        entry.kind === 'task',
    ) &&
    !findLastResponseLabel(state.activities, state.pendingResponseText)
  ) {
    return false;
  }

  if (!hasMeaningfulStreamJsonTurnOutput(state)) {
    return false;
  }

  state.activities = state.activities.map((entry) => {
    if (entry.kind === 'thought' && entry.streaming) {
      return {
        ...entry,
        streaming: undefined,
        collapsed: false,
      };
    }

    if (entry.kind === 'response' && entry.streaming) {
      return {
        ...entry,
        streaming: undefined,
      };
    }

    if (
      (entry.kind === 'tool_run' || entry.kind === 'task' || entry.kind === 'live_status') &&
      entry.streaming
    ) {
      return {
        ...entry,
        streaming: undefined,
      };
    }

    return entry;
  });
  settleThought(state);
  state.shouldFinalize = true;
  return true;
}

function isTrivialAgentResponseText(text: string): boolean {
  const trimmed = text.trim();

  if (!trimmed) {
    return true;
  }

  if (trimmed.length <= 2) {
    return true;
  }

  return /^[?.!…,;:]+$/u.test(trimmed);
}

const COMPLETE_SHORT_RESPONSE_WORDS =
  /^(?:ok|sim|não|nao|yes|no|done|pronto|feito|certo|aqui|ali|hoje|ontem|agora|ainda|também|tambem|depois|antes|então|entao|assim|muito|pouco|mais|menos|bem|mal|já|ja|só|so|eu|tu|ele|ela|nós|nos|vos|eles|elas|me|te|se|lhe|lhes|um|uma|uns|umas|ao|à|o|a|os|as|de|da|do|das|dos|em|no|na|nas|nos|que|ou|e|é|com|por|sem|sob|até|ate|após|apos|entre|sobre|desde|para|pelo|pela|pelos|pelas|the|and|for|not|but|you|all|can|had|her|was|one|our|out|day|get|has|him|his|how|man|new|now|old|see|two|way|who|boy|did|its|let|put|say|she|too|use|js|ts|tsx|css|md|json|yml|yaml|sh|py|go|rs|rb|php|html|svg|png|jpg|gif|pdf|xml|env|git|src|app|web|api|cli|dev|prod|hml|mock|ios|android)$/iu;

const COMPLETE_WORD_SUFFIX =
  /(?:mente|ções|ção|dades|dade|ismos|ismo|áveis|ável|íveis|ível|ando|endo|indo|ados|adas|idos|idas|ado|ada|ido|ida|aram|eram|iram|avam|iam|ará|erá|irá|aria|eria|iria|amos|emos|imos|ally|tion|ness|ment|ings|ers|ies|ous|ful|ed|ly|ing|er|or|al|ic|ive|ize|ise|est|ous)$/iu;

function looksLikeAbruptlyCutWord(text: string): boolean {
  const trimmed = text.trim();

  if (!trimmed || /[.!?;:…)"\]}'"`]$/u.test(trimmed)) {
    return false;
  }

  if (!/[a-záàâãéêíóôõúç]$/u.test(trimmed)) {
    return false;
  }

  const lastToken =
    trimmed
      .split(/\s+/u)
      .pop()
      ?.replace(/^["'(\[{«]+/u, '') ?? '';

  if (!/^[a-záàâãéêíóôõúçA-ZÁÀÂÃÉÊÍÓÔÕÚÇ]{3,8}$/u.test(lastToken)) {
    return false;
  }

  if (COMPLETE_SHORT_RESPONSE_WORDS.test(lastToken) || COMPLETE_WORD_SUFFIX.test(lastToken)) {
    return false;
  }

  return /[a-záàâãéêíóôõúç]$/u.test(lastToken);
}

export function looksLikeTruncatedAgentResponse(text: string): boolean {
  const trimmed = text.trim();

  if (!trimmed || trimmed.length < 8) {
    return false;
  }

  const boldMarkers = trimmed.match(/\*\*/g)?.length ?? 0;

  if (boldMarkers % 2 === 1) {
    return true;
  }

  const fenceChunks = trimmed.split(/```/);
  const inlineRegion = fenceChunks.filter((_, index) => index % 2 === 0).join('');
  const inlineCodeMarkers = inlineRegion.match(/`/g)?.length ?? 0;

  if (inlineCodeMarkers % 2 === 1) {
    return true;
  }

  if (/\*\*\d{4,13}$/u.test(trimmed)) {
    return true;
  }

  if (/(?:^|\n)\s*[-*]\s+`[^`\n]+$/u.test(trimmed)) {
    return true;
  }

  if (looksLikeAbruptlyCutWord(trimmed)) {
    return true;
  }

  return false;
}

export function looksLikeLiveServerReply(text: string): boolean {
  const trimmed = text.trim();

  if (!trimmed) {
    return false;
  }

  return (
    /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i.test(trimmed) ||
    /\b(?:est[aá] no ar|no ar em|rodando em\s+https?:)/i.test(trimmed)
  );
}

export function looksLikeMidProgressAgentResponse(text: string): boolean {
  const trimmed = text.trim();

  if (!trimmed || trimmed.length < 12) {
    return false;
  }

  const tail = trimmed.slice(-320);
  const hasProgressIntent =
    /\b(vou |vamos |i'll |i will |let me |i am going to |i'm going to |next[,:]?\s|em seguida|agora vou|seguindo com|continu(?:ar|ando|e)\b)/i.test(
      tail,
    ) ||
    /\b(atualizo|atualizando|subo|subindo|fa[cç]o|fazendo|gero|gerando|verifico|verificando|testo|testando|leio|lendo|edito|editando|crio|criando|removo|removendo|adiciono|adicionando|implemento|implementando|aplico|aplicando|reinicio|reiniciando|configuro|configurando|ajusto|ajustando|valido|validando|confiro|conferindo|envio|enviando|rodo|rodando|executo|executando|abro|abrindo|fecho|fechando|monitoro|monitorando|acompanho|acompanhando|revogo|revogando|aguardo|aguardando)\b/i.test(
      tail,
    ) ||
    /\b(running|executing|checking|testing|reading|writing|updating|creating|sending|polling|waiting)\b/i.test(
      tail,
    ) ||
    /\b(em andamento|in progress|aguardando conclus[aã]o|waiting for completion|upload .+ (em andamento|in progress))\b/i.test(
      tail,
    );

  if (!hasProgressIntent) {
    return false;
  }

  const hasCompletionClose =
    /\b(pronto|conclu[ií]do|finalizado|feito|tudo certo|all set|that's all|completed|finished|done)\b[.!…]?\s*$/i.test(
      trimmed,
    );

  return !hasCompletionClose;
}

function findLastResponseLabel(activities: AgentActivity[], fallback = ''): string {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const entry = activities[index];

    if (entry?.kind === 'response' && entry.label.trim()) {
      return entry.label.trim();
    }
  }

  return fallback.trim();
}

function isAggregatedPriorResponseText(resultText: string, activities: AgentActivity[]): boolean {
  const responses = activities
    .filter((entry) => entry.kind === 'response' && entry.label.trim())
    .map((entry) => entry.label.trim());

  if (responses.length === 0) {
    return false;
  }

  const compactResult = resultText.replace(/\s+/g, '');
  const lastResponse = responses[responses.length - 1]!;
  const lastCompact = lastResponse.replace(/\s+/g, '');

  if (compactResult === lastCompact) {
    return true;
  }

  if (compactResult.length < 48) {
    return lastCompact.length >= compactResult.length && lastCompact.includes(compactResult);
  }

  if (lastCompact.includes(compactResult) && lastCompact.length >= compactResult.length) {
    return true;
  }

  if (
    compactResult.includes(lastCompact) &&
    compactResult.length > lastCompact.length &&
    (looksLikeTruncatedAgentResponse(lastResponse) ||
      lastCompact.length < 96 ||
      !compactResult.startsWith(lastCompact))
  ) {
    return false;
  }

  const compactJoined = responses.join('').replace(/\s+/g, '');

  if (
    compactJoined.length >= 48 &&
    (compactResult === compactJoined ||
      compactResult.startsWith(compactJoined) ||
      (compactJoined.startsWith(compactResult) && compactResult.length >= 48))
  ) {
    return true;
  }

  if (responses.length < 2) {
    return false;
  }

  const matched = responses.filter((entry) => {
    const compact = entry.replace(/\s+/g, '');
    return compact.length >= 24 && compactResult.includes(compact);
  }).length;

  return matched >= 2 && compactJoined.length >= Math.floor(compactResult.length * 0.8);
}

function hasIncompleteStreamJsonEnding(
  state: AgentStreamJsonParserState,
  activities: AgentActivity[] = state.activities,
): boolean {
  if (hasPendingStreamJsonInteraction(state, activities)) {
    return false;
  }

  let lastResponseIndex = -1;
  let lastThoughtIndex = -1;
  let lastProgressIndex = -1;

  for (let index = 0; index < activities.length; index += 1) {
    const entry = activities[index];

    if (!entry) {
      continue;
    }

    if (entry.kind === 'response' && entry.label.trim()) {
      lastResponseIndex = index;
      lastProgressIndex = index;
      continue;
    }

    if (entry.kind === 'question' || entry.kind === 'plan') {
      lastResponseIndex = index;
      lastProgressIndex = index;
      continue;
    }

    if (
      entry.kind === 'tool_run' ||
      entry.kind === 'file_edit' ||
      entry.kind === 'file_read' ||
      entry.kind === 'task'
    ) {
      lastProgressIndex = index;
      continue;
    }

    if (entry.kind !== 'thought' || !entry.label.trim()) {
      continue;
    }

    lastThoughtIndex = index;
  }

  if (lastThoughtIndex > lastResponseIndex) {
    return true;
  }

  if (lastProgressIndex > lastResponseIndex) {
    return true;
  }

  const lastResponseLabel = findLastResponseLabel(activities, state.pendingResponseText);

  if (
    looksLikeMidProgressAgentResponse(lastResponseLabel) ||
    looksLikeTruncatedAgentResponse(lastResponseLabel)
  ) {
    return true;
  }

  const priorResponses = activities.filter(
    (entry) =>
      entry.kind === 'response' && entry.label.trim() && entry.label.trim() !== lastResponseLabel,
  );
  const priorMidProgress = priorResponses.some((entry) =>
    looksLikeMidProgressAgentResponse(entry.label),
  );
  const lastLooksComplete =
    /\b(pronto|conclu[ií]do|finalizado|feito|tudo certo|all set|that's all|completed|finished|done)\b[.!…]?\s*$/i.test(
      lastResponseLabel,
    ) || /[.!?;:…]"?$/u.test(lastResponseLabel);

  if (!isTrivialAgentResponseText(lastResponseLabel) && priorMidProgress && !lastLooksComplete) {
    return true;
  }

  if (!isTrivialAgentResponseText(lastResponseLabel)) {
    return false;
  }

  const hadToolProgress =
    state.seenReadPaths.size > 0 ||
    state.editedPaths.size > 0 ||
    state.shellCommands.length > 0 ||
    state.shellCommandCount > 0 ||
    activities.some(
      (entry) =>
        entry.kind === 'tool_run' ||
        entry.kind === 'file_edit' ||
        entry.kind === 'file_read' ||
        entry.kind === 'task',
    );

  if (!hadToolProgress && lastProgressIndex <= lastResponseIndex) {
    return false;
  }

  return (
    Boolean(state.responseLead?.trim()) ||
    state.summaryLeadCaptured ||
    priorMidProgress ||
    priorResponses.length > 0
  );
}

export function hasIncompleteStreamJsonTurnEnding(
  state: AgentStreamJsonParserState,
  activities: AgentActivity[] = state.activities,
): boolean {
  return hasIncompleteStreamJsonEnding(state, activities);
}

function resolveIncompleteStreamJsonResponseFallback(
  state: AgentStreamJsonParserState,
  activities: AgentActivity[],
  options?: { trailingThought?: boolean },
): string {
  if (options?.trailingThought || hasIncompleteStreamJsonEnding(state, activities)) {
    return 'O agente parou durante o raciocínio sem concluir a resposta. Envie novamente para continuar.';
  }

  if (state.responseLead?.trim() || state.pendingResponseText.trim()) {
    return 'Alterações aplicadas.';
  }

  if (
    state.editedPaths.size > 0 ||
    state.shellCommands.length > 0 ||
    state.shellCommandCount > 0 ||
    activities.some((entry) => entry.kind === 'file_edit')
  ) {
    return 'Alterações aplicadas.';
  }

  return 'O agente parou antes de concluir a resposta. Envie novamente para continuar.';
}

export function buildAgentTurnSummaryFromStreamJsonState(
  state: AgentStreamJsonParserState,
): AgentTurnSummary | undefined {
  const resolvedCommandCount =
    state.shellCommands.length > 0 ? state.shellCommands.length : state.shellCommandCount;
  const summary: AgentTurnSummary = {
    editedFileCount: state.editedPaths.size,
    exploredFileCount: state.seenReadPaths.size,
    commandCount: resolvedCommandCount,
    additions: state.lineAdditions,
    deletions: state.lineDeletions,
    ...(state.responseLead ? { responseLead: state.responseLead } : {}),
    ...(state.exploredFiles.length > 0 ? { exploredFiles: [...state.exploredFiles] } : {}),
    ...(state.editedFiles.length > 0 ? { editedFiles: [...state.editedFiles] } : {}),
    ...(state.shellCommands.length > 0 ? { commands: [...state.shellCommands] } : {}),
  };

  return isAgentTurnSummaryVisible(summary) ? summary : undefined;
}

function resolveFinalResponseLabel(raw: string): string {
  const trimmed = raw.trim();

  if (!trimmed) {
    return '';
  }

  const sanitized = sanitizeResponseText(trimmed).trim();
  return sanitized || trimmed;
}

export function finalizeStreamJsonTurn(
  turn: AgentTurn,
  state: AgentStreamJsonParserState,
): AgentTurn {
  consumeJsonObjects(state);
  state.jsonBuffer = '';

  const sourceActivities = hasStreamJsonStateContent(state)
    ? state.activities
    : turn.activities.length > 0
      ? turn.activities
      : state.activities;
  const incompleteEnding =
    !state.handoffComplete && hasIncompleteStreamJsonEnding(state, sourceActivities);
  const lastSourceActivity = [...sourceActivities]
    .reverse()
    .find(
      (entry) =>
        (entry.kind === 'response' && entry.label.trim()) ||
        (entry.kind === 'thought' && entry.label.trim()) ||
        entry.kind === 'question' ||
        entry.kind === 'plan' ||
        entry.kind === 'file_edit' ||
        entry.kind === 'file_read' ||
        entry.kind === 'tool_run',
    );
  const endedDuringThought = incompleteEnding && lastSourceActivity?.kind === 'thought';

  let activities = sourceActivities
    .filter(
      (entry) =>
        entry.kind !== 'live_status' &&
        entry.kind !== 'tool_run' &&
        !(entry.kind === 'thought' && !entry.label.trim()),
    )
    .map((entry) => {
      if (entry.kind === 'thought' && entry.streaming) {
        return {
          ...entry,
          streaming: undefined,
          collapsed: false,
          durationMs:
            entry.durationMs ?? Math.max(Date.now() - (entry.createdAt || turn.startedAt), 1000),
        };
      }

      if (entry.kind === 'response') {
        const label = resolveFinalResponseLabel(entry.label);
        return { ...entry, label, streaming: undefined };
      }

      return entry;
    });

  if (!activities.some((entry) => entry.kind === 'response') && state.pendingResponseText.trim()) {
    activities = [
      ...activities.filter((entry) => entry.kind !== 'response'),
      createActivity('response', resolveFinalResponseLabel(state.pendingResponseText)),
    ];
  }

  activities = mergeInteractionActivitiesFromTurn(activities, turn);
  activities = mergeStatusActivitiesFromTurn(activities, turn);
  activities = activities.filter((entry) => isRenderableStreamJsonActivity(entry));
  activities = deduplicatePlanResponseActivities(activities);

  const summary = buildAgentTurnSummaryFromStreamJsonState(state);
  const incompleteFallback = resolveIncompleteStreamJsonResponseFallback(state, activities, {
    trailingThought: endedDuringThought,
  });
  const hasPendingInteraction =
    hasPendingStreamJsonInteraction(state, activities) ||
    turn.activities.some((entry) => isPendingInteractionActivity(entry));

  const safeLead = sanitizeResponseText(state.responseLead?.trim() ?? '').trim();
  const safeSummaryLead = sanitizeResponseText(summary?.responseLead?.trim() ?? '').trim();
  const lastResponseIndex = [...activities]
    .map((entry, index) => ({ entry, index }))
    .reverse()
    .find(({ entry }) => entry.kind === 'response')?.index;
  const lastResponseLabel =
    lastResponseIndex !== undefined ? activities[lastResponseIndex]?.label.trim() : undefined;
  const truncatedTrailingResponse =
    !hasPendingInteraction &&
    Boolean(lastResponseLabel) &&
    isTrivialAgentResponseText(lastResponseLabel ?? '') &&
    hasIncompleteStreamJsonEnding(state, activities);

  if (
    truncatedTrailingResponse &&
    lastResponseIndex !== undefined &&
    activities[lastResponseIndex]
  ) {
    activities = activities.map((entry, index) =>
      index === lastResponseIndex ? { ...entry, label: incompleteFallback } : entry,
    );
  }

  const needsTrailingIncompleteResponse =
    incompleteEnding &&
    !hasPendingInteraction &&
    !truncatedTrailingResponse &&
    lastResponseLabel !== incompleteFallback;
  const statusFallback = [...turn.activities]
    .reverse()
    .find((entry) => entry.kind === 'status' && entry.label.trim())
    ?.label.trim();

  if (activities.length === 0 && isAgentTurnSummaryVisible(summary)) {
    activities = [createActivity('response', safeLead || safeSummaryLead || incompleteFallback)];
  } else if (activities.length === 0 && !hasPendingInteraction) {
    const progressFallback =
      state.editedPaths.size > 0 ||
      state.shellCommands.length > 0 ||
      state.shellCommandCount > 0 ||
      state.seenReadPaths.size > 0
        ? 'Alterações aplicadas.'
        : null;

    activities = [
      statusFallback
        ? {
            id: crypto.randomUUID(),
            kind: 'status',
            label: statusFallback,
            createdAt: Date.now(),
          }
        : createActivity(
            'response',
            progressFallback ||
              incompleteFallback ||
              'Nenhuma resposta foi capturada. Tente enviar novamente.',
          ),
    ];
  } else if (
    activities.length > 0 &&
    !activities.some((entry) => entry.kind === 'response') &&
    !activities.some((entry) => entry.kind === 'status' && entry.label.trim()) &&
    isAgentTurnSummaryVisible(summary)
  ) {
    activities = [
      ...activities,
      createActivity('response', safeLead || safeSummaryLead || incompleteFallback),
    ];
  } else if (
    activities.length > 0 &&
    !activities.some((entry) => entry.kind === 'response') &&
    !activities.some((entry) => entry.kind === 'status' && entry.label.trim()) &&
    !hasPendingInteraction
  ) {
    activities = [...activities, createActivity('response', safeLead || incompleteFallback)];
  } else if (
    needsTrailingIncompleteResponse &&
    !activities.some((entry) => entry.kind === 'status' && entry.label.trim())
  ) {
    activities = [...activities, createActivity('response', incompleteFallback)];
  }

  // #region agent log
  writeDebugSessionLog({
    location: 'agentStreamJsonParser.ts:finalizeStreamJsonTurn',
    message: 'stream json turn finalized',
    data: {
      activityKinds: activities.map((entry) => entry.kind),
      responseCount: activities.filter((entry) => entry.kind === 'response').length,
      pendingResponseLength: state.pendingResponseText.trim().length,
      incompleteFallback,
      hasPendingInteraction,
    },
    hypothesisId: 'F',
    runId: 'post-fix',
  });
  // #endregion

  return {
    ...turn,
    activities,
    ...(summary ? { summary } : {}),
    ...(state.pendingUsage
      ? { usage: state.pendingUsage }
      : turn.usage
        ? { usage: turn.usage }
        : {}),
    running: false,
    completedAt: Date.now(),
  };
}

export function resetAgentStreamJsonTurn(state: AgentStreamJsonParserState): void {
  state.jsonBuffer = '';
  state.activities = [];
  state.thoughtId = null;
  state.thoughtStartedAt = null;
  state.thoughtSessionStartedAt = null;
  state.responseId = null;
  state.seenReadPaths.clear();
  state.editedPaths.clear();
  state.exploredFiles = [];
  state.editedFiles = [];
  state.shellCommands = [];
  state.shellCommandCount = 0;
  state.lineAdditions = 0;
  state.lineDeletions = 0;
  state.responseLead = null;
  state.summaryLeadCaptured = false;
  state.pendingResponseText = '';
  state.pendingUsage = null;
  state.shouldFinalize = false;
  state.pendingQuestion = false;
  state.questionActivityId = null;
  state.pendingPlan = false;
  state.planActivityId = null;
  state.shellToolEvents = [];
  state.runningToolRunStack = [];
  state.runningTaskStack = [];
  state.sawStreamingAssistantDelta = false;
  state.handoffComplete = false;
}

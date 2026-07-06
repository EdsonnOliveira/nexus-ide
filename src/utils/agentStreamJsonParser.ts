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
import { sanitizeResponseText } from '@/utils/agentTranscriptParser';
import { ensureOtherOption } from '@/utils/agentQuestionPrompt';
import {
  deduplicatePlanResponseActivities,
  normalizePlanTodos,
  parsePlanTodosFromMarkdown,
} from '@/utils/agentPlanPrompt';

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

function findStreamingThoughtActivity(state: AgentStreamJsonParserState): AgentActivity | undefined {
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
    return delta;
  }

  if (!delta) {
    return currentLabel;
  }

  const needsSpace =
    !currentLabel.endsWith(' ') &&
    !currentLabel.endsWith('\n') &&
    !delta.startsWith(' ') &&
    !/^[,.;:!?)]/.test(delta);

  return `${currentLabel}${needsSpace ? ' ' : ''}${delta}`;
}

function upsertThought(state: AgentStreamJsonParserState, delta: string): void {
  if (!delta) {
    return;
  }

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

  const latestThought = findLatestThoughtActivity(state);

  if (latestThought) {
    state.thoughtId = latestThought.id;
    state.thoughtStartedAt = state.thoughtSessionStartedAt ?? latestThought.createdAt;
    state.thoughtSessionStartedAt = state.thoughtSessionStartedAt ?? latestThought.createdAt;
    const separator = latestThought.label.trim() ? '\n\n' : '';

    state.activities = state.activities.map((entry) =>
      entry.id === latestThought.id
        ? {
            ...entry,
            streaming: true,
            collapsed: false,
            label: `${entry.label.trim()}${separator}${delta.trim()}`,
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

function settleThought(state: AgentStreamJsonParserState): void {
  const thought = findStreamingThoughtActivity(state) ?? findLatestThoughtActivity(state);

  if (!thought) {
    return;
  }

  const startedAt = state.thoughtSessionStartedAt ?? thought.createdAt ?? Date.now();
  const durationMs = Math.max(Date.now() - startedAt, 1000);

  state.activities = state.activities.map((entry) =>
    entry.id === thought.id
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
  const displayPath = shortenPath(filePath);
  const existingIndex = state.activities.findIndex(
    (entry) => entry.kind === 'file_edit' && entry.filePath?.trim().toLowerCase() === normalized,
  );

  if (existingIndex >= 0) {
    const existing = state.activities[existingIndex]!;
    const nextAdditions = (existing.additions ?? 0) + additions;
    const nextDeletions = (existing.deletions ?? 0) + deletions;

    state.activities = [
      ...state.activities.slice(0, existingIndex),
      {
        ...existing,
        filePath: displayPath,
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
      filePath: displayPath,
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
        ? rawPlan.map((entry) => String(entry)).join('\n').trim()
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
    return sanitizeResponseText(entry.label).trim().length > 0;
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

  upsertFileEdit(
    state,
    path,
    success.linesAdded ?? 0,
    success.linesRemoved ?? fallbackDeletions,
  );
  state.activities = state.activities.filter((entry) => entry.kind !== 'live_status');
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
    state.activities = state.activities.filter((entry) => entry.kind !== 'live_status');
    return;
  }

  const globToolCall = payload.globToolCall as { args?: { globPattern?: string } } | undefined;

  if (globToolCall) {
    state.activities = state.activities.filter((entry) => entry.kind !== 'live_status');
    return;
  }

  const grepToolCall = payload.grepToolCall as { args?: { pattern?: string } } | undefined;

  if (grepToolCall) {
    state.activities = state.activities.filter((entry) => entry.kind !== 'live_status');
    return;
  }

  if (payload.mcpToolCall || payload.shellToolCall) {
    state.activities = state.activities.filter((entry) => entry.kind !== 'live_status');
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

function upsertLiveStatus(state: AgentStreamJsonParserState, label: string): void {
  const trimmed = label.trim();

  if (!trimmed) {
    return;
  }

  const existing = state.activities.find((entry) => entry.kind === 'live_status');

  if (existing) {
    state.activities = state.activities.map((entry) =>
      entry.id === existing.id ? { ...entry, label: trimmed } : entry,
    );
    return;
  }

  state.activities = [...state.activities, createActivity('live_status', trimmed)];
}

function handleToolCallStarted(state: AgentStreamJsonParserState, toolCall: unknown): void {
  captureResponseLeadBeforeTools(state);

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
    upsertLiveStatus(state, `Reading ${basenamePath(readToolCall.args.path)}`);
    upsertFileRead(state, readToolCall.args.path);
    return;
  }

  const editToolCall = payload.editToolCall as { args?: { path?: string } } | undefined;

  if (editToolCall?.args?.path) {
    upsertLiveStatus(state, `Editing ${basenamePath(editToolCall.args.path)}`);
    return;
  }

  const writeToolCall = payload.writeToolCall as { args?: { path?: string } } | undefined;

  if (writeToolCall?.args?.path) {
    upsertLiveStatus(state, `Writing ${basenamePath(writeToolCall.args.path)}`);
    return;
  }

  const shellToolCall = payload.shellToolCall as { args?: { command?: string } } | undefined;

  if (shellToolCall?.args?.command) {
    const command = shellToolCall.args.command.trim();
    trackShellCommand(state, command);
    const preview = command.split(/\s+/).slice(0, 4).join(' ');
    upsertLiveStatus(state, preview ? `Running ${preview}` : 'Running command');
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
    upsertLiveStatus(state, label);
    upsertFileRead(state, directory ?? pattern, label);
    return;
  }

  const grepToolCall = payload.grepToolCall as { args?: { pattern?: string; path?: string } } | undefined;

  if (grepToolCall?.args?.pattern) {
    const pattern = grepToolCall.args.pattern.trim();
    const path = grepToolCall.args.path?.trim();
    const label = path ? `Grep ${pattern} in ${basenamePath(path)}` : `Grep ${pattern}`;
    upsertLiveStatus(state, label);
    upsertFileRead(state, path ?? pattern, label);
    return;
  }

  if (payload.mcpToolCall) {
    upsertLiveStatus(state, 'Running tool');
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

    const resultText =
      typeof event.result === 'string' ? event.result.trim() : state.pendingResponseText.trim();

    if (event.subtype === 'success') {
      if (resultText) {
        upsertResponse(state, resultText, false);
      }

      if (!hasPendingStreamJsonInteraction(state)) {
        state.shouldFinalize = true;
      }

      return;
    }

    if (resultText) {
      upsertResponse(state, resultText, false);
    }

    if (!hasPendingStreamJsonInteraction(state)) {
      state.shouldFinalize = true;
    }

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

  const nextActivitySignature = getStreamActivitySignature(state.activities);
  const hasUpdate =
    state.activities.length !== previousActivityCount ||
    state.pendingResponseText !== previousResponseText ||
    nextActivitySignature !== previousActivitySignature;
  const shouldFinalize = state.shouldFinalize && !previousFinalize;

  return {
    hasUpdate,
    shouldFinalize,
    sessionId: state.sessionId,
    responseText: state.pendingResponseText || null,
    usage: state.pendingUsage,
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

  if (state.pendingResponseText.trim()) {
    return true;
  }

  return state.activities.some(
    (entry) =>
      entry.kind === 'file_read' ||
      entry.kind === 'file_edit' ||
      entry.kind === 'live_status' ||
      entry.kind === 'thought' ||
      entry.kind === 'response',
  );
}

function resolveIncompleteStreamJsonResponseFallback(
  state: AgentStreamJsonParserState,
  activities: AgentActivity[],
): string {
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

  activities = mergeInteractionActivitiesFromTurn(activities, turn);
  activities = activities.filter((entry) => isRenderableStreamJsonActivity(entry));
  activities = deduplicatePlanResponseActivities(activities);

  const summary = buildAgentTurnSummaryFromStreamJsonState(state);
  const incompleteFallback = resolveIncompleteStreamJsonResponseFallback(state, activities);
  const hasPendingInteraction =
    hasPendingStreamJsonInteraction(state, activities) ||
    turn.activities.some((entry) => isPendingInteractionActivity(entry));

  const safeLead = sanitizeResponseText(state.responseLead?.trim() ?? '').trim();
  const safeSummaryLead = sanitizeResponseText(summary?.responseLead?.trim() ?? '').trim();

  if (activities.length === 0 && isAgentTurnSummaryVisible(summary)) {
    activities = [
      createActivity(
        'response',
        safeLead || safeSummaryLead || incompleteFallback,
      ),
    ];
  } else if (activities.length === 0 && !hasPendingInteraction) {
    activities = [
      createActivity(
        'response',
        'Nenhuma resposta foi capturada. Tente enviar novamente.',
      ),
    ];
  } else if (
    activities.length > 0 &&
    !activities.some((entry) => entry.kind === 'response') &&
    isAgentTurnSummaryVisible(summary)
  ) {
    activities = [
      ...activities,
      createActivity(
        'response',
        safeLead || safeSummaryLead || incompleteFallback,
      ),
    ];
  } else if (
    activities.length > 0 &&
    !activities.some((entry) => entry.kind === 'response') &&
    !hasPendingInteraction
  ) {
    activities = [
      ...activities,
      createActivity(
        'response',
        safeLead || incompleteFallback,
      ),
    ];
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
}

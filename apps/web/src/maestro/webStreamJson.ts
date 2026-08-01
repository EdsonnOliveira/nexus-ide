import type { WebAgentActivity, WebAgentActivityKind } from '../store';

export type { WebAgentActivity };

export interface WebShellToolEvent {
  type: 'started' | 'completed';
  command: string;
  output: string;
  exitCode: number | null;
}

export interface WebStreamJsonState {
  buffer: string;
  thought: string;
  thoughtStreaming: boolean;
  response: string;
  sessionId: string | null;
  done: boolean;
  shellToolEvents: WebShellToolEvent[];
  activities: WebAgentActivity[];
  thoughtId: string | null;
  thoughtStartedAt: number | null;
  responseId: string | null;
  runningToolRunStack: string[];
  seenReadPaths: Set<string>;
  activitySeq: number;
}

export interface WebStreamJsonUpdate {
  thought: string;
  thoughtStreaming: boolean;
  response: string;
  sessionId: string | null;
  done: boolean;
  shellToolEvents: WebShellToolEvent[];
  activities: WebAgentActivity[];
}

export function createWebStreamJsonState(): WebStreamJsonState {
  const startedAt = Date.now();
  const thoughtId = 'web-act-thought-seed';
  return {
    buffer: '',
    thought: '',
    thoughtStreaming: true,
    response: '',
    sessionId: null,
    done: false,
    shellToolEvents: [],
    activities: [
      {
        id: thoughtId,
        kind: 'thought',
        label: '',
        streaming: true,
        startedAt,
      },
    ],
    thoughtId,
    thoughtStartedAt: startedAt,
    responseId: null,
    runningToolRunStack: [],
    seenReadPaths: new Set(),
    activitySeq: 0,
  };
}

function nextActivityId(state: WebStreamJsonState): string {
  state.activitySeq += 1;
  return `web-act-${state.activitySeq}`;
}

function createActivity(
  state: WebStreamJsonState,
  kind: WebAgentActivityKind,
  label: string,
  extra: Partial<WebAgentActivity> = {},
): WebAgentActivity {
  return {
    id: nextActivityId(state),
    kind,
    label,
    ...extra,
  };
}

function basenamePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] ?? filePath;
}

function toStoredAgentFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/Users\/[^/]+/, '~');
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
    return [successRecord.stdout, successRecord.stderr, successRecord.output, successRecord.content, successRecord.text]
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

  if (success && typeof success === 'object') {
    const code = (success as { exitCode?: unknown; exit_code?: unknown }).exitCode
      ?? (success as { exit_code?: unknown }).exit_code;
    if (typeof code === 'number') {
      return code;
    }
  }

  const direct = record.exitCode ?? record.exit_code;
  return typeof direct === 'number' ? direct : null;
}

function isSafeWebAssistantImageSrc(src: string): boolean {
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

  return /(?:\/|\.\.?\/|[A-Za-z]:[\\/]|^)[^\s]+\.(png|jpe?g|gif|webp|bmp|svg)(?:\?.*)?$/i.test(
    trimmed,
  );
}

function extractWebAssistantImageMarkdown(part: Record<string, unknown>): string {
  const type = typeof part.type === 'string' ? part.type.toLowerCase() : '';

  if (type === 'image_url') {
    const imageUrl = part.image_url;

    if (typeof imageUrl === 'string' && isSafeWebAssistantImageSrc(imageUrl)) {
      return `\n\n![](${imageUrl})\n\n`;
    }

    if (imageUrl && typeof imageUrl === 'object') {
      const url = (imageUrl as { url?: unknown }).url;

      if (typeof url === 'string' && isSafeWebAssistantImageSrc(url)) {
        return `\n\n![](${url})\n\n`;
      }
    }
  }

  if (type === 'image' || type === 'input_image' || type === 'media_image') {
    if (typeof part.url === 'string' && isSafeWebAssistantImageSrc(part.url)) {
      return `\n\n![](${part.url})\n\n`;
    }

    if (typeof part.image === 'string' && isSafeWebAssistantImageSrc(part.image)) {
      return `\n\n![](${part.image})\n\n`;
    }

    const source = part.source;

    if (source && typeof source === 'object') {
      const record = source as Record<string, unknown>;

      if (typeof record.url === 'string' && isSafeWebAssistantImageSrc(record.url)) {
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

          if (isSafeWebAssistantImageSrc(dataUrl)) {
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

        if (isSafeWebAssistantImageSrc(dataUrl)) {
          return `\n\n![](${dataUrl})\n\n`;
        }
      }
    }
  }

  return '';
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
      const text = entry.text;
      if (typeof text === 'string' && text) {
        return text;
      }
      return extractWebAssistantImageMarkdown(entry);
    })
    .filter(Boolean)
    .join('');
}

export function extractStreamChunk(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const root = payload as Record<string, unknown>;
  if (typeof root.chunk === 'string') {
    return root.chunk;
  }
  const nested = root.payload;
  if (nested && typeof nested === 'object') {
    const inner = nested as Record<string, unknown>;
    if (typeof inner.chunk === 'string') {
      return inner.chunk;
    }
    const deeper = inner.payload;
    if (deeper && typeof deeper === 'object') {
      const deepChunk = (deeper as Record<string, unknown>).chunk;
      if (typeof deepChunk === 'string') {
        return deepChunk;
      }
    }
  }
  return null;
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
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
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
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function settleThought(state: WebStreamJsonState): void {
  state.thoughtStreaming = false;

  if (!state.thoughtId) {
    return;
  }

  const thoughtId = state.thoughtId;
  const startedAt = state.thoughtStartedAt;
  const durationMs = startedAt ? Math.max(1, Date.now() - startedAt) : undefined;
  const thoughtLabel = (state.activities.find((entry) => entry.id === thoughtId)?.label ?? state.thought).trim();

  if (!thoughtLabel) {
    state.activities = state.activities.filter((entry) => entry.id !== thoughtId);
    state.thoughtId = null;
    state.thoughtStartedAt = null;
    return;
  }

  state.activities = state.activities.map((entry) =>
    entry.id === thoughtId && entry.kind === 'thought'
      ? {
          ...entry,
          streaming: undefined,
          durationMs,
          label: thoughtLabel,
        }
      : entry,
  );

  state.thoughtId = null;
  state.thoughtStartedAt = null;
}

function upsertThought(state: WebStreamJsonState, text: string): void {
  state.thought += text;
  state.thoughtStreaming = true;

  if (state.thoughtId) {
    state.activities = state.activities.map((entry) =>
      entry.id === state.thoughtId
        ? { ...entry, label: state.thought, streaming: true }
        : entry,
    );
    return;
  }

  const startedAt = Date.now();
  const thought = createActivity(state, 'thought', state.thought, {
    streaming: true,
    startedAt,
  });
  state.thoughtId = thought.id;
  state.thoughtStartedAt = startedAt;
  state.activities = [...state.activities, thought];
}

function sealActiveResponseSegment(state: WebStreamJsonState): void {
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

function upsertResponse(state: WebStreamJsonState, text: string, streaming: boolean): void {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }

  settleThought(state);

  if (state.responseId) {
    const current = state.activities.find((entry) => entry.id === state.responseId);
    const currentLabel = current?.label?.trim() ?? '';
    const shouldKeepExisting =
      currentLabel.length > trimmed.length &&
      !currentLabel.startsWith(trimmed) &&
      !trimmed.startsWith(currentLabel);
    const nextLabel = shouldKeepExisting ? currentLabel : trimmed;
    state.response = nextLabel;
    state.activities = state.activities.map((entry) =>
      entry.id === state.responseId
        ? { ...entry, label: nextLabel, streaming: streaming ? true : undefined }
        : entry,
    );
    return;
  }

  state.response = trimmed;
  const response = createActivity(state, 'response', trimmed, {
    streaming: streaming ? true : undefined,
  });
  state.responseId = response.id;
  state.activities = [...state.activities, response];
}

function upsertFileRead(state: WebStreamJsonState, filePath: string, label?: string): void {
  const normalized = filePath.trim().toLowerCase();
  if (!normalized || state.seenReadPaths.has(normalized)) {
    return;
  }

  state.seenReadPaths.add(normalized);
  const storedPath = toStoredAgentFilePath(filePath);
  const read = createActivity(state, 'file_read', label ?? `Read ${basenamePath(filePath)}`, {
    filePath: storedPath,
  });
  state.activities = [...state.activities, read];
}

function upsertFileEdit(
  state: WebStreamJsonState,
  filePath: string,
  additions = 0,
  deletions = 0,
): void {
  const normalized = filePath.trim().toLowerCase();
  if (!normalized) {
    return;
  }

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
    createActivity(state, 'file_edit', `Edited ${basenamePath(filePath)}`, {
      filePath: storedPath,
      additions: additions > 0 ? additions : undefined,
      deletions: deletions > 0 ? deletions : undefined,
    }),
  ];
}

function startToolRun(
  state: WebStreamJsonState,
  label: string,
  extra: Partial<WebAgentActivity> = {},
): void {
  const trimmed = label.trim();
  if (!trimmed) {
    return;
  }

  const activity = createActivity(state, 'tool_run', trimmed, {
    streaming: true,
    ...extra,
  });
  state.activities = [...state.activities, activity];
  state.runningToolRunStack.push(activity.id);
}

function completeToolRun(
  state: WebStreamJsonState,
  extra: Partial<WebAgentActivity> = {},
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

function trackFileMutationToolCall(
  state: WebStreamJsonState,
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
  completeToolRun(state);
}

function handleToolCallStarted(state: WebStreamJsonState, toolCall: unknown): void {
  sealActiveResponseSegment(state);
  settleThought(state);

  if (!toolCall || typeof toolCall !== 'object') {
    return;
  }

  const payload = toolCall as Record<string, unknown>;

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
    state.shellToolEvents.push({
      type: 'started',
      command,
      output: '',
      exitCode: null,
    });
    startToolRun(state, 'Running', { toolCommand: command });
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
    startToolRun(state, label);
    upsertFileRead(state, directory ?? pattern, label);
    return;
  }

  const grepToolCall = payload.grepToolCall as
    | { args?: { pattern?: string; path?: string } }
    | undefined;
  if (grepToolCall?.args?.pattern) {
    const pattern = grepToolCall.args.pattern.trim();
    const path = grepToolCall.args.path?.trim();
    const label = path ? `Grep ${pattern} in ${basenamePath(path)}` : `Grep ${pattern}`;
    startToolRun(state, label);
    upsertFileRead(state, path ?? pattern, label);
    return;
  }

  if (payload.mcpToolCall) {
    startToolRun(state, 'Running tool');
  }
}

function handleToolCallCompleted(state: WebStreamJsonState, toolCall: unknown): void {
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
    });
    return;
  }

  if (payload.mcpToolCall || payload.shellToolCall) {
    completeToolRun(state, { label: 'Ran tool' });
  }
}

function settleAllStreaming(state: WebStreamJsonState): void {
  settleThought(state);
  sealActiveResponseSegment(state);
  state.runningToolRunStack = [];
  state.activities = state.activities.map((entry) =>
    entry.streaming ? { ...entry, streaming: undefined } : entry,
  );
}

export function isTrivialWebResponseText(text: string): boolean {
  const trimmed = text.trim();

  if (!trimmed) {
    return true;
  }

  if (trimmed.length <= 2) {
    return true;
  }

  return /^[?.!…,;:]+$/u.test(trimmed);
}

export function looksLikeMidProgressWebResponse(text: string): boolean {
  const trimmed = text.trim();

  if (!trimmed || trimmed.length < 12) {
    return false;
  }

  const tail = trimmed.slice(-320);
  const hasProgressIntent =
    /\b(vou |vamos |i'll |i will |let me |i am going to |i'm going to |next[,:]?\s|em seguida|agora vou|seguindo com|continu(?:ar|ando|e)\b)/i.test(
      tail,
    ) ||
    /\b(atualizo|atualizando|subo|subindo|fa[cç]o|fazendo|verifico|verificando|testo|testando|leio|lendo|edito|editando|crio|criando|removo|removendo|adiciono|adicionando|implemento|implementando|aplico|aplicando|reinicio|reiniciando|configuro|configurando|ajusto|ajustando|valido|validando|confiro|conferindo|envio|enviando|rodo|rodando|executo|executando|abro|abrindo|fecho|fechando|monitoro|monitorando|acompanho|acompanhando|revogo|revogando)\b/i.test(
      tail,
    ) ||
    /\b(running|executing|checking|testing|reading|writing|updating|creating|sending|polling)\b/i.test(
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

function findLastWebResponseLabel(state: WebStreamJsonState): string {
  for (let index = state.activities.length - 1; index >= 0; index -= 1) {
    const entry = state.activities[index];
    if (entry?.kind === 'response' && entry.label.trim()) {
      return entry.label.trim();
    }
  }
  return state.response.trim();
}

function isAggregatedPriorWebResponseText(
  resultText: string,
  activities: WebAgentActivity[],
): boolean {
  const responses = activities
    .filter((entry) => entry.kind === 'response' && entry.label.trim())
    .map((entry) => entry.label.trim());

  if (responses.length === 0) {
    return false;
  }

  const compactResult = resultText.replace(/\s+/g, '');
  const lastCompact = responses[responses.length - 1]!.replace(/\s+/g, '');

  if (compactResult.length < 48) {
    return lastCompact.length >= compactResult.length;
  }

  const compactJoined = responses.join('').replace(/\s+/g, '');

  if (compactResult === lastCompact) {
    return true;
  }

  if (
    lastCompact.length >= 16 &&
    compactResult.includes(lastCompact) &&
    compactResult.length > lastCompact.length
  ) {
    return false;
  }

  if (
    compactJoined.length >= 48 &&
    compactResult === compactJoined
  ) {
    return true;
  }

  const matched = responses.filter((entry) => {
    const compact = entry.replace(/\s+/g, '');
    return compact.length >= 16 && compactResult.includes(compact.slice(0, Math.min(48, compact.length)));
  }).length;

  return matched >= Math.min(2, responses.length);
}

function handleEvent(state: WebStreamJsonState, event: Record<string, unknown>): void {
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
    if (text) {
      upsertResponse(state, text, true);
    }
    return;
  }

  if (type === 'result') {
    if (typeof event.session_id === 'string') {
      state.sessionId = event.session_id;
    }
    const resultText =
      typeof event.result === 'string' ? event.result.trim() : state.response.trim();
    if (resultText && !isAggregatedPriorWebResponseText(resultText, state.activities)) {
      upsertResponse(state, resultText, false);
    }
    settleAllStreaming(state);
    const lastResponse = findLastWebResponseLabel(state);
    const priorResponses = state.activities.filter(
      (entry) =>
        entry.kind === 'response' &&
        entry.label.trim() &&
        entry.label.trim() !== lastResponse,
    );
    const truncatedTrailing =
      isTrivialWebResponseText(lastResponse) &&
      priorResponses.some((entry) => looksLikeMidProgressWebResponse(entry.label));
    if (!looksLikeMidProgressWebResponse(lastResponse) && !truncatedTrailing) {
      state.done = true;
    }
  }
}

function consumeJsonObjects(state: WebStreamJsonState): void {
  while (state.buffer.trim()) {
    const start = state.buffer.indexOf('{');
    if (start < 0) {
      state.buffer = '';
      return;
    }
    if (start > 0) {
      state.buffer = state.buffer.slice(start);
    }
    const end = findJsonObjectEnd(state.buffer);
    if (end < 0) {
      return;
    }
    const raw = state.buffer.slice(0, end + 1);
    state.buffer = state.buffer.slice(end + 1);
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      handleEvent(state, parsed);
    } catch {
    }
  }
}

export function feedWebStreamJson(
  state: WebStreamJsonState,
  chunk: string,
): WebStreamJsonUpdate {
  state.buffer += chunk;
  consumeJsonObjects(state);
  const shellToolEvents = [...state.shellToolEvents];
  state.shellToolEvents = [];
  return {
    thought: state.thought,
    thoughtStreaming: state.thoughtStreaming,
    response: state.response,
    sessionId: state.sessionId,
    done: state.done,
    shellToolEvents,
    activities: state.activities.map((entry) => ({ ...entry })),
  };
}

export function buildWebLiveToolBatchSummary(
  activities: WebAgentActivity[],
  running: boolean,
): string | null {
  if (running) {
    const streamingShell = [...activities]
      .reverse()
      .find(
        (activity) =>
          activity.kind === 'tool_run' && activity.streaming && activity.toolCommand?.trim(),
      );

    if (streamingShell?.toolCommand?.trim()) {
      const command = streamingShell.toolCommand.trim();
      const preview = command.length > 56 ? `${command.slice(0, 53)}…` : command;
      return `Executando ${preview}`;
    }

    const streamingTool = [...activities]
      .reverse()
      .find((activity) => activity.kind === 'tool_run' && activity.streaming && activity.label.trim());

    if (streamingTool?.label.trim()) {
      return streamingTool.label.trim();
    }
  }

  const fileReads = activities.filter((activity) => activity.kind === 'file_read');
  const fileEdits = activities.filter((activity) => activity.kind === 'file_edit');
  const searchCount = activities.filter(
    (activity) =>
      activity.kind === 'tool_run' && /^(?:Glob|Grep)/i.test(activity.label.trim()),
  ).length;

  if (fileEdits.length > 0) {
    const additions = fileEdits.reduce((sum, entry) => sum + (entry.additions ?? 0), 0);
    const deletions = fileEdits.reduce((sum, entry) => sum + (entry.deletions ?? 0), 0);
    let label = `${running ? 'Editing' : 'Edited'} ${fileEdits.length} file${
      fileEdits.length === 1 ? '' : 's'
    }`;
    if (additions > 0 || deletions > 0) {
      label += ` +${additions} -${deletions}`;
    }
    return label;
  }

  if (fileReads.length > 0 || searchCount > 0) {
    const prefix = running ? 'Exploring' : 'Explored';
    const fileLabel = `${fileReads.length} file${fileReads.length === 1 ? '' : 's'}`;
    const searchLabel =
      searchCount > 0 ? `, ${searchCount} search${searchCount === 1 ? '' : 'es'}` : '';
    return `${prefix} ${fileLabel}${searchLabel}`;
  }

  const shellRuns = activities.filter(
    (activity) => activity.kind === 'tool_run' && activity.toolCommand?.trim(),
  );
  if (shellRuns.length > 0) {
    return running
      ? `Running ${shellRuns.length} command${shellRuns.length === 1 ? '' : 's'}`
      : `Ran ${shellRuns.length} command${shellRuns.length === 1 ? '' : 's'}`;
  }

  return null;
}

export function isWebActionBlockActivity(activity: WebAgentActivity): boolean {
  if (activity.kind === 'thought') {
    return true;
  }

  if (activity.kind === 'file_edit' || activity.kind === 'file_read') {
    return Boolean(activity.filePath?.trim());
  }

  if (activity.kind === 'tool_run') {
    return Boolean(activity.label.trim() || activity.toolCommand?.trim());
  }

  return false;
}

export interface WebActionBlockSummary {
  label: string;
  additions: number;
  deletions: number;
  hasToolProgress: boolean;
}

export function buildWebActionBlockSummary(activities: WebAgentActivity[]): WebActionBlockSummary {
  const editedPaths = new Set<string>();
  const exploredPaths = new Set<string>();
  let editedCount = 0;
  let exploredCount = 0;
  let searchCount = 0;
  let lintCount = 0;
  let commandCount = 0;
  let additions = 0;
  let deletions = 0;
  const commandKeys = new Set<string>();

  for (const activity of activities) {
    if (activity.kind === 'file_edit') {
      const path = activity.filePath?.trim();
      if (path) {
        const key = path.toLowerCase();
        if (!editedPaths.has(key)) {
          editedPaths.add(key);
          editedCount += 1;
        }
      }
      additions += activity.additions ?? 0;
      deletions += activity.deletions ?? 0;
      continue;
    }

    if (activity.kind === 'file_read') {
      const path = activity.filePath?.trim();
      if (path) {
        const key = path.toLowerCase();
        if (!exploredPaths.has(key) && !editedPaths.has(key)) {
          exploredPaths.add(key);
          exploredCount += 1;
        }
      }
      continue;
    }

    if (activity.kind === 'tool_run') {
      const label = activity.label.trim();
      const command = activity.toolCommand?.trim() ?? '';

      if (/^(?:Glob|Grep|Grepping|Searching|Searched)/i.test(label)) {
        searchCount += 1;
        continue;
      }

      if (/lint/i.test(label) || /lint/i.test(command)) {
        lintCount += 1;
        continue;
      }

      if (command) {
        const key = command.toLowerCase();
        if (!commandKeys.has(key)) {
          commandKeys.add(key);
          commandCount += 1;
        }
      }
    }
  }

  const parts: string[] = [];

  if (editedCount > 0) {
    parts.push(`Editing ${editedCount} file${editedCount === 1 ? '' : 's'}`);
  }

  if (exploredCount > 0) {
    parts.push(`explored ${exploredCount} file${exploredCount === 1 ? '' : 's'}`);
  }

  if (searchCount > 0) {
    parts.push(`${searchCount} search${searchCount === 1 ? '' : 'es'}`);
  }

  if (lintCount > 0) {
    parts.push(lintCount === 1 ? 'lints' : `${lintCount} lints`);
  }

  if (commandCount > 0) {
    parts.push(`ran ${commandCount} command${commandCount === 1 ? '' : 's'}`);
  }

  return {
    label: parts.join(', '),
    additions,
    deletions,
    hasToolProgress: parts.length > 0,
  };
}

export type WebActivityRenderChunk =
  | { type: 'single'; activity: WebAgentActivity; key: string }
  | { type: 'action-group'; activities: WebAgentActivity[]; key: string };

export function buildWebActivityRenderChunks(
  activities: WebAgentActivity[],
): WebActivityRenderChunk[] {
  const chunks: WebActivityRenderChunk[] = [];
  let actionGroup: WebAgentActivity[] = [];

  const flushActionGroup = () => {
    if (actionGroup.length === 0) {
      return;
    }

    chunks.push({
      type: 'action-group',
      activities: actionGroup,
      key: `action-group-${actionGroup[0]?.id ?? chunks.length}`,
    });
    actionGroup = [];
  };

  for (const activity of activities) {
    if (isWebActionBlockActivity(activity)) {
      actionGroup.push(activity);
      continue;
    }

    flushActionGroup();
    chunks.push({ type: 'single', activity, key: activity.id });
  }

  flushActionGroup();
  return chunks;
}

export function isWebActionBlockChunkLive(
  chunkIndex: number,
  chunks: WebActivityRenderChunk[],
  running: boolean,
): boolean {
  if (!running) {
    return false;
  }

  for (let index = chunkIndex + 1; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (chunk?.type === 'single' && chunk.activity.kind === 'response') {
      return false;
    }
  }

  return true;
}

export function partitionWebLiveActionBlockActivities(activities: WebAgentActivity[]): {
  settled: WebAgentActivity[];
  live: WebAgentActivity[];
} {
  let lastStreamingIndex = -1;

  for (let index = 0; index < activities.length; index += 1) {
    if (activities[index]?.streaming) {
      lastStreamingIndex = index;
    }
  }

  if (lastStreamingIndex < 0) {
    return { settled: activities, live: [] };
  }

  let cutIndex = lastStreamingIndex;

  for (let index = lastStreamingIndex; index >= 0; index -= 1) {
    const entry = activities[index];
    if (!entry) {
      continue;
    }

    if (entry.kind === 'thought') {
      cutIndex = index;
      break;
    }

    cutIndex = index;
  }

  return {
    settled: activities.slice(0, cutIndex),
    live: activities.slice(cutIndex),
  };
}

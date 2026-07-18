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
}

export interface WebStreamJsonUpdate {
  thought: string;
  thoughtStreaming: boolean;
  response: string;
  sessionId: string | null;
  done: boolean;
  shellToolEvents: WebShellToolEvent[];
}

export function createWebStreamJsonState(): WebStreamJsonState {
  return {
    buffer: '',
    thought: '',
    thoughtStreaming: false,
    response: '',
    sessionId: null,
    done: false,
    shellToolEvents: [],
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

function handleEvent(state: WebStreamJsonState, event: Record<string, unknown>): void {
  const type = typeof event.type === 'string' ? event.type : '';

  if (type === 'system' && event.subtype === 'init' && typeof event.session_id === 'string') {
    state.sessionId = event.session_id;
    return;
  }

  if (type === 'thinking') {
    if (event.subtype === 'delta' && typeof event.text === 'string') {
      state.thought += event.text;
      state.thoughtStreaming = true;
      return;
    }
    if (event.subtype === 'completed') {
      state.thoughtStreaming = false;
    }
    return;
  }

  if (type === 'tool_call') {
    const toolCall = event.tool_call;
    if (!toolCall || typeof toolCall !== 'object') {
      return;
    }
    const payload = toolCall as {
      shellToolCall?: {
        args?: { command?: string };
        result?: unknown;
      };
    };
    const shellToolCall = payload.shellToolCall;
    const command = shellToolCall?.args?.command?.trim();
    if (!command) {
      return;
    }

    if (event.subtype === 'started') {
      state.shellToolEvents.push({
        type: 'started',
        command,
        output: '',
        exitCode: null,
      });
      return;
    }

    if (event.subtype === 'completed') {
      state.shellToolEvents.push({
        type: 'completed',
        command,
        output: extractShellToolOutput(shellToolCall?.result),
        exitCode: extractShellToolExitCode(shellToolCall?.result),
      });
    }
    return;
  }

  if (type === 'assistant') {
    const text = extractAssistantText(event.message);
    if (text) {
      state.response = text;
      state.thoughtStreaming = false;
    }
    return;
  }

  if (type === 'result') {
    if (typeof event.session_id === 'string') {
      state.sessionId = event.session_id;
    }
    const resultText =
      typeof event.result === 'string' ? event.result.trim() : state.response.trim();
    if (resultText) {
      state.response = resultText;
    }
    state.thoughtStreaming = false;
    state.done = true;
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
  };
}

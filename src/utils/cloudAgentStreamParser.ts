export interface CloudAgentStreamState {
  buffer: string;
  thought: string;
  thoughtStreaming: boolean;
  response: string;
  sessionId: string | null;
  done: boolean;
}

export interface CloudAgentStreamUpdate {
  thought: string;
  thoughtStreaming: boolean;
  response: string;
  sessionId: string | null;
  done: boolean;
}

export function createCloudAgentStreamState(): CloudAgentStreamState {
  return {
    buffer: '',
    thought: '',
    thoughtStreaming: false,
    response: '',
    sessionId: null,
    done: false,
  };
}

function isSafeCloudAgentImageSrc(src: string): boolean {
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

function extractCloudAgentImageMarkdown(part: Record<string, unknown>): string {
  const type = typeof part.type === 'string' ? part.type.toLowerCase() : '';

  if (type === 'image_url') {
    const imageUrl = part.image_url;

    if (typeof imageUrl === 'string' && isSafeCloudAgentImageSrc(imageUrl)) {
      return `\n\n![](${imageUrl})\n\n`;
    }

    if (imageUrl && typeof imageUrl === 'object') {
      const url = (imageUrl as { url?: unknown }).url;

      if (typeof url === 'string' && isSafeCloudAgentImageSrc(url)) {
        return `\n\n![](${url})\n\n`;
      }
    }
  }

  return '';
}

function extractCloudAgentAssistantText(message: unknown): string {
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

      return extractCloudAgentImageMarkdown(entry);
    })
    .filter(Boolean)
    .join('');
}

export function extractCloudAgentStreamChunk(payload: unknown): string | null {
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

function findCloudAgentJsonObjectEnd(value: string): number {
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

function handleCloudAgentStreamEvent(
  state: CloudAgentStreamState,
  event: Record<string, unknown>,
): void {
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

  if (type === 'assistant') {
    const text = extractCloudAgentAssistantText(event.message);

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

function consumeCloudAgentJsonObjects(state: CloudAgentStreamState): void {
  while (state.buffer.trim()) {
    const start = state.buffer.indexOf('{');

    if (start < 0) {
      state.buffer = '';
      return;
    }

    if (start > 0) {
      state.buffer = state.buffer.slice(start);
    }

    const end = findCloudAgentJsonObjectEnd(state.buffer);

    if (end < 0) {
      return;
    }

    const raw = state.buffer.slice(0, end + 1);
    state.buffer = state.buffer.slice(end + 1);

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      handleCloudAgentStreamEvent(state, parsed);
    } catch {}
  }
}

export function feedCloudAgentStreamChunk(
  state: CloudAgentStreamState,
  chunk: string,
): CloudAgentStreamUpdate {
  state.buffer += chunk;
  consumeCloudAgentJsonObjects(state);

  return {
    thought: state.thought,
    thoughtStreaming: state.thoughtStreaming,
    response: state.response,
    sessionId: state.sessionId,
    done: state.done,
  };
}

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3:8b';
const PREFERRED_MODELS = ['qwen3:8b', 'llama3.2', 'llama3.2:latest', 'llama3.1', 'phi3', 'mistral'];

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function isOllamaReachable(baseUrl = DEFAULT_OLLAMA_URL): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(2_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function resolveOllamaModel(
  preferred?: string,
  baseUrl = DEFAULT_OLLAMA_URL,
): Promise<string> {
  const preferredTrimmed = preferred?.trim();
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) {
      return preferredTrimmed || DEFAULT_MODEL;
    }
    const payload = (await response.json()) as {
      models?: Array<{ name?: string }>;
    };
    const names = (payload.models ?? [])
      .map((entry) => entry.name?.trim())
      .filter((name): name is string => Boolean(name));

    if (preferredTrimmed && names.includes(preferredTrimmed)) {
      return preferredTrimmed;
    }

    for (const candidate of PREFERRED_MODELS) {
      const match = names.find(
        (name) => name === candidate || name.startsWith(`${candidate}:`) || name.startsWith(candidate),
      );
      if (match) {
        return match;
      }
    }

    return names[0] ?? preferredTrimmed ?? DEFAULT_MODEL;
  } catch {
    return preferredTrimmed || DEFAULT_MODEL;
  }
}

export async function ollamaChat(
  messages: OllamaChatMessage[],
  options?: { model?: string; baseUrl?: string; temperature?: number },
): Promise<string> {
  const baseUrl = options?.baseUrl ?? DEFAULT_OLLAMA_URL;
  const model = await resolveOllamaModel(options?.model, baseUrl);
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      options: {
        temperature: options?.temperature ?? 0.2,
      },
      messages,
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) {
    throw new Error(`Ollama respondeu ${response.status}`);
  }

  const payload = (await response.json()) as {
    message?: { content?: string };
  };
  const content = payload.message?.content?.trim() ?? '';

  if (!content) {
    throw new Error('Ollama retornou resposta vazia');
  }

  return content;
}

export async function ollamaChatText(
  messages: OllamaChatMessage[],
  options?: { model?: string; baseUrl?: string; temperature?: number },
): Promise<string> {
  const baseUrl = options?.baseUrl ?? DEFAULT_OLLAMA_URL;
  const model = await resolveOllamaModel(options?.model, baseUrl);
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.3,
      },
      messages,
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) {
    throw new Error(`Ollama respondeu ${response.status}`);
  }

  const payload = (await response.json()) as {
    message?: { content?: string };
  };
  const content = payload.message?.content?.trim() ?? '';

  if (!content) {
    throw new Error('Ollama retornou resposta vazia');
  }

  return content;
}

export function getDefaultOllamaModel(): string {
  return DEFAULT_MODEL;
}

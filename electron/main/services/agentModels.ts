import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildCliPathEnv } from '../utils/cliPathEnv';
import type { TerminalCommandHint } from './terminalHints';

const execFileAsync = promisify(execFile);
const MAX_MODEL_HINTS = 8;

export type AgentModelProvider = 'cursor' | 'claude' | 'codex' | 'opencode' | 'antigravity';

type ModelBadgeIcon = NonNullable<TerminalCommandHint['badgeIcon']>;

const MODEL_BADGE_COLORS: Record<ModelBadgeIcon, string> = {
  cursor: '#6366f1',
  claude: '#cc785c',
  codex: '#10a37f',
  gemini: '#1c69ff',
  expo: '#7c3aed',
  apple: '#2563eb',
  android: '#059669',
  'mode-agent': '#3b82f6',
  'mode-plan': '#22c55e',
  'mode-ask': '#06b6d4',
  'mode-debug': '#f97316',
  'mode-multitask': '#a855f7',
};

interface AgentModelEntry {
  id: string;
  label: string;
  isCurrent: boolean;
}

export interface AgentModelOption {
  id: string;
  label: string;
}

const CURSOR_FALLBACK_MODELS: AgentModelEntry[] = [
  { id: 'auto', label: 'Auto', isCurrent: false },
  { id: 'composer-2.5-fast', label: 'Composer 2.5 Fast', isCurrent: true },
  { id: 'claude-opus-4-8-thinking-high', label: 'Opus 4.8 Thinking', isCurrent: false },
  { id: 'gpt-5.3-codex', label: 'Codex 5.3', isCurrent: false },
  { id: 'gpt-5.4-high', label: 'GPT-5.4 High', isCurrent: false },
];

const CLAUDE_FALLBACK_MODELS: AgentModelOption[] = [
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'opus', label: 'Opus' },
  { id: 'haiku', label: 'Haiku' },
];

export const DEFAULT_OPENCODE_MODEL_ID = 'opencode/big-pickle';

const OPENCODE_FALLBACK_MODELS: AgentModelOption[] = [
  { id: DEFAULT_OPENCODE_MODEL_ID, label: 'Big Pickle' },
  { id: 'opencode/mimo-v2.5-free', label: 'MiMo v2.5 Free' },
];

const ANTIGRAVITY_FALLBACK_MODELS: AgentModelOption[] = [
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview' },
];

const CODEX_FALLBACK_MODELS: AgentModelOption[] = [
  { id: 'gpt-5.5', label: 'GPT-5.5' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
  { id: 'o3', label: 'o3' },
];

const MODEL_PRIORITY_PATTERNS = [
  /^auto$/,
  /^composer-2\.5-fast$/,
  /^composer-2\.5$/,
  /opus-4-8-thinking-high-fast$/,
  /opus-4-8-thinking-high$/,
  /opus-4-7-thinking-high-fast$/,
  /opus-4-7-thinking-high$/,
  /^gpt-5\.3-codex$/,
  /^gpt-5\.4-high-fast$/,
  /^gpt-5\.4-high$/,
  /^gpt-5\.5-high-fast$/,
  /^gpt-5\.5-high$/,
  /^gpt-5\.2-codex$/,
  /fable-5-medium$/,
];

let cachedCursorModels: AgentModelEntry[] | null = null;
let cursorCacheTimestamp = 0;
let cursorRefreshInFlight: Promise<void> | null = null;

let cachedOpenCodeModels: AgentModelOption[] | null = null;
let openCodeCacheTimestamp = 0;
let openCodeRefreshInFlight: Promise<void> | null = null;

let cachedClaudeModels: AgentModelOption[] | null = null;
let claudeCacheTimestamp = 0;
let claudeRefreshInFlight: Promise<void> | null = null;

let cachedAntigravityModels: AgentModelOption[] | null = null;
let antigravityCacheTimestamp = 0;
let antigravityRefreshInFlight: Promise<void> | null = null;

let cachedCodexModels: AgentModelOption[] | null = null;
let codexCacheTimestamp = 0;
let codexRefreshInFlight: Promise<void> | null = null;

const CACHE_TTL_MS = 60_000;

function parseCursorModelsOutput(output: string): AgentModelEntry[] {
  const models: AgentModelEntry[] = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed || trimmed === 'Available models') {
      continue;
    }

    const match = trimmed.match(/^(\S+)\s+-\s+(.+)$/);

    if (!match?.[1] || !match[2]) {
      continue;
    }

    const id = match[1];
    const rawLabel = match[2];
    const isCurrent = /\(current/i.test(rawLabel);
    const label = rawLabel.replace(/\s*\((current[^)]*)\)\s*$/i, '').trim();

    models.push({ id, label, isCurrent });
  }

  return models;
}

function parseIdListModelsOutput(output: string): AgentModelOption[] {
  const models: AgentModelOption[] = [];
  const seen = new Set<string>();

  for (const line of output.split('\n')) {
    const trimmed = line.trim();

    if (
      !trimmed ||
      /^error:/i.test(trimmed) ||
      trimmed.startsWith('Available') ||
      /^(usage|commands|options|positionals)/i.test(trimmed)
    ) {
      continue;
    }

    const id = trimmed.split(/\s+/)[0]?.trim();

    if (!id || seen.has(id) || !/^[\w.@:+/-]+$/.test(id)) {
      continue;
    }

    seen.add(id);
    const shortLabel = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
    models.push({
      id,
      label: shortLabel
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase()),
    });
  }

  return models;
}

function scheduleCursorModelsRefresh(): void {
  if (cursorRefreshInFlight) {
    return;
  }

  cursorRefreshInFlight = (async () => {
    try {
      const { stdout } = await execFileAsync('cursor-agent', ['models'], {
        encoding: 'utf8',
        env: { ...process.env, PATH: buildCliPathEnv() },
        timeout: 10_000,
        maxBuffer: 2 * 1024 * 1024,
      });

      const parsed = parseCursorModelsOutput(stdout);

      if (parsed.length > 0) {
        cachedCursorModels = parsed;
      } else if (!cachedCursorModels) {
        cachedCursorModels = CURSOR_FALLBACK_MODELS;
      }

      cursorCacheTimestamp = Date.now();
    } catch {
      if (!cachedCursorModels) {
        cachedCursorModels = CURSOR_FALLBACK_MODELS;
      }

      cursorCacheTimestamp = Date.now();
    } finally {
      cursorRefreshInFlight = null;
    }
  })();
}

function loadAvailableCursorModels(): AgentModelEntry[] {
  const now = Date.now();

  if (cachedCursorModels && now - cursorCacheTimestamp < CACHE_TTL_MS) {
    return cachedCursorModels;
  }

  scheduleCursorModelsRefresh();
  return cachedCursorModels ?? CURSOR_FALLBACK_MODELS;
}

function prioritizeModels(models: AgentModelEntry[]): AgentModelEntry[] {
  const picked: AgentModelEntry[] = [];
  const seen = new Set<string>();

  const pushModel = (model: AgentModelEntry | undefined) => {
    if (!model || seen.has(model.id)) {
      return;
    }

    seen.add(model.id);
    picked.push(model);
  };

  pushModel(models.find((model) => model.isCurrent));

  for (const pattern of MODEL_PRIORITY_PATTERNS) {
    pushModel(models.find((model) => !seen.has(model.id) && pattern.test(model.id)));
  }

  const sortedRemaining = [...models]
    .filter((model) => !seen.has(model.id))
    .sort((left, right) => left.label.localeCompare(right.label));

  for (const model of sortedRemaining) {
    if (picked.length >= MAX_MODEL_HINTS) {
      break;
    }

    pushModel(model);
  }

  return picked.slice(0, MAX_MODEL_HINTS);
}

function shortenModelLabel(label: string): string {
  return label
    .replace(/\s*\(NO ZDR\)\s*$/i, '')
    .replace(/\s*1M\s+/i, ' ')
    .replace(/\s+Thinking\s+Fast$/i, ' Fast')
    .replace(/\s+High\s+Fast$/i, ' Fast')
    .replace(/\s+Extra High\s+Fast$/i, ' XHigh Fast')
    .trim();
}

function resolveModelBadgeIcon(modelId: string, label: string): ModelBadgeIcon {
  const id = modelId.toLowerCase();
  const text = label.toLowerCase();

  if (id === 'auto' || text === 'auto') {
    return 'cursor';
  }

  if (id.includes('composer') || text.includes('composer')) {
    return 'cursor';
  }

  if (
    id.includes('claude') ||
    id.includes('opus') ||
    id.includes('sonnet') ||
    id.includes('haiku') ||
    text.includes('opus') ||
    text.includes('claude') ||
    text.includes('sonnet') ||
    text.includes('haiku')
  ) {
    return 'claude';
  }

  if (
    id.includes('codex') ||
    id.includes('gpt') ||
    id.includes('o3') ||
    id.includes('o4') ||
    text.includes('codex') ||
    text.includes('gpt')
  ) {
    return 'codex';
  }

  if (id.includes('gemini') || text.includes('gemini')) {
    return 'gemini';
  }

  return 'cursor';
}

export function getAgentModelHints(): TerminalCommandHint[] {
  const models = prioritizeModels(loadAvailableCursorModels());

  return models.map((model) => {
    const badgeIcon = resolveModelBadgeIcon(model.id, model.label);

    return {
      id: `model-${model.id}`,
      badge: badgeIcon === 'cursor' ? 'C' : badgeIcon === 'claude' ? 'A' : badgeIcon === 'codex' ? 'O' : 'G',
      badgeIcon,
      badgeColor: MODEL_BADGE_COLORS[badgeIcon],
      label: shortenModelLabel(model.label),
      command: `/model ${model.id}\n`,
      hintKind: 'model',
    };
  });
}

function isAgentModelProvider(value: string): value is AgentModelProvider {
  return (
    value === 'cursor' ||
    value === 'claude' ||
    value === 'codex' ||
    value === 'opencode' ||
    value === 'antigravity'
  );
}

async function fetchCliIdModels(
  command: string,
  args: string[],
): Promise<AgentModelOption[]> {
  const { stdout } = await execFileAsync(command, args, {
    encoding: 'utf8',
    env: { ...process.env, PATH: buildCliPathEnv() },
    timeout: 12_000,
    maxBuffer: 2 * 1024 * 1024,
  });

  return parseIdListModelsOutput(stdout);
}

async function loadOpenCodeModels(): Promise<AgentModelOption[]> {
  const now = Date.now();

  if (cachedOpenCodeModels && now - openCodeCacheTimestamp < CACHE_TTL_MS) {
    return cachedOpenCodeModels;
  }

  if (!openCodeRefreshInFlight) {
    openCodeRefreshInFlight = (async () => {
      try {
        const parsed = await fetchCliIdModels('opencode', ['models']);
        cachedOpenCodeModels = parsed.length > 0 ? parsed : OPENCODE_FALLBACK_MODELS;
      } catch {
        cachedOpenCodeModels = cachedOpenCodeModels ?? OPENCODE_FALLBACK_MODELS;
      } finally {
        openCodeCacheTimestamp = Date.now();
        openCodeRefreshInFlight = null;
      }
    })();
  }

  await openCodeRefreshInFlight;
  return cachedOpenCodeModels ?? OPENCODE_FALLBACK_MODELS;
}

async function loadClaudeModels(): Promise<AgentModelOption[]> {
  const now = Date.now();

  if (cachedClaudeModels && now - claudeCacheTimestamp < CACHE_TTL_MS) {
    return cachedClaudeModels;
  }

  if (!claudeRefreshInFlight) {
    claudeRefreshInFlight = (async () => {
      try {
        const parsed = await fetchCliIdModels('claude', ['models']);
        cachedClaudeModels = parsed.length > 0 ? parsed : CLAUDE_FALLBACK_MODELS;
      } catch {
        cachedClaudeModels = cachedClaudeModels ?? CLAUDE_FALLBACK_MODELS;
      } finally {
        claudeCacheTimestamp = Date.now();
        claudeRefreshInFlight = null;
      }
    })();
  }

  await claudeRefreshInFlight;
  return cachedClaudeModels ?? CLAUDE_FALLBACK_MODELS;
}

async function loadAntigravityModels(): Promise<AgentModelOption[]> {
  const now = Date.now();

  if (cachedAntigravityModels && now - antigravityCacheTimestamp < CACHE_TTL_MS) {
    return cachedAntigravityModels;
  }

  if (!antigravityRefreshInFlight) {
    antigravityRefreshInFlight = (async () => {
      try {
        const parsed = await fetchCliIdModels('agy', ['models']);
        cachedAntigravityModels =
          parsed.length > 0 ? parsed : ANTIGRAVITY_FALLBACK_MODELS;
      } catch {
        cachedAntigravityModels =
          cachedAntigravityModels ?? ANTIGRAVITY_FALLBACK_MODELS;
      } finally {
        antigravityCacheTimestamp = Date.now();
        antigravityRefreshInFlight = null;
      }
    })();
  }

  await antigravityRefreshInFlight;
  return cachedAntigravityModels ?? ANTIGRAVITY_FALLBACK_MODELS;
}

async function loadCodexModels(): Promise<AgentModelOption[]> {
  const now = Date.now();

  if (cachedCodexModels && now - codexCacheTimestamp < CACHE_TTL_MS) {
    return cachedCodexModels;
  }

  if (!codexRefreshInFlight) {
    codexRefreshInFlight = (async () => {
      try {
        const parsed = await fetchCliIdModels('codex', ['models']);
        cachedCodexModels = parsed.length > 0 ? parsed : CODEX_FALLBACK_MODELS;
      } catch {
        cachedCodexModels = cachedCodexModels ?? CODEX_FALLBACK_MODELS;
      } finally {
        codexCacheTimestamp = Date.now();
        codexRefreshInFlight = null;
      }
    })();
  }

  await codexRefreshInFlight;
  return cachedCodexModels ?? CODEX_FALLBACK_MODELS;
}

async function loadCursorModelOptions(): Promise<AgentModelOption[]> {
  const now = Date.now();

  if (!cachedCursorModels || now - cursorCacheTimestamp >= CACHE_TTL_MS) {
    scheduleCursorModelsRefresh();

    if (cursorRefreshInFlight) {
      await cursorRefreshInFlight;
    }
  }

  const models = prioritizeModels(loadAvailableCursorModels());

  return models.map((model) => ({
    id: model.id,
    label: shortenModelLabel(model.label),
  }));
}

export async function listAgentModelsForProvider(
  providerInput: string,
): Promise<AgentModelOption[]> {
  const provider = isAgentModelProvider(providerInput) ? providerInput : 'cursor';

  if (provider === 'opencode') {
    return loadOpenCodeModels();
  }

  if (provider === 'claude') {
    return loadClaudeModels();
  }

  if (provider === 'antigravity') {
    return loadAntigravityModels();
  }

  if (provider === 'codex') {
    return loadCodexModels();
  }

  return loadCursorModelOptions();
}

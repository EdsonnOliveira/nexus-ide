import { execFileSync } from 'node:child_process';
import { buildCliPathEnv } from '../utils/cliPathEnv';
import type { TerminalCommandHint } from './terminalHints';

const MAX_MODEL_HINTS = 8;

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

const FALLBACK_MODELS: AgentModelEntry[] = [
  { id: 'auto', label: 'Auto', isCurrent: false },
  { id: 'composer-2.5-fast', label: 'Composer 2.5 Fast', isCurrent: true },
  { id: 'claude-opus-4-8-thinking-high', label: 'Opus 4.8 Thinking', isCurrent: false },
  { id: 'gpt-5.3-codex', label: 'Codex 5.3', isCurrent: false },
  { id: 'gpt-5.4-high', label: 'GPT-5.4 High', isCurrent: false },
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

let cachedModels: AgentModelEntry[] | null = null;
let cacheTimestamp = 0;

const CACHE_TTL_MS = 60_000;

function parseModelsOutput(output: string): AgentModelEntry[] {
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

function loadAvailableModels(): AgentModelEntry[] {
  const now = Date.now();

  if (cachedModels && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedModels;
  }

  try {
    const output = execFileSync('cursor-agent', ['models'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: buildCliPathEnv() },
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    });

    const parsed = parseModelsOutput(output);

    if (parsed.length > 0) {
      cachedModels = parsed;
      cacheTimestamp = now;
      return parsed;
    }
  } catch {
    return FALLBACK_MODELS;
  }

  return FALLBACK_MODELS;
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
  const models = prioritizeModels(loadAvailableModels());

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

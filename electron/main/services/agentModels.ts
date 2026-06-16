import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import type { TerminalCommandHint } from './terminalHints';

const MAX_MODEL_HINTS = 8;
const MODEL_BADGE_COLOR = '#6366f1';

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

function buildDetectionPathEnv(): string {
  const home = os.homedir();
  const segments = new Set<string>();

  for (const segment of (process.env.PATH ?? '').split(':')) {
    if (segment) {
      segments.add(segment);
    }
  }

  for (const segment of [
    path.join(home, '.local', 'bin'),
    path.join(home, '.cursor', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ]) {
    segments.add(segment);
  }

  return Array.from(segments).join(':');
}

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
      env: { ...process.env, PATH: buildDetectionPathEnv() },
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

export function getAgentModelHints(): TerminalCommandHint[] {
  const models = prioritizeModels(loadAvailableModels());

  return models.map((model) => ({
    id: `model-${model.id}`,
    badge: 'M',
    badgeColor: MODEL_BADGE_COLOR,
    label: shortenModelLabel(model.label),
    command: `/model ${model.id}\n`,
    hintKind: 'model',
  }));
}

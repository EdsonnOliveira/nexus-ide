import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export type CliAgentBadgeIcon = 'cursor' | 'claude' | 'codex' | 'gemini';

export interface CliAgentDefinition {
  id: string;
  command: string;
  label: string;
  badgeIcon: CliAgentBadgeIcon;
  badgeColor: string;
}

const CLI_AGENT_DEFINITIONS: CliAgentDefinition[] = [
  {
    id: 'cursor-agent',
    command: 'cursor-agent',
    label: 'cursor-agent',
    badgeIcon: 'cursor',
    badgeColor: '#1a1a1a',
  },
  {
    id: 'claude',
    command: 'claude',
    label: 'claude',
    badgeIcon: 'claude',
    badgeColor: '#cc785c',
  },
  {
    id: 'codex',
    command: 'codex',
    label: 'codex',
    badgeIcon: 'codex',
    badgeColor: '#10a37f',
  },
  {
    id: 'gemini',
    command: 'gemini',
    label: 'gemini',
    badgeIcon: 'gemini',
    badgeColor: '#1c69ff',
  },
];

let cachedAvailableCommands: Set<string> | null = null;
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

function isCommandAvailable(command: string, pathEnv: string): boolean {
  if (!/^[a-zA-Z0-9._-]+$/.test(command)) {
    return false;
  }

  try {
    const result = execFileSync('/usr/bin/which', [command], {
      encoding: 'utf8',
      env: { ...process.env, PATH: pathEnv },
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    return Boolean(result);
  } catch {
    return false;
  }
}

function getAvailableCommands(): Set<string> {
  const now = Date.now();

  if (cachedAvailableCommands && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedAvailableCommands;
  }

  const pathEnv = buildDetectionPathEnv();
  const available = new Set<string>();

  for (const agent of CLI_AGENT_DEFINITIONS) {
    if (isCommandAvailable(agent.command, pathEnv)) {
      available.add(agent.command);
    }
  }

  cachedAvailableCommands = available;
  cacheTimestamp = now;

  return available;
}

export function getInstalledCliAgentDefinitions(): CliAgentDefinition[] {
  const available = getAvailableCommands();

  return CLI_AGENT_DEFINITIONS.filter((agent) => available.has(agent.command));
}

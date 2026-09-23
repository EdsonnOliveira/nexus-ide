import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';

const AGENT_HOMES_DIR = 'agent-homes';

const SHARED_HOME_LINKS = ['.ssh', '.gitconfig', '.npmrc'] as const;

function sanitizeIsolationKey(isolationKey: string): string {
  const trimmed = isolationKey.trim();

  if (!trimmed || !/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    throw new Error('Invalid agent shell isolation key');
  }

  return trimmed;
}

function getAgentHomesRoot(): string {
  return path.join(app.getPath('userData'), AGENT_HOMES_DIR);
}

export function resolveAgentShellHomePath(isolationKey: string): string {
  return path.join(getAgentHomesRoot(), sanitizeIsolationKey(isolationKey));
}

function ensureSharedHomeLink(agentHome: string, realHome: string, relativeName: string): void {
  const source = path.join(realHome, relativeName);
  const target = path.join(agentHome, relativeName);

  if (!existsSync(source)) {
    return;
  }

  try {
    lstatSync(target);
    return;
  } catch {
  }

  try {
    symlinkSync(source, target);
  } catch {
  }
}

export function ensureAgentShellHome(isolationKey: string): string {
  const agentHome = resolveAgentShellHomePath(isolationKey);
  const realHome = os.homedir();

  mkdirSync(agentHome, { recursive: true });
  mkdirSync(path.join(agentHome, '.config'), { recursive: true });
  mkdirSync(path.join(agentHome, '.local', 'share'), { recursive: true });

  for (const relativeName of SHARED_HOME_LINKS) {
    ensureSharedHomeLink(agentHome, realHome, relativeName);
  }

  return agentHome;
}

export function removeAgentShellHome(isolationKey: string): void {
  let agentHome: string;

  try {
    agentHome = resolveAgentShellHomePath(isolationKey);
  } catch {
    return;
  }

  try {
    rmSync(agentHome, { recursive: true, force: true });
  } catch {
  }
}

export function applyAgentShellHomeEnv(
  env: Record<string, string>,
  agentHome: string,
): Record<string, string> {
  return {
    ...env,
    HOME: agentHome,
    USERPROFILE: agentHome,
    XDG_CONFIG_HOME: path.join(agentHome, '.config'),
    XDG_DATA_HOME: path.join(agentHome, '.local', 'share'),
  };
}

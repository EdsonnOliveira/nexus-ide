import { createConnection } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { AgentSessionBundle } from '@nexus/supabase';

const DEFAULT_SOCKET = path.join(os.homedir(), '.nexus-runtime.sock');

export interface LocalRuntimeStatus {
  online: boolean;
  deviceId: string | null;
  workspaceId: string | null;
  hostname: string | null;
  name: string | null;
  lastSeenAt: string | null;
  capabilities: Record<string, boolean>;
  activeAgents: number;
  activeTerminals: number;
}

function requestRuntimeJson<T>(
  command: string,
  socketPath = process.env.NEXUS_RUNTIME_SOCKET ?? DEFAULT_SOCKET,
  timeoutMs = 4000,
): Promise<T | null> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    let settled = false;
    let buffer = '';

    const finish = (value: T | null) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
      socket.write(`${command}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');

      let newlineIndex = buffer.indexOf('\n');

      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line) {
          newlineIndex = buffer.indexOf('\n');
          continue;
        }

        try {
          finish(JSON.parse(line) as T);
          return;
        } catch {
          finish(null);
          return;
        }
      }
    });
    socket.on('timeout', () => finish(null));
    socket.on('error', () => finish(null));
  });
}

export function getLocalRuntimeStatus(
  socketPath = process.env.NEXUS_RUNTIME_SOCKET ?? DEFAULT_SOCKET,
): Promise<LocalRuntimeStatus> {
  const fallback: LocalRuntimeStatus = {
    online: false,
    deviceId: null,
    workspaceId: null,
    hostname: os.hostname(),
    name: null,
    lastSeenAt: null,
    capabilities: {},
    activeAgents: 0,
    activeTerminals: 0,
  };

  return requestRuntimeJson<Partial<LocalRuntimeStatus> & { type?: string }>(
    'status',
    socketPath,
    800,
  ).then((parsed) => {
    if (!parsed) {
      return fallback;
    }

    return {
      online: true,
      deviceId: parsed.deviceId ?? null,
      workspaceId: parsed.workspaceId ?? null,
      hostname: parsed.hostname ?? os.hostname(),
      name: parsed.name ?? null,
      lastSeenAt: parsed.lastSeenAt ?? new Date().toISOString(),
      capabilities: parsed.capabilities ?? {},
      activeAgents: parsed.activeAgents ?? 0,
      activeTerminals: parsed.activeTerminals ?? 0,
    };
  });
}

export async function listOpenAgentSessionsFromRuntime(
  socketPath = process.env.NEXUS_RUNTIME_SOCKET ?? DEFAULT_SOCKET,
): Promise<AgentSessionBundle[]> {
  const response = await requestRuntimeJson<{
    type?: string;
    bundles?: AgentSessionBundle[];
    message?: string;
  }>('open_agent_sessions', socketPath, 15000);

  if (!response || response.type === 'error' || !Array.isArray(response.bundles)) {
    return [];
  }

  return response.bundles;
}

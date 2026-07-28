import { createConnection, type Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_SOCKET = path.join(os.homedir(), '.nexus-desktop.sock');

export type DesktopEmulatorPushHandler = (message: Record<string, unknown>) => void;

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function getDesktopSocketPath(): string {
  return process.env.NEXUS_DESKTOP_SOCKET ?? DEFAULT_SOCKET;
}

export async function requestDesktopJson(
  type: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 60000,
): Promise<Record<string, unknown>> {
  const socketPath = getDesktopSocketPath();
  const id = randomUUID();

  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = '';
    let settled = false;

    const finish = (error: Error | null, value?: Record<string, unknown>) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        socket.destroy();
      } catch {
      }
      if (error) {
        reject(error);
        return;
      }
      resolve(value ?? {});
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id, type, payload })}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');
        if (!line) {
          continue;
        }
        try {
          const parsed = JSON.parse(line) as {
            id?: string;
            ok?: boolean;
            result?: unknown;
            error?: string;
            type?: string;
          };
          if (parsed.id && parsed.id !== id) {
            continue;
          }
          if (parsed.ok === false) {
            finish(new Error(parsed.error || 'Desktop command failed'));
            return;
          }
          const result =
            parsed.result && typeof parsed.result === 'object'
              ? (parsed.result as Record<string, unknown>)
              : { value: parsed.result };
          finish(null, result);
          return;
        } catch {
          finish(new Error('Invalid response from Desktop'));
          return;
        }
      }
    });
    socket.on('timeout', () => finish(new Error('Timeout ao falar com o Nexus Desktop')));
    socket.on('error', () =>
      finish(new Error('Nexus Desktop não está aberto ou socket indisponível')),
    );
  });
}

class DesktopEmulatorStream {
  #socket: Socket | null = null;
  #buffer = '';
  #pending = new Map<string, PendingRequest>();
  #handlers = new Set<DesktopEmulatorPushHandler>();
  #connecting: Promise<void> | null = null;

  onPush(handler: DesktopEmulatorPushHandler): () => void {
    this.#handlers.add(handler);
    void this.#ensureConnected();
    return () => {
      this.#handlers.delete(handler);
      if (this.#handlers.size === 0) {
        this.#disconnect();
      }
    };
  }

  async ensureConnected(): Promise<void> {
    await this.#ensureConnected();
  }

  pushCommand(type: string, payload: Record<string, unknown> = {}): void {
    const socket = this.#socket;
    if (!socket || socket.destroyed) {
      void this.#ensureConnected()
        .then(() => {
          this.pushCommand(type, payload);
        })
        .catch(() => undefined);
      return;
    }
    try {
      socket.write(
        `${JSON.stringify({ id: randomUUID(), type, payload })}\n`,
      );
    } catch {
    }
  }

  async #ensureConnected(): Promise<void> {
    if (this.#socket && !this.#socket.destroyed) {
      return;
    }
    if (this.#connecting) {
      await this.#connecting;
      return;
    }

    this.#connecting = new Promise((resolve, reject) => {
      const socket = createConnection(getDesktopSocketPath());
      socket.on('connect', () => {
        this.#socket = socket;
        this.#connecting = null;
        const id = randomUUID();
        socket.write(`${JSON.stringify({ id, type: 'emulator.subscribe', payload: {} })}\n`);
        resolve();
      });
      socket.on('data', (chunk) => {
        this.#buffer += chunk.toString('utf8');
        let newlineIndex = this.#buffer.indexOf('\n');
        while (newlineIndex >= 0) {
          const line = this.#buffer.slice(0, newlineIndex).trim();
          this.#buffer = this.#buffer.slice(newlineIndex + 1);
          newlineIndex = this.#buffer.indexOf('\n');
          if (!line) {
            continue;
          }
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            const id = typeof parsed.id === 'string' ? parsed.id : null;
            if (id && this.#pending.has(id)) {
              const pending = this.#pending.get(id)!;
              clearTimeout(pending.timer);
              this.#pending.delete(id);
              if (parsed.ok === false) {
                pending.reject(new Error(String(parsed.error ?? 'Desktop command failed')));
              } else {
                const result =
                  parsed.result && typeof parsed.result === 'object'
                    ? (parsed.result as Record<string, unknown>)
                    : {};
                pending.resolve(result);
              }
              continue;
            }
            if (
              parsed.type === 'emulator.frame' ||
              parsed.type === 'emulator.state' ||
              parsed.type === 'emulator.closed'
            ) {
              for (const handler of this.#handlers) {
                try {
                  handler(parsed);
                } catch {
                }
              }
            }
          } catch {
          }
        }
      });
      socket.on('error', (error) => {
        this.#connecting = null;
        this.#failPending(error instanceof Error ? error : new Error(String(error)));
        this.#socket = null;
        reject(error);
      });
      socket.on('close', () => {
        this.#socket = null;
        this.#failPending(new Error('Conexão com Desktop encerrada'));
      });
    });

    await this.#connecting;
  }

  #failPending(error: Error): void {
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #disconnect(): void {
    if (this.#socket) {
      try {
        this.#socket.destroy();
      } catch {
      }
    }
    this.#socket = null;
    this.#failPending(new Error('Stream Desktop desconectado'));
  }
}

const desktopEmulatorStream = new DesktopEmulatorStream();

export function subscribeDesktopEmulatorPush(
  handler: DesktopEmulatorPushHandler,
): () => void {
  return desktopEmulatorStream.onPush(handler);
}

export async function ensureDesktopEmulatorStream(): Promise<void> {
  await desktopEmulatorStream.ensureConnected();
}

export function pushDesktopEmulatorCommand(
  type: string,
  payload: Record<string, unknown> = {},
): void {
  desktopEmulatorStream.pushCommand(type, payload);
}

export async function isDesktopOnline(): Promise<boolean> {
  try {
    await requestDesktopJson('ping', {}, 800);
    return true;
  } catch {
    return false;
  }
}

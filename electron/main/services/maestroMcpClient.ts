import { type ChildProcess, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { buildCliPathEnv } from '../utils/cliPathEnv';

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { message?: string };
}

interface McpToolContent {
  type?: string;
  text?: string;
}

interface McpToolResult {
  content?: McpToolContent[];
  isError?: boolean;
}

export interface MaestroMcpDevice {
  device_id: string;
  name: string;
  platform: 'ios' | 'android' | 'web';
  connected: boolean;
}

export interface MaestroInspectElement {
  b?: string;
  txt?: string;
  rid?: string;
  a11y?: string;
  hint?: string;
  focused?: boolean;
  clickable?: boolean;
  c?: MaestroInspectElement[];
}

export interface MaestroInspectScreen {
  ui_schema?: {
    platform?: string;
  };
  elements: MaestroInspectElement[];
}

class MaestroMcpClient {
  private process: ChildProcess | null = null;
  private readyPromise: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private idleTimer: NodeJS.Timeout | null = null;

  private scheduleIdleShutdown(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    this.idleTimer = setTimeout(() => {
      this.dispose();
    }, 60_000);
  }

  private async ensureReady(): Promise<void> {
    if (this.process && this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = new Promise<void>((resolve, reject) => {
      let child: ChildProcess;

      try {
        child = spawn('maestro', ['mcp', '--no-viewer'], {
          env: {
            ...process.env,
            PATH: buildCliPathEnv(process.env.PATH),
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Failed to start Maestro MCP'));
        return;
      }

      this.process = child;

      const stdoutReader = createInterface({ input: child.stdout! });

      stdoutReader.on('line', (line) => {
        let payload: JsonRpcResponse;

        try {
          payload = JSON.parse(line) as JsonRpcResponse;
        } catch {
          return;
        }

        if (typeof payload.id !== 'number') {
          return;
        }

        const pending = this.pending.get(payload.id);

        if (!pending) {
          return;
        }

        this.pending.delete(payload.id);

        if (payload.error) {
          pending.reject(new Error(payload.error.message ?? 'Maestro MCP request failed'));
          return;
        }

        pending.resolve(payload.result);
      });

      child.on('exit', () => {
        this.process = null;
        this.readyPromise = null;

        for (const [, pending] of this.pending) {
          pending.reject(new Error('Maestro MCP process exited'));
        }

        this.pending.clear();
      });

      child.on('error', () => {
        this.process = null;
        this.readyPromise = null;
      });

      const initializeId = this.nextId++;

      this.pending.set(initializeId, {
        resolve: () => {
          child.stdin.write(
            `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`,
          );
          resolve();
        },
        reject,
      });

      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: initializeId,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'nexus-ide', version: '1.0.0' },
          },
        })}\n`,
      );
    });

    return this.readyPromise;
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    await this.ensureReady();

    if (!this.process?.stdin?.writable) {
      throw new Error('Maestro MCP is not available');
    }

    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });

      this.process!.stdin!.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          params,
        })}\n`,
      );

      setTimeout(() => {
        if (!this.pending.has(id)) {
          return;
        }

        this.pending.delete(id);
        reject(new Error(`Maestro MCP request timed out: ${method}`));
      }, 25_000);
    });
  }

  private parseToolText(result: unknown): string {
    const toolResult = result as McpToolResult;
    const text = toolResult.content?.find((entry) => typeof entry.text === 'string')?.text;

    if (!text) {
      throw new Error('Maestro MCP returned empty tool response');
    }

    if (toolResult.isError) {
      throw new Error(text);
    }

    return text;
  }

  async listDevices(): Promise<MaestroMcpDevice[]> {
    this.scheduleIdleShutdown();

    const result = await this.request('tools/call', {
      name: 'list_devices',
      arguments: {},
    });

    const parsed = JSON.parse(this.parseToolText(result)) as { devices?: MaestroMcpDevice[] };

    return parsed.devices ?? [];
  }

  async inspectScreen(deviceId: string): Promise<MaestroInspectScreen> {
    this.scheduleIdleShutdown();

    const result = await this.request('tools/call', {
      name: 'inspect_screen',
      arguments: { device_id: deviceId },
    });

    return JSON.parse(this.parseToolText(result)) as MaestroInspectScreen;
  }

  dispose(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    if (!this.process) {
      return;
    }

    this.process.kill('SIGTERM');
    this.process = null;
    this.readyPromise = null;

    for (const [, pending] of this.pending) {
      pending.reject(new Error('Maestro MCP disposed'));
    }

    this.pending.clear();
  }
}

export const maestroMcpClient = new MaestroMcpClient();

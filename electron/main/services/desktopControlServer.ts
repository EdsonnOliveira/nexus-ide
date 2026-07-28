import { createServer, type Server, type Socket } from 'node:net';
import { existsSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EmulatorPlatform } from '../../types';
import { getEmulatorSetupStatus, listEmulatorDevices } from './emulatorDevices';
import { emulatorSessionManager } from './emulatorSessionManager';

const DEFAULT_SOCKET = path.join(os.homedir(), '.nexus-desktop.sock');

type DesktopRequest = {
  id?: string;
  type: string;
  payload?: Record<string, unknown>;
};

type DesktopResponse = {
  id?: string;
  type: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

function writeLine(socket: Socket, payload: unknown): void {
  if (socket.destroyed) {
    return;
  }
  try {
    socket.write(`${JSON.stringify(payload)}\n`);
  } catch {
  }
}

function asPlatform(value: unknown): EmulatorPlatform {
  return value === 'ios' ? 'ios' : 'android';
}

async function handleRequest(request: DesktopRequest): Promise<DesktopResponse> {
  const id = request.id;
  const payload = request.payload ?? {};

  try {
    switch (request.type) {
      case 'ping':
        return { id, type: 'pong', ok: true, result: { online: true } };
      case 'emulator.list_sessions':
        return {
          id,
          type: 'emulator.list_sessions',
          ok: true,
          result: { sessions: emulatorSessionManager.listActiveSessions() },
        };
      case 'emulator.list_devices':
        return {
          id,
          type: 'emulator.list_devices',
          ok: true,
          result: { devices: await listEmulatorDevices(asPlatform(payload.platform)) },
        };
      case 'emulator.setup_status':
        return {
          id,
          type: 'emulator.setup_status',
          ok: true,
          result: getEmulatorSetupStatus(),
        };
      case 'emulator.start': {
        const platform = asPlatform(payload.platform);
        const deviceId = String(payload.device_id ?? payload.deviceId ?? '');
        if (!deviceId) {
          throw new Error('device_id é obrigatório');
        }
        const tabId = String(payload.tab_id ?? payload.tabId ?? randomUUID());
        const localProjectId =
          typeof payload.local_project_id === 'string'
            ? payload.local_project_id
            : typeof payload.localProjectId === 'string'
              ? payload.localProjectId
              : null;

        emulatorSessionManager.notifyEnsureRemoteTab({
          tabId,
          platform,
          deviceId,
          localProjectId,
        });

        const sessionId = await emulatorSessionManager.start(
          tabId,
          platform,
          deviceId,
          localProjectId,
        );
        if (localProjectId) {
          emulatorSessionManager.setSessionLocalProjectId(sessionId, localProjectId);
        }
        emulatorSessionManager.notifyEnsureRemoteTab({
          tabId,
          platform,
          deviceId,
          sessionId,
          localProjectId,
        });

        return {
          id,
          type: 'emulator.start',
          ok: true,
          result: {
            session_id: sessionId,
            tab_id: tabId,
            local_project_id: localProjectId,
          },
        };
      }
      case 'emulator.stop': {
        await emulatorSessionManager.stop(String(payload.session_id ?? payload.sessionId ?? ''));
        return { id, type: 'emulator.stop', ok: true, result: { ok: true } };
      }
      case 'emulator.attach': {
        const sessionId = String(payload.session_id ?? payload.sessionId ?? '');
        const snapshot = emulatorSessionManager.getSessionSnapshot(sessionId);
        if (!snapshot) {
          throw new Error('Sessão de emulador não encontrada');
        }
        return { id, type: 'emulator.attach', ok: true, result: snapshot };
      }
      case 'emulator.tap': {
        await emulatorSessionManager.tap(
          String(payload.session_id ?? payload.sessionId ?? ''),
          Number(payload.x ?? 0),
          Number(payload.y ?? 0),
        );
        return { id, type: 'emulator.tap', ok: true, result: { ok: true } };
      }
      case 'emulator.swipe': {
        await emulatorSessionManager.swipe(
          String(payload.session_id ?? payload.sessionId ?? ''),
          Number(payload.x1 ?? 0),
          Number(payload.y1 ?? 0),
          Number(payload.x2 ?? 0),
          Number(payload.y2 ?? 0),
          Number(payload.duration_ms ?? payload.durationMs ?? 300),
        );
        return { id, type: 'emulator.swipe', ok: true, result: { ok: true } };
      }
      case 'emulator.type': {
        await emulatorSessionManager.typeText(
          String(payload.session_id ?? payload.sessionId ?? ''),
          String(payload.text ?? ''),
        );
        return { id, type: 'emulator.type', ok: true, result: { ok: true } };
      }
      case 'emulator.press_home': {
        await emulatorSessionManager.pressHome(
          String(payload.session_id ?? payload.sessionId ?? ''),
        );
        return { id, type: 'emulator.press_home', ok: true, result: { ok: true } };
      }
      case 'emulator.press_back': {
        await emulatorSessionManager.pressBack(
          String(payload.session_id ?? payload.sessionId ?? ''),
        );
        return { id, type: 'emulator.press_back', ok: true, result: { ok: true } };
      }
      case 'emulator.press_app_switcher': {
        await emulatorSessionManager.pressAppSwitcher(
          String(payload.session_id ?? payload.sessionId ?? ''),
        );
        return { id, type: 'emulator.press_app_switcher', ok: true, result: { ok: true } };
      }
      case 'emulator.rotate': {
        const result = await emulatorSessionManager.rotate(
          String(payload.session_id ?? payload.sessionId ?? ''),
        );
        return { id, type: 'emulator.rotate', ok: true, result };
      }
      case 'emulator.screenshot': {
        const pngBase64 = await emulatorSessionManager.screenshotBase64(
          String(payload.session_id ?? payload.sessionId ?? ''),
        );
        if (!pngBase64) {
          throw new Error('Falha ao capturar screenshot');
        }
        return {
          id,
          type: 'emulator.screenshot',
          ok: true,
          result: { png_base64: pngBase64 },
        };
      }
      case 'emulator.list_apps': {
        const apps = await emulatorSessionManager.listApps(
          String(payload.session_id ?? payload.sessionId ?? ''),
        );
        return { id, type: 'emulator.list_apps', ok: true, result: { apps } };
      }
      case 'emulator.launch_app': {
        await emulatorSessionManager.launchApp(
          String(payload.session_id ?? payload.sessionId ?? ''),
          String(payload.app_id ?? payload.appId ?? ''),
        );
        return { id, type: 'emulator.launch_app', ok: true, result: { ok: true } };
      }
      case 'emulator.terminate_app': {
        await emulatorSessionManager.terminateApp(
          String(payload.session_id ?? payload.sessionId ?? ''),
          String(payload.app_id ?? payload.appId ?? ''),
        );
        return { id, type: 'emulator.terminate_app', ok: true, result: { ok: true } };
      }
      case 'emulator.input': {
        const sessionId = String(payload.session_id ?? payload.sessionId ?? '');
        const action = String(payload.action ?? '');
        const x = Number(payload.x ?? 0);
        const y = Number(payload.y ?? 0);

        if (action === 'down' || action === 'move' || action === 'up') {
          const touchAction =
            action === 'down' ? 'Down' : action === 'move' ? 'Move' : 'Up';
          const line = `touch ${touchAction} ${x},${y}`;
          const accepted = await emulatorSessionManager.sendInput(sessionId, line);
          if (!accepted && action === 'up') {
            const startX = Number(payload.start_x ?? payload.startX ?? x);
            const startY = Number(payload.start_y ?? payload.startY ?? y);
            const dx = Math.abs(x - startX);
            const dy = Math.abs(y - startY);
            if (dx > 0.012 || dy > 0.012) {
              const elapsed = Number(payload.duration_ms ?? payload.durationMs ?? 0);
              const distance = Math.hypot(dx, dy);
              const durationMs = Math.max(
                100,
                Math.min(
                  500,
                  Number.isFinite(elapsed) && elapsed > 0
                    ? Math.round(elapsed)
                    : Math.round(distance * 700),
                ),
              );
              await emulatorSessionManager.swipe(
                sessionId,
                startX,
                startY,
                x,
                y,
                durationMs,
              );
            } else {
              await emulatorSessionManager.tap(sessionId, x, y);
            }
          }
          return { id, type: 'emulator.input', ok: true, result: { ok: true, accepted } };
        }

        if (action === 'tap') {
          await emulatorSessionManager.tap(sessionId, x, y);
          return { id, type: 'emulator.input', ok: true, result: { ok: true } };
        }

        if (action === 'swipe') {
          await emulatorSessionManager.swipe(
            sessionId,
            Number(payload.x1 ?? 0),
            Number(payload.y1 ?? 0),
            Number(payload.x2 ?? 0),
            Number(payload.y2 ?? 0),
            Number(payload.duration_ms ?? payload.durationMs ?? 320),
          );
          return { id, type: 'emulator.input', ok: true, result: { ok: true } };
        }

        return { id, type: 'emulator.input', ok: false, error: `unknown action: ${action}` };
      }
      case 'emulator.subscribe': {
        return { id, type: 'emulator.subscribe', ok: true, result: { ok: true } };
      }
      default:
        return { id, type: 'error', ok: false, error: `unknown type: ${request.type}` };
    }
  } catch (error) {
    return {
      id,
      type: 'error',
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

let server: Server | null = null;
const streamSockets = new Set<Socket>();
let removeFrameListener: (() => void) | null = null;
let removeStateListener: (() => void) | null = null;

function ensureStreamListeners(): void {
  if (!removeFrameListener) {
    removeFrameListener = emulatorSessionManager.addRemoteFrameListener((payload) => {
      const message = {
        type: 'emulator.frame',
        sessionId: payload.sessionId,
        jpegBase64: payload.jpegBase64,
        width: payload.width,
        height: payload.height,
        orientation: payload.orientation,
      };
      for (const socket of streamSockets) {
        writeLine(socket, message);
      }
    });
  }

  if (!removeStateListener) {
    removeStateListener = emulatorSessionManager.addRemoteStateListener((payload) => {
      const message = {
        type: 'emulator.state',
        ...payload,
      };
      for (const socket of streamSockets) {
        writeLine(socket, message);
      }
    });
  }
}

function releaseStreamListenersIfIdle(): void {
  if (streamSockets.size > 0) {
    return;
  }
  removeFrameListener?.();
  removeFrameListener = null;
  removeStateListener?.();
  removeStateListener = null;
}

export function startDesktopControlServer(
  socketPath = process.env.NEXUS_DESKTOP_SOCKET ?? DEFAULT_SOCKET,
): void {
  if (server) {
    return;
  }

  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath);
    } catch {
    }
  }

  server = createServer((socket) => {
    socket.on('error', () => {});
    let buffer = '';

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

        let request: DesktopRequest;
        try {
          request = JSON.parse(line) as DesktopRequest;
        } catch {
          writeLine(socket, { type: 'error', ok: false, error: 'invalid json' });
          continue;
        }

        if (request.type === 'emulator.subscribe') {
          streamSockets.add(socket);
          ensureStreamListeners();
          writeLine(socket, {
            id: request.id,
            type: 'emulator.subscribe',
            ok: true,
            result: { ok: true },
          });
          continue;
        }

        void handleRequest(request).then((response) => {
          writeLine(socket, response);
        });
      }
    });

    socket.on('close', () => {
      streamSockets.delete(socket);
      releaseStreamListenersIfIdle();
    });
  });

  server.listen(socketPath);
}

export function stopDesktopControlServer(): void {
  for (const socket of streamSockets) {
    try {
      socket.destroy();
    } catch {
    }
  }
  streamSockets.clear();
  releaseStreamListenersIfIdle();

  if (server) {
    try {
      server.close();
    } catch {
    }
    server = null;
  }
}

export function getDesktopControlSocketPath(): string {
  return process.env.NEXUS_DESKTOP_SOCKET ?? DEFAULT_SOCKET;
}

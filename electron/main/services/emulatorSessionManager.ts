import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clipboard, nativeImage, type BrowserWindow } from 'electron';
import type {
  EmulatorPlatform,
  EmulatorCaptureBackend,
  EmulatorSessionState,
  EmulatorStreamStats,
  EmulatorVideoCodec,
} from '../../types';
import {
  createAndroidEmulatorSession,
  type EmulatorSessionHandle,
  type EmulatorSessionStartControls,
} from './androidEmulatorSession';
import { recordEmulatorDeviceUsage } from './emulatorDeviceUsageStore';
import { createIosSimulatorSession } from './iosSimulatorSession';

interface ActiveEmulatorSession {
  id: string;
  tabId: string;
  platform: EmulatorPlatform;
  deviceId: string;
  handle: EmulatorSessionHandle;
}

interface PendingEmulatorStart {
  sessionId: string;
  tabId: string;
  cancelled: boolean;
  abort: (() => Promise<void>) | null;
}

type WindowGetter = () => BrowserWindow | null;

class EmulatorSessionManager {
  #sessions = new Map<string, ActiveEmulatorSession>();
  #pendingStarts = new Map<string, PendingEmulatorStart>();
  #getWindow: WindowGetter = () => null;

  setWindowGetter(getter: WindowGetter): void {
    this.#getWindow = getter;
  }

  #emitState(
    sessionId: string,
    tabId: string,
    state: EmulatorSessionState,
    message?: string,
    stats?: EmulatorStreamStats,
  ): void {
    const window = this.#getWindow();

    if (!window || window.isDestroyed()) {
      return;
    }

    window.webContents.send('emulator:session-state', {
      sessionId,
      tabId,
      state,
      message,
      captureBackend: stats?.captureBackend,
      targetFps: stats?.targetFps,
      streamFps: stats?.streamFps,
      fallbackReason: stats?.fallbackReason,
    });
  }

  #emitStreamStats(sessionId: string, tabId: string, stats: EmulatorStreamStats): void {
    const window = this.#getWindow();

    if (!window || window.isDestroyed()) {
      return;
    }

    window.webContents.send('emulator:stream-stats', {
      sessionId,
      tabId,
      captureBackend: stats.captureBackend,
      targetFps: stats.targetFps,
      streamFps: stats.streamFps,
      fallbackReason: stats.fallbackReason,
    });
  }

  #emitVideoChunk(
    sessionId: string,
    chunk: Buffer,
    codec: EmulatorVideoCodec,
    size?: { width: number; height: number },
  ): void {
    const window = this.#getWindow();

    if (!window || window.isDestroyed()) {
      return;
    }

    window.webContents.send('emulator:video-chunk', {
      sessionId,
      codec,
      chunk,
      width: size?.width,
      height: size?.height,
    });

    if (size) {
      window.webContents.send('emulator:frame-size', {
        sessionId,
        width: size.width,
        height: size.height,
      });
    }
  }

  async start(tabId: string, platform: EmulatorPlatform, deviceId: string): Promise<string> {
    for (const [sessionId, session] of this.#sessions) {
      if (session.tabId === tabId) {
        await this.stop(sessionId);
      }
    }

    const pendingExisting = this.#pendingStarts.get(tabId);

    if (pendingExisting) {
      pendingExisting.cancelled = true;

      if (pendingExisting.abort) {
        await pendingExisting.abort();
      }

      this.#emitState(pendingExisting.sessionId, tabId, 'stopped');
      this.#pendingStarts.delete(tabId);
    }

    const sessionId = randomUUID();
    recordEmulatorDeviceUsage(platform, deviceId);
    const window = this.#getWindow();

    if (window && !window.isDestroyed()) {
      window.webContents.send('emulator:session-created', { sessionId, tabId });
    }

    const pending: PendingEmulatorStart = {
      sessionId,
      tabId,
      cancelled: false,
      abort: null,
    };

    this.#pendingStarts.set(tabId, pending);

    const events = {
      onState: (state: EmulatorSessionState, message?: string, stats?: EmulatorStreamStats) => {
        this.#emitState(sessionId, tabId, state, message, stats);
      },
      onStreamStats: (stats: EmulatorStreamStats) => {
        this.#emitStreamStats(sessionId, tabId, stats);
      },
      onVideoChunk: (
        chunk: Buffer,
        codec: EmulatorVideoCodec,
        size?: { width: number; height: number },
      ) => {
        this.#emitVideoChunk(sessionId, chunk, codec, size);
      },
    };

    const controls: EmulatorSessionStartControls = {
      registerAbort: (abort) => {
        pending.abort = abort;
      },
      isCancelled: () => pending.cancelled,
    };

    let handle: EmulatorSessionHandle | null = null;

    try {
      handle =
        platform === 'android'
          ? await createAndroidEmulatorSession(deviceId, events, controls)
          : await createIosSimulatorSession(deviceId, events, controls);

      if (pending.cancelled) {
        await handle.stop();
        return sessionId;
      }

      this.#sessions.set(sessionId, {
        id: sessionId,
        tabId,
        platform,
        deviceId,
        handle,
      });

      return sessionId;
    } catch (error) {
      if (
        pending.cancelled ||
        (error instanceof Error && error.message === 'Session cancelled')
      ) {
        if (handle) {
          await handle.stop().catch(() => undefined);
        }

        return sessionId;
      }

      throw error;
    } finally {
      this.#pendingStarts.delete(tabId);
    }
  }

  async stop(sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);

    if (!session) {
      return;
    }

    await session.handle.stop();
    this.#sessions.delete(sessionId);
    this.#emitState(sessionId, session.tabId, 'stopped');
  }

  async stopByTabId(tabId: string): Promise<void> {
    const pending = this.#pendingStarts.get(tabId);

    if (pending) {
      pending.cancelled = true;

      if (pending.abort) {
        await pending.abort();
      }

      this.#emitState(pending.sessionId, tabId, 'stopped');
      this.#pendingStarts.delete(tabId);
    }

    const targets = [...this.#sessions.entries()].filter(([, session]) => session.tabId === tabId);

    for (const [sessionId] of targets) {
      await this.stop(sessionId);
    }
  }

  async tap(sessionId: string, x: number, y: number): Promise<void> {
    const session = this.#sessions.get(sessionId);
    await session?.handle.tap(x, y);
  }

  async swipe(
    sessionId: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    durationMs: number,
  ): Promise<void> {
    const session = this.#sessions.get(sessionId);
    await session?.handle.swipe(x1, y1, x2, y2, durationMs);
  }

  async pressHome(sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    await session?.handle.pressHome();
  }

  async pressBack(sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    await session?.handle.pressBack();
  }

  async rotate(sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    await session?.handle.rotate();
  }

  async typeText(sessionId: string, text: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    await session?.handle.typeText(text);
  }

  async screenshot(sessionId: string): Promise<boolean> {
    const session = this.#sessions.get(sessionId);

    if (!session) {
      return false;
    }

    const tempPath = path.join(tmpdir(), `nexus-screenshot-${randomUUID()}.png`);

    try {
      await session.handle.takeScreenshot(tempPath);
      const image = nativeImage.createFromPath(tempPath);

      if (image.isEmpty()) {
        return false;
      }

      clipboard.writeImage(image);
      return true;
    } catch {
      return false;
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }
  }

  async stopAll(): Promise<void> {
    const pendingTabIds = [...this.#pendingStarts.keys()];

    for (const tabId of pendingTabIds) {
      await this.stopByTabId(tabId);
    }

    const sessionIds = [...this.#sessions.keys()];

    for (const sessionId of sessionIds) {
      await this.stop(sessionId);
    }
  }
}

export const emulatorSessionManager = new EmulatorSessionManager();

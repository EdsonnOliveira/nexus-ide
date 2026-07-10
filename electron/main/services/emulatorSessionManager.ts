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
  EmulatorAttachResult,
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

interface SessionSnapshot {
  state: EmulatorSessionState;
  message?: string;
  stats?: EmulatorStreamStats;
  frameWidth?: number;
  frameHeight?: number;
}

type WindowGetter = () => BrowserWindow | null;

class EmulatorSessionManager {
  #sessions = new Map<string, ActiveEmulatorSession>();
  #pendingStarts = new Map<string, PendingEmulatorStart>();
  #snapshots = new Map<string, SessionSnapshot>();
  #cancelledSessionIds = new Set<string>();
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
    if (
      this.#cancelledSessionIds.has(sessionId) &&
      state !== 'stopped' &&
      state !== 'error'
    ) {
      return;
    }

    if (state === 'stopped' || state === 'error') {
      this.#cancelledSessionIds.delete(sessionId);
    }

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
      streamUrl: stats?.streamUrl,
    });

    const previous = this.#snapshots.get(sessionId);
    this.#snapshots.set(sessionId, {
      state,
      message,
      stats: stats ?? previous?.stats,
      frameWidth: previous?.frameWidth,
      frameHeight: previous?.frameHeight,
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
      streamUrl: stats.streamUrl,
    });

    const previous = this.#snapshots.get(sessionId);
    this.#snapshots.set(sessionId, {
      state: previous?.state ?? 'running',
      message: previous?.message,
      stats,
      frameWidth: previous?.frameWidth,
      frameHeight: previous?.frameHeight,
    });
  }

  #emitFrameSize(sessionId: string, tabId: string, width: number, height: number): void {
    const window = this.#getWindow();

    if (!window || window.isDestroyed()) {
      return;
    }

    window.webContents.send('emulator:frame-size', {
      sessionId,
      width,
      height,
    });

    const previous = this.#snapshots.get(sessionId);
    this.#snapshots.set(sessionId, {
      state: previous?.state ?? 'running',
      message: previous?.message,
      stats: previous?.stats,
      frameWidth: width,
      frameHeight: height,
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
      this.#emitFrameSize(sessionId, this.#sessions.get(sessionId)?.tabId ?? '', size.width, size.height);
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
      this.#cancelledSessionIds.add(pendingExisting.sessionId);

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
    this.#snapshots.delete(sessionId);
    this.#emitState(sessionId, session.tabId, 'stopped');
  }

  attachTab(tabId: string): EmulatorAttachResult | null {
    const session = [...this.#sessions.values()].find((entry) => entry.tabId === tabId);

    if (session) {
      const snapshot = this.#snapshots.get(session.id);

      if (snapshot) {
        this.#emitState(session.id, tabId, snapshot.state, snapshot.message, snapshot.stats);

        if (snapshot.stats) {
          this.#emitStreamStats(session.id, tabId, snapshot.stats);
        }

        if (snapshot.frameWidth && snapshot.frameHeight) {
          this.#emitFrameSize(session.id, tabId, snapshot.frameWidth, snapshot.frameHeight);
        }
      }

      return this.#toAttachResult(session.id, snapshot);
    }

    const pending = this.#pendingStarts.get(tabId);

    if (pending) {
      return {
        sessionId: pending.sessionId,
        state: 'booting',
      };
    }

    return null;
  }

  #toAttachResult(sessionId: string, snapshot?: SessionSnapshot): EmulatorAttachResult {
    return {
      sessionId,
      state: snapshot?.state ?? 'running',
      message: snapshot?.message,
      captureBackend: snapshot?.stats?.captureBackend,
      targetFps: snapshot?.stats?.targetFps,
      streamFps: snapshot?.stats?.streamFps,
      fallbackReason: snapshot?.stats?.fallbackReason,
      streamUrl: snapshot?.stats?.streamUrl,
      frameWidth: snapshot?.frameWidth,
      frameHeight: snapshot?.frameHeight,
    };
  }

  async stopByTabId(tabId: string): Promise<void> {
    const pending = this.#pendingStarts.get(tabId);

    if (pending) {
      pending.cancelled = true;
      this.#cancelledSessionIds.add(pending.sessionId);

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

  async pressAppSwitcher(sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    await session?.handle.pressAppSwitcher();
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

  async sendInput(sessionId: string, line: string): Promise<boolean> {
    if (line.length === 0 || line.length > 256 || line.includes('\n') || line.includes('\r')) {
      return false;
    }

    const session = this.#sessions.get(sessionId);

    if (!session) {
      return false;
    }

    return session.handle.sendInput(line);
  }

  listActiveSessions(): Array<{
    sessionId: string;
    tabId: string;
    platform: EmulatorPlatform;
    deviceId: string;
  }> {
    return [...this.#sessions.values()].map((session) => ({
      sessionId: session.id,
      tabId: session.tabId,
      platform: session.platform,
      deviceId: session.deviceId,
    }));
  }

  hasPendingBoot(): boolean {
    if (this.#pendingStarts.size > 0) {
      return true;
    }

    for (const snapshot of this.#snapshots.values()) {
      if (snapshot.state === 'booting') {
        return true;
      }
    }

    return false;
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

import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { clipboard, nativeImage, type BrowserWindow } from 'electron';
import type {
  EmulatorPlatform,
  EmulatorCaptureBackend,
  EmulatorDeviceOrientation,
  EmulatorSessionState,
  EmulatorStreamStats,
  EmulatorVideoCodec,
  EmulatorAttachResult,
} from '../../types';
import {
  createAndroidEmulatorSession,
  type EmulatorAppInfo,
  type EmulatorSessionHandle,
  type EmulatorSessionStartControls,
} from './androidEmulatorSession';
import { recordEmulatorDeviceUsage } from './emulatorDeviceUsageStore';
import { createIosSimulatorSession } from './iosSimulatorSession';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';

function userDataProjectsPath(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'nexus-ide', 'projects.json');
}

function collectPaneIds(tabs: unknown): string[] {
  const ids: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') {
      return;
    }
    const record = node as Record<string, unknown>;
    if (typeof record.id === 'string' && record.type !== 'split') {
      ids.push(record.id);
    }
    if (Array.isArray(record.tabs)) {
      for (const child of record.tabs) {
        visit(child);
      }
    }
    if (Array.isArray(record.panes)) {
      for (const child of record.panes) {
        visit(child);
      }
    }
    if (record.first) {
      visit(record.first);
    }
    if (record.second) {
      visit(record.second);
    }
  };
  if (Array.isArray(tabs)) {
    for (const tab of tabs) {
      visit(tab);
    }
  }
  return ids;
}

function findLocalProjectIdByTabId(tabId: string): string | null {
  const filePath = userDataProjectsPath();
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as {
      projects?: Array<{ id?: string; tabs?: unknown }>;
    };
    for (const project of parsed.projects ?? []) {
      if (!project.id) {
        continue;
      }
      if (collectPaneIds(project.tabs).includes(tabId)) {
        return project.id;
      }
    }
  } catch {
  }
  return null;
}

interface ActiveEmulatorSession {
  id: string;
  tabId: string;
  platform: EmulatorPlatform;
  deviceId: string;
  localProjectId: string | null;
  handle: EmulatorSessionHandle;
  capturePaused: boolean;
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
  orientation?: EmulatorDeviceOrientation;
}

export interface RemoteEmulatorFramePayload {
  sessionId: string;
  jpegBase64: string;
  width: number;
  height: number;
  orientation?: EmulatorDeviceOrientation;
}

export interface RemoteEmulatorStatePayload {
  sessionId: string;
  tabId: string;
  state: EmulatorSessionState;
  message?: string;
  platform?: EmulatorPlatform;
  deviceId?: string;
  captureBackend?: EmulatorCaptureBackend;
  streamFps?: number;
  targetFps?: number;
  frameWidth?: number;
  frameHeight?: number;
  orientation?: EmulatorDeviceOrientation;
}

export type RemoteEmulatorFrameListener = (payload: RemoteEmulatorFramePayload) => void;
export type RemoteEmulatorStateListener = (payload: RemoteEmulatorStatePayload) => void;

type WindowGetter = () => BrowserWindow | null;

const REMOTE_FRAME_MIN_INTERVAL_MS = 160;
const REMOTE_JPEG_QUALITY = 42;
const REMOTE_MAX_WIDTH = 360;

class EmulatorSessionManager {
  #sessions = new Map<string, ActiveEmulatorSession>();
  #pendingStarts = new Map<string, PendingEmulatorStart>();
  #snapshots = new Map<string, SessionSnapshot>();
  #cancelledSessionIds = new Set<string>();
  #getWindow: WindowGetter = () => null;
  #remoteViewerCount = 0;
  #remoteFrameListeners = new Set<RemoteEmulatorFrameListener>();
  #remoteStateListeners = new Set<RemoteEmulatorStateListener>();
  #lastRemoteFrameAt = new Map<string, number>();

  setWindowGetter(getter: WindowGetter): void {
    this.#getWindow = getter;
  }

  addRemoteFrameListener(listener: RemoteEmulatorFrameListener): () => void {
    this.#remoteFrameListeners.add(listener);
    this.#remoteViewerCount = this.#remoteFrameListeners.size;
    return () => {
      this.#remoteFrameListeners.delete(listener);
      this.#remoteViewerCount = this.#remoteFrameListeners.size;
    };
  }

  addRemoteStateListener(listener: RemoteEmulatorStateListener): () => void {
    this.#remoteStateListeners.add(listener);
    return () => {
      this.#remoteStateListeners.delete(listener);
    };
  }

  hasRemoteViewers(): boolean {
    return this.#remoteViewerCount > 0;
  }

  #emitRemoteState(
    sessionId: string,
    tabId: string,
    state: EmulatorSessionState,
    message?: string,
  ): void {
    if (this.#remoteStateListeners.size === 0) {
      return;
    }

    const session = this.#sessions.get(sessionId);
    const snapshot = this.#snapshots.get(sessionId);
    const payload: RemoteEmulatorStatePayload = {
      sessionId,
      tabId,
      state,
      message,
      platform: session?.platform,
      deviceId: session?.deviceId,
      captureBackend: snapshot?.stats?.captureBackend,
      streamFps: snapshot?.stats?.streamFps,
      targetFps: snapshot?.stats?.targetFps,
      frameWidth: snapshot?.frameWidth,
      frameHeight: snapshot?.frameHeight,
      orientation: snapshot?.orientation,
    };

    for (const listener of this.#remoteStateListeners) {
      try {
        listener(payload);
      } catch {
      }
    }
  }

  #emitRemoteFrame(
    sessionId: string,
    chunk: Buffer,
    codec: EmulatorVideoCodec,
    size?: { width: number; height: number; orientation?: EmulatorDeviceOrientation },
  ): void {
    if (this.#remoteFrameListeners.size === 0) {
      return;
    }

    const now = Date.now();
    const lastAt = this.#lastRemoteFrameAt.get(sessionId) ?? 0;
    if (now - lastAt < REMOTE_FRAME_MIN_INTERVAL_MS) {
      return;
    }

    try {
      const image = nativeImage.createFromBuffer(chunk);
      if (image.isEmpty()) {
        return;
      }

      let output = image;
      const originalSize = image.getSize();
      const sourceWidth = size?.width || originalSize.width;
      const sourceHeight = size?.height || originalSize.height;
      if (sourceWidth > REMOTE_MAX_WIDTH) {
        const scale = REMOTE_MAX_WIDTH / sourceWidth;
        output = image.resize({
          width: REMOTE_MAX_WIDTH,
          height: Math.max(1, Math.round(sourceHeight * scale)),
          quality: 'better',
        });
      }

      const jpeg = output.toJPEG(REMOTE_JPEG_QUALITY);
      if (!jpeg.length) {
        return;
      }

      const outSize = output.getSize();
      this.#lastRemoteFrameAt.set(sessionId, now);
      const payload: RemoteEmulatorFramePayload = {
        sessionId,
        jpegBase64: jpeg.toString('base64'),
        width: outSize.width,
        height: outSize.height,
        orientation: size?.orientation,
      };

      for (const listener of this.#remoteFrameListeners) {
        try {
          listener(payload);
        } catch {
        }
      }
    } catch {
    }
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

    if (window && !window.isDestroyed()) {
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
    }

    const previous = this.#snapshots.get(sessionId);
    this.#snapshots.set(sessionId, {
      state,
      message,
      stats: stats ?? previous?.stats,
      frameWidth: previous?.frameWidth,
      frameHeight: previous?.frameHeight,
      orientation: previous?.orientation,
    });

    this.#emitRemoteState(sessionId, tabId, state, message);
  }

  #emitStreamStats(sessionId: string, tabId: string, stats: EmulatorStreamStats): void {
    const window = this.#getWindow();

    if (window && !window.isDestroyed()) {
      window.webContents.send('emulator:stream-stats', {
        sessionId,
        tabId,
        captureBackend: stats.captureBackend,
        targetFps: stats.targetFps,
        streamFps: stats.streamFps,
        fallbackReason: stats.fallbackReason,
        streamUrl: stats.streamUrl,
      });
    }

    const previous = this.#snapshots.get(sessionId);
    this.#snapshots.set(sessionId, {
      state: previous?.state ?? 'running',
      message: previous?.message,
      stats,
      frameWidth: previous?.frameWidth,
      frameHeight: previous?.frameHeight,
      orientation: previous?.orientation,
    });
  }

  #emitFrameSize(
    sessionId: string,
    _tabId: string,
    width: number,
    height: number,
    orientation?: EmulatorDeviceOrientation,
  ): void {
    const window = this.#getWindow();

    if (window && !window.isDestroyed()) {
      window.webContents.send('emulator:frame-size', {
        sessionId,
        width,
        height,
        orientation,
      });
    }

    const previous = this.#snapshots.get(sessionId);
    this.#snapshots.set(sessionId, {
      state: previous?.state ?? 'running',
      message: previous?.message,
      stats: previous?.stats,
      frameWidth: width,
      frameHeight: height,
      orientation: orientation ?? previous?.orientation,
    });
  }

  #emitVideoChunk(
    sessionId: string,
    chunk: Buffer,
    codec: EmulatorVideoCodec,
    size?: {
      width: number;
      height: number;
      orientation?: EmulatorDeviceOrientation;
    },
  ): void {
    if (this.#sessions.get(sessionId)?.capturePaused) {
      return;
    }

    const window = this.#getWindow();

    if (window && !window.isDestroyed()) {
      window.webContents.send('emulator:video-chunk', {
        sessionId,
        codec,
        chunk,
        width: size?.width,
        height: size?.height,
        orientation: size?.orientation,
      });
    }

    if (size) {
      this.#emitFrameSize(
        sessionId,
        this.#sessions.get(sessionId)?.tabId ?? '',
        size.width,
        size.height,
        size.orientation,
      );
    }

    this.#emitRemoteFrame(sessionId, chunk, codec, size);
  }

  async start(
    tabId: string,
    platform: EmulatorPlatform,
    deviceId: string,
    localProjectId?: string | null,
  ): Promise<string> {
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
      onFrameSize: (width: number, height: number, orientation?: EmulatorDeviceOrientation) => {
        this.#emitFrameSize(sessionId, tabId, width, height, orientation);
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
        localProjectId: localProjectId ?? findLocalProjectIdByTabId(tabId),
        handle,
        capturePaused: false,
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
    this.#lastRemoteFrameAt.delete(sessionId);
    this.#emitState(sessionId, session.tabId, 'stopped');
  }

  async setCapturePaused(sessionId: string, paused: boolean): Promise<void> {
    const session = this.#sessions.get(sessionId);

    if (!session) {
      return;
    }

    session.capturePaused = paused;
    await session.handle.setCapturePaused(paused);
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
          this.#emitFrameSize(
            session.id,
            tabId,
            snapshot.frameWidth,
            snapshot.frameHeight,
            snapshot.orientation,
          );
        }
      }

      return {
        sessionId: session.id,
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

    const pending = this.#pendingStarts.get(tabId);
    if (!pending) {
      return null;
    }

    const snapshot = this.#snapshots.get(pending.sessionId);
    return {
      sessionId: pending.sessionId,
      state: snapshot?.state ?? 'booting',
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

  getSessionSnapshot(sessionId: string): RemoteEmulatorStatePayload | null {
    const session = this.#sessions.get(sessionId);
    const snapshot = this.#snapshots.get(sessionId);
    if (!session && !snapshot) {
      return null;
    }

    return {
      sessionId,
      tabId: session?.tabId ?? '',
      state: snapshot?.state ?? 'running',
      message: snapshot?.message,
      platform: session?.platform,
      deviceId: session?.deviceId,
      captureBackend: snapshot?.stats?.captureBackend,
      streamFps: snapshot?.stats?.streamFps,
      targetFps: snapshot?.stats?.targetFps,
      frameWidth: snapshot?.frameWidth,
      frameHeight: snapshot?.frameHeight,
      orientation: snapshot?.orientation,
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

  async rotate(
    sessionId: string,
  ): Promise<{ ok: boolean; landscape: boolean; orientation: EmulatorDeviceOrientation }> {
    const session = this.#sessions.get(sessionId);
    return (
      (await session?.handle.rotate()) ?? {
        ok: false,
        landscape: false,
        orientation: 'portrait',
      }
    );
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

  async listApps(sessionId: string): Promise<EmulatorAppInfo[]> {
    const session = this.#sessions.get(sessionId);
    if (!session) {
      return [];
    }
    return session.handle.listApps();
  }

  async launchApp(sessionId: string, appId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    await session?.handle.launchApp(appId);
  }

  async terminateApp(sessionId: string, appId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    await session?.handle.terminateApp(appId);
  }

  setSessionLocalProjectId(sessionId: string, localProjectId: string | null): void {
    const session = this.#sessions.get(sessionId);
    if (!session) {
      return;
    }
    session.localProjectId = localProjectId;
  }

  listActiveSessions(): Array<{
    sessionId: string;
    tabId: string;
    platform: EmulatorPlatform;
    deviceId: string;
    localProjectId: string | null;
    state: EmulatorSessionState;
    frameWidth?: number;
    frameHeight?: number;
  }> {
    return [...this.#sessions.values()].map((session) => {
      const snapshot = this.#snapshots.get(session.id);
      const localProjectId =
        session.localProjectId ?? findLocalProjectIdByTabId(session.tabId);
      if (!session.localProjectId && localProjectId) {
        session.localProjectId = localProjectId;
      }
      return {
        sessionId: session.id,
        tabId: session.tabId,
        platform: session.platform,
        deviceId: session.deviceId,
        localProjectId,
        state: snapshot?.state ?? 'running',
        frameWidth: snapshot?.frameWidth,
        frameHeight: snapshot?.frameHeight,
      };
    });
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

  async screenshotBase64(sessionId: string): Promise<string | null> {
    const session = this.#sessions.get(sessionId);

    if (!session) {
      return null;
    }

    const tempPath = path.join(tmpdir(), `nexus-screenshot-${randomUUID()}.png`);

    try {
      await session.handle.takeScreenshot(tempPath);
      const bytes = await readFile(tempPath);
      if (!bytes.length) {
        return null;
      }
      return bytes.toString('base64');
    } catch {
      return null;
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }
  }

  notifyEnsureRemoteTab(payload: {
    tabId: string;
    platform: EmulatorPlatform;
    deviceId: string;
    sessionId?: string | null;
    localProjectId?: string | null;
  }): void {
    const window = this.#getWindow();
    if (!window || window.isDestroyed()) {
      return;
    }
    window.webContents.send('emulator:ensure-remote-tab', payload);
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

import type { RealtimeChannel } from '@supabase/supabase-js';
import type { NexusClient } from '@nexus/supabase';
import { createEventEnvelope } from '@nexus/protocol';
import {
  subscribeDesktopEmulatorPush,
  ensureDesktopEmulatorStream,
  pushDesktopEmulatorCommand,
} from './desktopControlClient';

type BroadcastFn = (
  client: NexusClient,
  channelName: string,
  envelope: unknown,
) => Promise<void>;

interface ViewerState {
  count: number;
  workspaceId: string;
  deviceId: string;
  projectId: string | null;
  sequence: number;
  channel: RealtimeChannel | null;
}

const viewers = new Map<string, ViewerState>();
let unsubscribePush: (() => void) | null = null;
let clientRef: NexusClient | null = null;

async function sendOnViewerChannel(
  viewer: ViewerState,
  sessionId: string,
  envelope: unknown,
): Promise<void> {
  const channel = viewer.channel;
  if (!channel) {
    return;
  }
  try {
    await channel.send({
      type: 'broadcast',
      event: 'nexus',
      payload: envelope,
    });
  } catch {
    if (clientRef) {
      const fallback = clientRef.channel(`emulator-frame:${sessionId}:${Date.now()}`);
      await fallback.subscribe();
      await fallback.send({
        type: 'broadcast',
        event: 'nexus',
        payload: envelope,
      });
      await clientRef.removeChannel(fallback);
    }
  }
}

function ensurePushSubscription(): void {
  if (unsubscribePush || !clientRef) {
    return;
  }

  const client = clientRef;

  unsubscribePush = subscribeDesktopEmulatorPush((message) => {
    const sessionId = String(message.sessionId ?? '');
    if (!sessionId || !viewers.has(sessionId)) {
      return;
    }

    const viewer = viewers.get(sessionId)!;
    viewer.sequence += 1;

    if (message.type === 'emulator.frame') {
      const jpegBase64 = String(message.jpegBase64 ?? '');
      if (!jpegBase64 || jpegBase64.length > 220_000) {
        return;
      }
      void sendOnViewerChannel(
        viewer,
        sessionId,
        createEventEnvelope({
          workspace_id: viewer.workspaceId,
          device_id: viewer.deviceId,
          project_id: viewer.projectId,
          type: 'emulator.frame',
          sequence: viewer.sequence,
          payload: {
            session_id: sessionId,
            jpeg_base64: jpegBase64,
            width: message.width,
            height: message.height,
            orientation: message.orientation,
          },
        }),
      );
      return;
    }

    if (message.type === 'emulator.state') {
      const state = String(message.state ?? '');
      void sendOnViewerChannel(
        viewer,
        sessionId,
        createEventEnvelope({
          workspace_id: viewer.workspaceId,
          device_id: viewer.deviceId,
          project_id: viewer.projectId,
          type: state === 'stopped' || state === 'error' ? 'emulator.closed' : 'emulator.state',
          sequence: viewer.sequence,
          payload: {
            session_id: sessionId,
            tab_id: message.tabId,
            state: message.state,
            message: message.message,
            platform: message.platform,
            device_id: message.deviceId,
            capture_backend: message.captureBackend,
            stream_fps: message.streamFps,
            target_fps: message.targetFps,
            frame_width: message.frameWidth,
            frame_height: message.frameHeight,
            orientation: message.orientation,
          },
        }),
      );
    }
  });
}

function releasePushIfIdle(): void {
  if (viewers.size > 0) {
    return;
  }
  unsubscribePush?.();
  unsubscribePush = null;
}

function forwardInputToDesktop(sessionId: string, payload: Record<string, unknown>): void {
  const action = String(payload.action ?? '');
  if (!action) {
    return;
  }
  pushDesktopEmulatorCommand('emulator.input', {
    session_id: sessionId,
    ...payload,
  });
}

function createViewerChannel(
  client: NexusClient,
  sessionId: string,
): RealtimeChannel {
  const channel = client.channel(`emulator:${sessionId}`, {
    config: {
      broadcast: { self: false, ack: false },
    },
  });

  channel.on('broadcast', { event: 'input' }, (message) => {
    const payload =
      message.payload && typeof message.payload === 'object'
        ? (message.payload as Record<string, unknown>)
        : {};
    forwardInputToDesktop(sessionId, payload);
  });

  void channel.subscribe();
  return channel;
}

export function configureEmulatorRelay(
  client: NexusClient,
  _broadcast: BroadcastFn,
): void {
  clientRef = client;
}

export async function attachEmulatorViewer(input: {
  sessionId: string;
  workspaceId: string;
  deviceId: string;
  projectId?: string | null;
}): Promise<{ viewers: number }> {
  const existing = viewers.get(input.sessionId);
  if (existing) {
    existing.count += 1;
    ensurePushSubscription();
    await ensureDesktopEmulatorStream().catch(() => undefined);
    return { viewers: existing.count };
  }

  const channel = clientRef ? createViewerChannel(clientRef, input.sessionId) : null;

  viewers.set(input.sessionId, {
    count: 1,
    workspaceId: input.workspaceId,
    deviceId: input.deviceId,
    projectId: input.projectId ?? null,
    sequence: 0,
    channel,
  });
  ensurePushSubscription();
  await ensureDesktopEmulatorStream().catch(() => undefined);
  return { viewers: 1 };
}

export function detachEmulatorViewer(sessionId: string): { viewers: number } {
  const existing = viewers.get(sessionId);
  if (!existing) {
    return { viewers: 0 };
  }
  existing.count -= 1;
  if (existing.count <= 0) {
    if (existing.channel && clientRef) {
      void clientRef.removeChannel(existing.channel);
    }
    viewers.delete(sessionId);
    releasePushIfIdle();
    return { viewers: 0 };
  }
  return { viewers: existing.count };
}

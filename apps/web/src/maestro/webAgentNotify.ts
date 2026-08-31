import { sendPushNotification } from '@nexus/supabase';
import { supabase } from '../lib/supabase';
import type { WebAgentSession } from '../store';
import { triggerWebHaptic } from '../lib/webHaptics';
import { isWebPushSupported } from './webPush';

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined' || !window.AudioContext) {
    return null;
  }
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

function playTone(
  ctx: AudioContext,
  frequency: number,
  startTime: number,
  duration: number,
  volume: number,
): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.02);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function playWebAgentNotificationSound(): void {
  if (prefersReducedMotion()) {
    return;
  }
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }
  void ctx
    .resume()
    .then(() => {
      const now = ctx.currentTime;
      playTone(ctx, 587.33, now, 0.12, 1);
      playTone(ctx, 880, now + 0.1, 0.2, 1);
    })
    .catch(() => undefined);
}

async function showLocalAgentNotification(title: string, body: string): Promise<void> {
  if (!isWebPushSupported() || Notification.permission !== 'granted') {
    return;
  }
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, {
      body,
      icon: '/nexus-icon-192.png',
      badge: '/nexus-icon-192.png',
      tag: 'nexus-agent',
    });
  } catch {
    try {
      new Notification(title, { body, tag: 'nexus-agent' });
    } catch {
      return;
    }
  }
}

export function notifyWebAgentFinished(agent: WebAgentSession, userId: string | null): void {
  const failed = agent.status === 'error';
  const title = failed ? 'Agent falhou' : 'Agent concluiu';
  const body = agent.projectName.trim() || 'Projeto';
  const lastTurn = agent.turns[agent.turns.length - 1];
  const executionId = lastTurn?.id ?? agent.commandId ?? agent.id;

  playWebAgentNotificationSound();
  triggerWebHaptic();
  void showLocalAgentNotification(title, body);

  if (!userId) {
    return;
  }

  void sendPushNotification(supabase, {
    userId,
    kind: 'agent',
    title,
    body,
    dedupeKey: `agent:${executionId}:${failed ? 'failed' : 'completed'}`,
    data: {
      kind: 'agent',
      sessionId: agent.id,
      executionId,
      projectId: agent.projectId,
      status: failed ? 'failed' : 'completed',
      source: agent.source === 'desktop_pane' ? 'desktop' : 'web',
    },
  }).catch(() => undefined);
}

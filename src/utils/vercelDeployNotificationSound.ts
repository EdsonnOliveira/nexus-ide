import type { VercelDeploymentState } from '@/types';

export type VercelDeploySoundKind = 'building' | 'error' | 'deployed';

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

function isReducedMotionPreferred(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function playOscillatorTone(
  ctx: AudioContext,
  type: OscillatorType,
  frequency: number,
  startTime: number,
  duration: number,
  volume: number,
): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startTime);

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  oscillator.connect(gain);
  gain.connect(ctx.destination);

  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.02);
}

function playBuildingSound(ctx: AudioContext, startTime: number): void {
  const pulseCount = 3;
  const pulseDuration = 0.07;
  const pulseGap = 0.11;

  for (let index = 0; index < pulseCount; index += 1) {
    const pulseStart = startTime + index * (pulseDuration + pulseGap);
    playOscillatorTone(ctx, 'triangle', 196, pulseStart, pulseDuration, 0.55);
    playOscillatorTone(ctx, 'triangle', 294, pulseStart + 0.018, pulseDuration * 0.85, 0.28);
  }
}

function playErrorSound(ctx: AudioContext, startTime: number): void {
  playOscillatorTone(ctx, 'sawtooth', 110, startTime, 0.28, 0.42);
  playOscillatorTone(ctx, 'sawtooth', 146.83, startTime + 0.04, 0.32, 0.36);
  playOscillatorTone(ctx, 'square', 98, startTime + 0.16, 0.22, 0.24);
}

function playDeployedSound(ctx: AudioContext, startTime: number): void {
  playOscillatorTone(ctx, 'sine', 392, startTime, 0.14, 0.5);
  playOscillatorTone(ctx, 'sine', 523.25, startTime + 0.1, 0.16, 0.48);
  playOscillatorTone(ctx, 'sine', 659.25, startTime + 0.22, 0.24, 0.44);
  playOscillatorTone(ctx, 'sine', 783.99, startTime + 0.38, 0.32, 0.32);
}

export function getVercelDeploySoundKind(state: VercelDeploymentState): VercelDeploySoundKind {
  if (state === 'READY') {
    return 'deployed';
  }

  if (state === 'ERROR' || state === 'BLOCKED') {
    return 'error';
  }

  return 'building';
}

export function playVercelDeployNotificationSound(kind: VercelDeploySoundKind): void {
  if (isReducedMotionPreferred()) {
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

      switch (kind) {
        case 'building':
          playBuildingSound(ctx, now);
          break;
        case 'error':
          playErrorSound(ctx, now);
          break;
        case 'deployed':
          playDeployedSound(ctx, now);
          break;
      }
    })
    .catch(() => undefined);
}

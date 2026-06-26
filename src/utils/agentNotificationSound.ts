let audioContext: AudioContext | null = null;
let repeatTimer: ReturnType<typeof setInterval> | null = null;
let escalateTimer: ReturnType<typeof setTimeout> | null = null;

const NORMAL_REPEAT_MS = 3_000;
const URGENT_REPEAT_MS = 1_000;
const ESCALATE_AFTER_MS = 20_000;

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

function clearRepeatTimer(): void {
  if (repeatTimer === null) {
    return;
  }

  clearInterval(repeatTimer);
  repeatTimer = null;
}

function clearEscalateTimer(): void {
  if (escalateTimer === null) {
    return;
  }

  clearTimeout(escalateTimer);
  escalateTimer = null;
}

function scheduleRepeatLoop(intervalMs: number): void {
  clearRepeatTimer();

  repeatTimer = setInterval(() => {
    playAgentNotificationSound();
  }, intervalMs);
}

export function playAgentNotificationSound(): void {
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

export function startAgentNotificationSoundLoop(): void {
  if (repeatTimer !== null) {
    return;
  }

  scheduleRepeatLoop(NORMAL_REPEAT_MS);

  escalateTimer = setTimeout(() => {
    escalateTimer = null;

    if (repeatTimer === null) {
      return;
    }

    scheduleRepeatLoop(URGENT_REPEAT_MS);
  }, ESCALATE_AFTER_MS);
}

export function stopAgentNotificationSoundLoop(): void {
  clearRepeatTimer();
  clearEscalateTimer();
}

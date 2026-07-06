let audioContext: AudioContext | null = null;
let alertRepeatTimer: ReturnType<typeof setInterval> | null = null;
let currentIntervalMs = 0;

const ALERT_REPEAT_MS = 30_000;
const ALERT_CRITICAL_MS = 1_000;

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

function playBatteryChime(): void {
  const ctx = getAudioContext();

  if (!ctx) {
    return;
  }

  void ctx
    .resume()
    .then(() => {
      const now = ctx.currentTime;
      playTone(ctx, 440, now, 0.15, 0.5);
      playTone(ctx, 349.23, now + 0.15, 0.15, 0.45);
      playTone(ctx, 293.66, now + 0.3, 0.25, 0.4);
    })
    .catch(() => undefined);
}

export function startBatteryAlertSoundLoop(batteryLevel: number): void {
  const intervalMs = batteryLevel <= 10 ? ALERT_CRITICAL_MS : ALERT_REPEAT_MS;

  if (alertRepeatTimer !== null && currentIntervalMs === intervalMs) {
    return;
  }

  if (alertRepeatTimer !== null) {
    clearInterval(alertRepeatTimer);
    alertRepeatTimer = null;
  }

  currentIntervalMs = intervalMs;
  playBatteryChime();

  alertRepeatTimer = setInterval(() => {
    playBatteryChime();
  }, intervalMs);
}

export function stopBatteryAlertSoundLoop(): void {
  if (alertRepeatTimer === null) {
    return;
  }

  clearInterval(alertRepeatTimer);
  alertRepeatTimer = null;
}

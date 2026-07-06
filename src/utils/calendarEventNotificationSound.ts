let audioContext: AudioContext | null = null;
let alertRepeatTimer: ReturnType<typeof setInterval> | null = null;
let alertStopTimer: ReturnType<typeof setTimeout> | null = null;
let urgentRepeatTimer: ReturnType<typeof setInterval> | null = null;

const ALERT_REPEAT_MS = 1_500;

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

function playTone(
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
  gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  oscillator.connect(gain);
  gain.connect(ctx.destination);

  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.02);
}

function playCalendarChime(): void {
  const ctx = getAudioContext();

  if (!ctx) {
    return;
  }

  void ctx
    .resume()
    .then(() => {
      const now = ctx.currentTime;
      playTone(ctx, 'triangle', 987.77, now, 0.07, 0.42);
      playTone(ctx, 'triangle', 987.77, now + 0.1, 0.07, 0.38);
      playTone(ctx, 'triangle', 1174.66, now + 0.22, 0.32, 0.44);
    })
    .catch(() => undefined);
}

function clearAlertRepeatTimer(): void {
  if (alertRepeatTimer === null) {
    return;
  }

  clearInterval(alertRepeatTimer);
  alertRepeatTimer = null;
}

function clearAlertStopTimer(): void {
  if (alertStopTimer === null) {
    return;
  }

  clearTimeout(alertStopTimer);
  alertStopTimer = null;
}

export function stopCalendarEventAlertSound(): void {
  clearAlertRepeatTimer();
  clearAlertStopTimer();
}

export function playCalendarEventAlertSound(durationMs: number): void {
  if (isReducedMotionPreferred()) {
    return;
  }

  stopCalendarEventAlertSound();
  playCalendarChime();

  if (durationMs > ALERT_REPEAT_MS) {
    alertRepeatTimer = setInterval(() => {
      playCalendarChime();
    }, ALERT_REPEAT_MS);
  }

  alertStopTimer = setTimeout(() => {
    stopCalendarEventAlertSound();
  }, durationMs);
}

export function startCalendarEventUrgentSoundLoop(): void {
  if (isReducedMotionPreferred()) {
    return;
  }

  if (urgentRepeatTimer !== null) {
    return;
  }

  playCalendarChime();
  urgentRepeatTimer = setInterval(() => {
    playCalendarChime();
  }, ALERT_REPEAT_MS);
}

export function stopCalendarEventUrgentSoundLoop(): void {
  if (urgentRepeatTimer === null) {
    return;
  }

  clearInterval(urgentRepeatTimer);
  urgentRepeatTimer = null;
}

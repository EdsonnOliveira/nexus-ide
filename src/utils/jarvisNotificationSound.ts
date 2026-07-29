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
  gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  oscillator.connect(gain);
  gain.connect(ctx.destination);

  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.02);
}

export function playJarvisRequestStartSound(): void {
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }

  void ctx
    .resume()
    .then(() => {
      const now = ctx.currentTime;
      playTone(ctx, 523.25, now, 0.09, 0.55);
      playTone(ctx, 659.25, now + 0.08, 0.12, 0.65);
      playTone(ctx, 783.99, now + 0.17, 0.14, 0.7);
    })
    .catch(() => undefined);
}

export function playJarvisRequestFinishSound(): void {
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }

  void ctx
    .resume()
    .then(() => {
      const now = ctx.currentTime;
      playTone(ctx, 783.99, now, 0.1, 0.6);
      playTone(ctx, 659.25, now + 0.09, 0.12, 0.55);
      playTone(ctx, 523.25, now + 0.18, 0.16, 0.5);
    })
    .catch(() => undefined);
}

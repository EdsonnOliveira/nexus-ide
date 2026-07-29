const TARGET_SAMPLE_RATE = 16_000;
const SPEECH_THRESHOLD = 0.01;
const SILENCE_MS = 1_000;
const MIN_SPEECH_MS = 400;
const MAX_UTTERANCE_MS = 20_000;
const PRE_ROLL_MS = 320;
const WORKLET_NAME = 'jarvis-capture-processor';

export interface JarvisMicCapture {
  stop: () => void;
  setPaused: (paused: boolean) => void;
}

const WORKLET_SOURCE = `
class JarvisCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0];
    const input = channels && channels[0];
    if (input && input.length > 0) {
      const copy = new Float32Array(input.length);
      copy.set(input);
      this.port.postMessage(copy, [copy.buffer]);
    }
    return true;
  }
}
registerProcessor('${WORKLET_NAME}', JarvisCaptureProcessor);
`;

function downsampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
  if (inputSampleRate === TARGET_SAMPLE_RATE) {
    return input;
  }

  const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(length);

  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const mix = position - left;
    output[index] = input[left]! * (1 - mix) + input[right]! * mix;
  }

  return output;
}

function encodeWavBase64(samples: Float32Array, sampleRate: number): string {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }

  return btoa(binary);
}

function rms(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

async function ensureAudioWorklet(audioContext: AudioContext): Promise<void> {
  const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    await audioContext.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function startJarvisMicCapture(
  onUtterance: (wavBase64: string) => void | Promise<void>,
): Promise<JarvisMicCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });

  const audioContext = new AudioContext();
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  await ensureAudioWorklet(audioContext);

  const source = audioContext.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(audioContext, WORKLET_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
  });
  const mute = audioContext.createGain();
  mute.gain.value = 0;

  source.connect(worklet);
  worklet.connect(mute);
  mute.connect(audioContext.destination);

  let stopped = false;
  let paused = false;
  let speaking = false;
  let speechStartedAt = 0;
  let lastVoiceAt = 0;
  let chunks: Float32Array[] = [];
  let preRoll: Float32Array[] = [];
  const framesPerMs = audioContext.sampleRate / 1000;
  const preRollMaxFrames = Math.ceil(PRE_ROLL_MS * framesPerMs);
  let preRollFrames = 0;

  const flushUtterance = () => {
    if (chunks.length === 0) {
      return;
    }

    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    chunks = [];
    speaking = false;
    preRoll = [];
    preRollFrames = 0;

    const downsampled = downsampleTo16k(merged, audioContext.sampleRate);
    if (downsampled.length < TARGET_SAMPLE_RATE * 0.3) {
      return;
    }

    const wavBase64 = encodeWavBase64(downsampled, TARGET_SAMPLE_RATE);
    void onUtterance(wavBase64);
  };

  worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (stopped || paused) {
      return;
    }

    const copy = event.data;
    if (!(copy instanceof Float32Array) || copy.length === 0) {
      return;
    }

    const level = rms(copy);
    const now = performance.now();

    if (level >= SPEECH_THRESHOLD) {
      if (!speaking) {
        speaking = true;
        speechStartedAt = now;
        chunks = [...preRoll, copy];
        preRoll = [];
        preRollFrames = 0;
      } else {
        chunks.push(copy);
      }
      lastVoiceAt = now;

      if (now - speechStartedAt >= MAX_UTTERANCE_MS) {
        flushUtterance();
      }
      return;
    }

    if (speaking) {
      chunks.push(copy);
      if (now - lastVoiceAt >= SILENCE_MS && now - speechStartedAt >= MIN_SPEECH_MS) {
        flushUtterance();
      }
      return;
    }

    preRoll.push(copy);
    preRollFrames += copy.length;
    while (preRollFrames > preRollMaxFrames && preRoll.length > 0) {
      const removed = preRoll.shift();
      preRollFrames -= removed?.length ?? 0;
    }
  };

  return {
    setPaused: (nextPaused: boolean) => {
      paused = nextPaused;
      if (nextPaused) {
        speaking = false;
        chunks = [];
        preRoll = [];
        preRollFrames = 0;
        return;
      }
      if (audioContext.state === 'suspended') {
        void audioContext.resume();
      }
    },
    stop: () => {
      stopped = true;
      try {
        worklet.port.onmessage = null;
        worklet.disconnect();
        source.disconnect();
        mute.disconnect();
      } catch {
      }
      void audioContext.close();
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}

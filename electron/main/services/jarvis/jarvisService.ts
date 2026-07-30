import Store from 'electron-store';
import { BrowserWindow, systemPreferences } from 'electron';
import { getDefaultOllamaModel, isOllamaReachable, resolveOllamaModel } from './ollamaClient';
import {
  classifyJarvisIntent,
  hasNexusWakeWord,
  isListeningCheck,
  summarizeForSpeech,
  type JarvisIntent,
} from './intentClassifier';
import { jarvisVoice } from './jarvisVoicePhrases';
import { speakText } from './tts';
import { resolveWhisperTools, transcribeWavBase64 } from './whisperStt';

export type JarvisPhase =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'executing'
  | 'error';

export interface JarvisStatus {
  enabled: boolean;
  phase: JarvisPhase;
  ollamaReady: boolean;
  whisperReady: boolean;
  ollamaModel: string;
  whisperDetail: string;
  lastTranscript: string | null;
  lastError: string | null;
}

export interface JarvisProcessResult {
  accepted: boolean;
  transcript: string;
  intent: JarvisIntent | null;
  error?: string;
}

interface JarvisPrefs {
  enabled: boolean;
  ollamaModel: string;
  whisperBinary: string | null;
  whisperModel: string | null;
}

const prefsStore = new Store<JarvisPrefs>({
  name: 'jarvis-prefs',
  defaults: {
    enabled: false,
    ollamaModel: getDefaultOllamaModel(),
    whisperBinary: null,
    whisperModel: null,
  },
});

let phase: JarvisPhase = 'idle';
let lastTranscript: string | null = null;
let lastError: string | null = null;
let busy = false;

function cleanHeardTranscript(transcriptRaw: string): string {
  return transcriptRaw
    .trim()
    .replace(/\[\d{2}:\d{2}[^\]]*\]/g, ' ')
    .replace(/^\s*\[(?:BLANK_AUDIO|MUSIC|m[uú]sica|Silence|silence)\]\s*$/gim, '')
    .replace(/^\s*\((?:MUSIC|m[uú]sica|Silence|silence)\)\s*$/gim, '')
    .replace(/^\[|\]$/g, '')
    .replace(/[\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) {
      continue;
    }
    win.webContents.send(channel, payload);
  }
}

function setPhase(next: JarvisPhase): void {
  phase = next;
  broadcast('jarvis:phase', { phase: next });
}

export function getJarvisEnabled(): boolean {
  return Boolean(prefsStore.get('enabled'));
}

export function setJarvisEnabled(enabled: boolean): void {
  prefsStore.set('enabled', enabled);
  if (!enabled) {
    setPhase('idle');
    lastError = null;
  }
}

export async function getJarvisStatus(): Promise<JarvisStatus> {
  const configuredModel = prefsStore.get('ollamaModel') || getDefaultOllamaModel();
  const ollamaModel = await resolveOllamaModel(configuredModel);
  const whisper = await resolveWhisperTools(
    prefsStore.get('whisperBinary'),
    prefsStore.get('whisperModel'),
  );
  const ollamaReady = await isOllamaReachable();

  return {
    enabled: getJarvisEnabled(),
    phase,
    ollamaReady,
    whisperReady: whisper.available,
    ollamaModel,
    whisperDetail: whisper.detail,
    lastTranscript,
    lastError,
  };
}

export async function startJarvisListening(): Promise<JarvisStatus> {
  busy = false;
  setJarvisEnabled(true);

  if (process.platform === 'darwin') {
    try {
      const micStatus = systemPreferences.getMediaAccessStatus('microphone');
      if (micStatus !== 'granted') {
        const granted = await systemPreferences.askForMediaAccess('microphone');
        if (!granted) {
          lastError = 'Permissão de microfone negada no macOS';
          setPhase('error');
          broadcast('jarvis:error', { message: lastError });
          setJarvisEnabled(false);
          return getJarvisStatus();
        }
      }
    } catch {
    }
  }

  const status = await getJarvisStatus();
  if (!status.ollamaReady) {
    lastError = 'Ollama offline';
    setPhase('error');
    broadcast('jarvis:error', { message: lastError });
    return getJarvisStatus();
  }

  if (!status.whisperReady) {
    lastError = status.whisperDetail || 'STT indisponível';
    setPhase('error');
    broadcast('jarvis:error', { message: lastError });
    return getJarvisStatus();
  }

  lastError = null;
  setPhase('listening');
  broadcast('jarvis:listening', { listening: true });
  try {
    await speakText(jarvisVoice.listeningOk());
  } catch {
  }
  return getJarvisStatus();
}

export async function stopJarvisListening(): Promise<JarvisStatus> {
  setJarvisEnabled(false);
  setPhase('idle');
  broadcast('jarvis:listening', { listening: false });
  return getJarvisStatus();
}

export async function processJarvisUtterance(
  wavBase64: string,
  projectNames: string[] = [],
): Promise<JarvisProcessResult> {
  if (busy) {
    return { accepted: false, transcript: '', intent: null, error: 'Jarvis ocupado' };
  }

  busy = true;
  setPhase('processing');
  console.info('[jarvis] utterance received', { bytes: wavBase64.length, projects: projectNames.length });

  try {
    const transcript = await transcribeWavBase64(wavBase64, {
      binary: prefsStore.get('whisperBinary'),
      model: prefsStore.get('whisperModel'),
    });
    return await finishFromTranscript(transcript, projectNames);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao processar voz';
    console.error('[jarvis] utterance failed', message);
    lastError = message;
    setPhase('error');
    broadcast('jarvis:error', { message });
    const spoken = /whisper|modelo|stt|audio|áudio|entender/i.test(message)
      ? jarvisVoice.audioFail()
      : jarvisVoice.askRepeat();
    try {
      await speakText(spoken);
    } catch {
    }
    broadcast('jarvis:finished', { ok: false, error: message });
    return { accepted: false, transcript: lastTranscript ?? '', intent: null, error: message };
  } finally {
    busy = false;
  }
}

export async function processJarvisTranscript(
  transcriptRaw: string,
  projectNames: string[] = [],
): Promise<JarvisProcessResult> {
  if (busy) {
    return { accepted: false, transcript: '', intent: null, error: 'Jarvis ocupado' };
  }

  busy = true;
  setPhase('processing');

  try {
    return await finishFromTranscript(transcriptRaw, projectNames);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao processar voz';
    lastError = message;
    setPhase('error');
    broadcast('jarvis:error', { message });
    try {
      await speakText(jarvisVoice.askRepeat());
    } catch {
    }
    broadcast('jarvis:finished', { ok: false, error: message });
    return { accepted: false, transcript: lastTranscript ?? '', intent: null, error: message };
  } finally {
    busy = false;
  }
}

async function finishFromTranscript(
  transcriptRaw: string,
  projectNames: string[] = [],
): Promise<JarvisProcessResult> {
  const transcript = cleanHeardTranscript(transcriptRaw);
  lastTranscript = transcript;
  broadcast('jarvis:heard', { transcript });

  if (!transcript) {
    setPhase(getJarvisEnabled() ? 'listening' : 'idle');
    return { accepted: false, transcript, intent: null };
  }

  const listeningCheck = isListeningCheck(transcript);
  const hasWake = hasNexusWakeWord(transcript);

  if (!hasWake && !listeningCheck) {
    setPhase(getJarvisEnabled() ? 'listening' : 'idle');
    return { accepted: false, transcript, intent: null };
  }

  if (listeningCheck && !hasWake) {
    const intent: JarvisIntent = {
      mode: 'ping',
      projectQuery: null,
      agentPrompt: '',
      ackPhrase: jarvisVoice.listeningOk(),
      transcript,
    };
    broadcast('jarvis:started', { transcript });
    setPhase('speaking');
    try {
      await speakText(intent.ackPhrase);
    } catch {
    }
    setPhase('executing');
    broadcast('jarvis:intent', { intent });
    return { accepted: true, transcript, intent };
  }

  broadcast('jarvis:started', { transcript });
  setPhase('speaking');

  const immediateAck = listeningCheck
    ? jarvisVoice.listeningOk()
    : jarvisVoice.ack();
  const speakAckPromise = speakText(immediateAck).catch(() => undefined);

  const intent = await classifyJarvisIntent(
    transcript,
    prefsStore.get('ollamaModel'),
    projectNames,
  );
  intent.ackPhrase = immediateAck;

  await speakAckPromise;
  setPhase('executing');
  broadcast('jarvis:intent', { intent });

  return { accepted: true, transcript, intent };
}

export async function speakJarvisSummary(text: string): Promise<string> {
  setPhase('speaking');
  const summary = await summarizeForSpeech(text, prefsStore.get('ollamaModel'));
  await speakText(summary);
  return summary;
}

export async function speakJarvisMessage(text: string): Promise<void> {
  setPhase('speaking');
  await speakText(text);
}

export function notifyJarvisFinished(ok: boolean, error?: string): void {
  if (!ok && error) {
    lastError = error;
  }
  broadcast('jarvis:finished', { ok, error: error ?? null });
  setPhase(getJarvisEnabled() ? 'listening' : 'idle');
}

export function setJarvisOllamaModel(model: string): void {
  const trimmed = model.trim();
  if (trimmed) {
    prefsStore.set('ollamaModel', trimmed);
  }
}

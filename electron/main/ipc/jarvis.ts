import { ipcMain } from 'electron';
import {
  getJarvisStatus,
  notifyJarvisFinished,
  processJarvisTranscript,
  processJarvisUtterance,
  setJarvisOllamaModel,
  speakJarvisMessage,
  speakJarvisSummary,
  startJarvisListening,
  stopJarvisListening,
} from '../services/jarvis/jarvisService';

function asProjectNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 100);
}

function asTrimmedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
}

export function registerJarvisHandlers(): void {
  ipcMain.handle('jarvis:status', () => getJarvisStatus());
  ipcMain.handle('jarvis:start', () => startJarvisListening());
  ipcMain.handle('jarvis:stop', () => stopJarvisListening());
  ipcMain.handle('jarvis:processUtterance', (_, wavBase64: unknown, projectNames?: unknown) => {
    if (typeof wavBase64 !== 'string' || wavBase64.length === 0) {
      return {
        accepted: false,
        transcript: '',
        intent: null,
        error: 'Áudio inválido',
      };
    }

    if (wavBase64.length > 6_000_000) {
      return {
        accepted: false,
        transcript: '',
        intent: null,
        error: 'Áudio muito grande',
      };
    }

    return processJarvisUtterance(wavBase64, asProjectNames(projectNames));
  });
  ipcMain.handle('jarvis:processTranscript', (_, transcript: unknown, projectNames?: unknown) => {
    if (typeof transcript !== 'string') {
      return {
        accepted: false,
        transcript: '',
        intent: null,
        error: 'Transcrição inválida',
      };
    }

    return processJarvisTranscript(transcript.slice(0, 8_000), asProjectNames(projectNames));
  });
  ipcMain.handle('jarvis:speakSummary', (_, text: unknown) => {
    const trimmed = asTrimmedString(text, 12_000);

    if (!trimmed) {
      return '';
    }

    return speakJarvisSummary(trimmed);
  });
  ipcMain.handle('jarvis:speak', (_, text: unknown) => {
    const trimmed = asTrimmedString(text, 2_000);

    if (!trimmed) {
      return;
    }

    return speakJarvisMessage(trimmed);
  });
  ipcMain.handle('jarvis:notifyFinished', (_, ok: unknown, error?: unknown) => {
    notifyJarvisFinished(
      Boolean(ok),
      typeof error === 'string' ? error.slice(0, 500) : undefined,
    );
  });
  ipcMain.handle('jarvis:setOllamaModel', (_, model: unknown) => {
    if (typeof model !== 'string') {
      return;
    }

    setJarvisOllamaModel(model.slice(0, 120));
  });
}

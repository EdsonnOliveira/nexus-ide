import { useCallback, useEffect, useRef } from 'react';
import { useNexusReady } from '@/hooks/useNexusReady';
import { useTabActions } from '@/stores/useTabStore';
import { useJarvisStore } from '@/stores/useJarvisStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { runJarvisIntent } from '@/utils/jarvis/runJarvisIntent';
import {
  startJarvisMicCapture,
  type JarvisMicCapture,
} from '@/utils/jarvis/voiceCapture';
import {
  playJarvisRequestFinishSound,
  playJarvisRequestStartSound,
} from '@/utils/jarvisNotificationSound';

const PROCESS_TIMEOUT_MS = 75_000;

export function useJarvisController(): {
  enabled: boolean;
  phase: string;
  lastError: string | null;
  toggle: () => Promise<void>;
} {
  const nexusReady = useNexusReady();
  const { addAgentTab, selectPane } = useTabActions();
  const enabled = useJarvisStore((state) => state.enabled);
  const phase = useJarvisStore((state) => state.phase);
  const lastError = useJarvisStore((state) => state.lastError);

  const captureRef = useRef<JarvisMicCapture | null>(null);
  const handlingRef = useRef(false);
  const intentRunningRef = useRef(false);
  const enabledRef = useRef(false);
  const addAgentTabRef = useRef(addAgentTab);
  const selectPaneRef = useRef(selectPane);
  const startingCaptureRef = useRef(false);

  addAgentTabRef.current = addAgentTab;
  selectPaneRef.current = selectPane;
  enabledRef.current = enabled;

  const stopCapture = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
  }, []);

  const resumeListening = useCallback(() => {
    if (!enabledRef.current) {
      return;
    }
    captureRef.current?.setPaused(false);
    if (!intentRunningRef.current) {
      useJarvisStore.getState().setPhase('listening');
    }
  }, []);

  const handleUtteranceRef = useRef<(wavBase64: string) => Promise<void>>(async () => undefined);

  handleUtteranceRef.current = async (wavBase64: string) => {
    if (handlingRef.current || intentRunningRef.current || useJarvisStore.getState().busy) {
      return;
    }

    handlingRef.current = true;
    useJarvisStore.getState().setBusy(true);
    useJarvisStore.getState().setPhase('processing');
    useJarvisStore.getState().setLastError(null);
    captureRef.current?.setPaused(true);

    let processTimer: number | undefined;

    try {
      const projectNames = useProjectStore
        .getState()
        .projects.map((project) => project.name)
        .filter(Boolean);

      const result = await Promise.race([
        window.nexus.jarvis.processUtterance(wavBase64, projectNames),
        new Promise<never>((_, reject) => {
          processTimer = window.setTimeout(() => {
            reject(new Error('Tempo esgotado ao transcrever a voz'));
          }, PROCESS_TIMEOUT_MS);
        }),
      ]);

      const transcript = result.transcript?.trim() || '';
      useJarvisStore.getState().setLastTranscript(transcript || null);

      if (!result.accepted || !result.intent) {
        if (result.error) {
          useJarvisStore.getState().setLastError(result.error);
          playJarvisRequestFinishSound();
        }
        return;
      }

      if (result.intent.mode === 'ping') {
        playJarvisRequestStartSound();
        playJarvisRequestFinishSound();
        await window.nexus.jarvis.notifyFinished(true);
        return;
      }

      intentRunningRef.current = true;
      useJarvisStore.getState().setPhase('executing');
      useJarvisStore.getState().setBusy(false);
      handlingRef.current = false;
      resumeListening();

      try {
        await runJarvisIntent(result.intent, {
          addAgentTab: addAgentTabRef.current,
          selectPane: selectPaneRef.current,
        });
      } finally {
        intentRunningRef.current = false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro no Jarvis';
      useJarvisStore.getState().setLastError(message);
      useJarvisStore.getState().setPhase('error');
      playJarvisRequestFinishSound();
      try {
        await window.nexus.jarvis.notifyFinished(false, message);
      } catch {
      }
    } finally {
      if (processTimer !== undefined) {
        window.clearTimeout(processTimer);
      }
      handlingRef.current = false;
      useJarvisStore.getState().setBusy(false);
      if (enabledRef.current) {
        window.setTimeout(() => {
          resumeListening();
        }, 350);
      }
    }
  };

  const startCapture = useCallback(async () => {
    if (captureRef.current || startingCaptureRef.current) {
      return;
    }

    startingCaptureRef.current = true;
    try {
      const capture = await startJarvisMicCapture((wavBase64) => {
        void handleUtteranceRef.current(wavBase64);
      });
      if (!enabledRef.current) {
        capture.stop();
        return;
      }
      captureRef.current = capture;
      useJarvisStore.getState().setPhase('listening');
      useJarvisStore.getState().setLastError(null);
      useJarvisStore.getState().setBusy(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Permissão de microfone negada';
      useJarvisStore.getState().setLastError(message);
      useJarvisStore.getState().setPhase('error');
      useJarvisStore.getState().setEnabled(false);
      enabledRef.current = false;
      try {
        await window.nexus.jarvis.stop();
      } catch {
      }
    } finally {
      startingCaptureRef.current = false;
    }
  }, [resumeListening]);

  const toggle = useCallback(async () => {
    if (!nexusReady) {
      return;
    }

    if (useJarvisStore.getState().enabled) {
      enabledRef.current = false;
      intentRunningRef.current = false;
      handlingRef.current = false;
      useJarvisStore.getState().setBusy(false);
      stopCapture();
      const status = await window.nexus.jarvis.stop();
      useJarvisStore.getState().setEnabled(false);
      useJarvisStore.getState().setStatus(status);
      useJarvisStore.getState().setPhase('idle');
      useJarvisStore.getState().setLastError(null);
      useJarvisStore.getState().setLastTranscript(null);
      return;
    }

    const status = await window.nexus.jarvis.start();
    useJarvisStore.getState().setStatus(status);
    const nextEnabled = status.enabled && status.phase !== 'error';
    enabledRef.current = nextEnabled;
    useJarvisStore.getState().setEnabled(nextEnabled);
    useJarvisStore.getState().setPhase(status.phase);
    useJarvisStore.getState().setLastError(status.lastError);
    useJarvisStore.getState().setBusy(false);
    intentRunningRef.current = false;

    if (nextEnabled) {
      await startCapture();
      if (!captureRef.current) {
        useJarvisStore.getState().setLastError('Microfone não iniciou a captura');
        useJarvisStore.getState().setPhase('error');
        useJarvisStore.getState().setEnabled(false);
        enabledRef.current = false;
        try {
          await window.nexus.jarvis.stop();
        } catch {
        }
      }
    }
  }, [nexusReady, startCapture, stopCapture]);

  useEffect(() => {
    if (!nexusReady) {
      return;
    }

    let disposed = false;

    void window.nexus.jarvis.status().then(async (status) => {
      if (disposed) {
        return;
      }
      useJarvisStore.getState().setStatus(status);
      useJarvisStore.getState().setEnabled(status.enabled);
      enabledRef.current = status.enabled;
      useJarvisStore.getState().setPhase(status.phase === 'executing' ? 'listening' : status.phase);
      useJarvisStore.getState().setLastError(status.lastError);
      useJarvisStore.getState().setBusy(false);
      if (status.enabled && status.phase !== 'error') {
        await startCapture();
      }
    });

    const unsubs = [
      window.nexus.jarvis.onPhase((nextPhase) => {
        if (handlingRef.current && (nextPhase === 'listening' || nextPhase === 'idle')) {
          return;
        }
        useJarvisStore.getState().setPhase(nextPhase);
      }),
      window.nexus.jarvis.onHeard((transcript) => {
        useJarvisStore.getState().setLastTranscript(transcript);
      }),
      window.nexus.jarvis.onError((message) => {
        useJarvisStore.getState().setLastError(message);
        useJarvisStore.getState().setPhase('error');
        useJarvisStore.getState().setBusy(false);
        handlingRef.current = false;
        intentRunningRef.current = false;
      }),
    ];

    return () => {
      disposed = true;
      stopCapture();
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  }, [nexusReady, startCapture, stopCapture]);

  return {
    enabled,
    phase,
    lastError,
    toggle,
  };
}

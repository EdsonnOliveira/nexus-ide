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
  const busy = useJarvisStore((state) => state.busy);

  const captureRef = useRef<JarvisMicCapture | null>(null);
  const handlingRef = useRef(false);
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

  const handleUtteranceRef = useRef<(wavBase64: string) => Promise<void>>(async () => undefined);

  handleUtteranceRef.current = async (wavBase64: string) => {
    if (handlingRef.current || useJarvisStore.getState().busy) {
      return;
    }

    handlingRef.current = true;
    useJarvisStore.getState().setBusy(true);
    captureRef.current?.setPaused(true);

    try {
      const projectNames = useProjectStore
        .getState()
        .projects.map((project) => project.name)
        .filter(Boolean);
      const result = await window.nexus.jarvis.processUtterance(wavBase64, projectNames);
      useJarvisStore.getState().setLastTranscript(result.transcript || null);

      if (!result.accepted || !result.intent) {
        if (result.error) {
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

      await runJarvisIntent(result.intent, {
        addAgentTab: addAgentTabRef.current,
        selectPane: selectPaneRef.current,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro no Jarvis';
      useJarvisStore.getState().setLastError(message);
      playJarvisRequestFinishSound();
      try {
        await window.nexus.jarvis.notifyFinished(false, message);
      } catch {
      }
    } finally {
      handlingRef.current = false;
      useJarvisStore.getState().setBusy(false);
      if (enabledRef.current) {
        window.setTimeout(() => {
          if (!enabledRef.current) {
            return;
          }
          captureRef.current?.setPaused(false);
          useJarvisStore.getState().setPhase('listening');
        }, 900);
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
  }, []);

  const toggle = useCallback(async () => {
    if (!nexusReady) {
      return;
    }

    if (useJarvisStore.getState().enabled) {
      enabledRef.current = false;
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
      useJarvisStore.getState().setPhase(status.phase);
      useJarvisStore.getState().setLastError(status.lastError);
      if (status.enabled && status.phase !== 'error') {
        await startCapture();
      }
    });

    const unsubs = [
      window.nexus.jarvis.onPhase((nextPhase) => {
        useJarvisStore.getState().setPhase(nextPhase);
      }),
      window.nexus.jarvis.onHeard((transcript) => {
        useJarvisStore.getState().setLastTranscript(transcript);
      }),
      window.nexus.jarvis.onError((message) => {
        useJarvisStore.getState().setLastError(message);
        useJarvisStore.getState().setPhase('error');
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
    phase: busy ? 'executing' : phase,
    lastError,
    toggle,
  };
}

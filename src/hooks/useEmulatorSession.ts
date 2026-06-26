import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAutomationExecutionStore } from '@/stores/useAutomationExecutionStore';
import type {
  EmulatorCaptureBackend,
  EmulatorDevice,
  EmulatorPlatform,
  EmulatorSessionState,
  EmulatorSetupStatus,
  EmulatorTab,
  EmulatorVideoCodec,
} from '@/types';
import { isOverlayBlockingTerminalHints } from '@/utils/overlayBlocking';

interface UseEmulatorSessionOptions {
  tab: EmulatorTab;
  isRuntimeActive: boolean;
  isFocused: boolean;
  onUpdateTab: (
    tabId: string,
    patch: Partial<Pick<EmulatorTab, 'platform' | 'deviceId' | 'sessionId' | 'title'>>,
  ) => void;
}

interface UseEmulatorSessionResult {
  setupStatus: EmulatorSetupStatus | null;
  devices: EmulatorDevice[];
  selectedDeviceId: string;
  isLoadingDevices: boolean;
  sessionState: EmulatorSessionState;
  sessionMessage: string | null;
  captureBackend: EmulatorCaptureBackend | null;
  streamFps: number;
  targetFps: number;
  streamFallbackReason: string | null;
  isStarting: boolean;
  frameSize: { width: number; height: number };
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  setPlatform: (platform: EmulatorPlatform) => void;
  setDeviceId: (deviceId: string) => void;
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  handlePointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  handlePointerMove: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  handlePointerUp: (event: React.PointerEvent<HTMLCanvasElement>) => void;
  handleCanvasPaste: (event: React.ClipboardEvent<HTMLCanvasElement>) => void;
  pressHome: () => Promise<void>;
  pressBack: () => Promise<void>;
  rotate: () => Promise<void>;
  takeScreenshot: () => Promise<boolean>;
}


interface ImageDrawState {
  generation: number;
  pending: Uint8Array | null;
  scheduled: boolean;
}

function drawImageFrame(
  canvas: HTMLCanvasElement,
  chunk: Uint8Array,
  mimeType: 'image/jpeg' | 'image/png',
  state: ImageDrawState,
): void {
  state.pending = chunk;

  if (state.scheduled) {
    return;
  }

  state.scheduled = true;

  const flush = () => {
    const data = state.pending;

    if (!data) {
      state.scheduled = false;
      return;
    }

    state.pending = null;
    const generation = ++state.generation;
    const blob = new Blob([new Uint8Array(data)], { type: mimeType });

    void createImageBitmap(blob)
      .then((bitmap) => {
        if (generation !== state.generation) {
          bitmap.close();
          flush();
          return;
        }

        const context = canvas.getContext('2d');

        if (!context) {
          bitmap.close();
          flush();
          return;
        }

        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
        }

        context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
        bitmap.close();
        flush();
      })
      .catch(() => {
        if (generation !== state.generation) {
          flush();
          return;
        }

        const url = URL.createObjectURL(blob);
        const image = new Image();

        image.onload = () => {
          if (generation !== state.generation) {
            URL.revokeObjectURL(url);
            flush();
            return;
          }

          const context = canvas.getContext('2d');

          if (!context) {
            URL.revokeObjectURL(url);
            flush();
            return;
          }

          if (canvas.width !== image.width || canvas.height !== image.height) {
            canvas.width = image.width;
            canvas.height = image.height;
          }

          context.drawImage(image, 0, 0, image.width, image.height);
          URL.revokeObjectURL(url);
          flush();
        };

        image.onerror = () => {
          URL.revokeObjectURL(url);
          flush();
        };

        image.src = url;
      });
  };

  flush();
}

export function useEmulatorSession({
  tab,
  isRuntimeActive,
  isFocused,
  onUpdateTab,
}: UseEmulatorSessionOptions): UseEmulatorSessionResult {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [setupStatus, setSetupStatus] = useState<EmulatorSetupStatus | null>(null);
  const [devices, setDevices] = useState<EmulatorDevice[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [sessionState, setSessionState] = useState<EmulatorSessionState>('stopped');
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [captureBackend, setCaptureBackend] = useState<EmulatorCaptureBackend | null>(null);
  const [streamFps, setStreamFps] = useState(0);
  const [targetFps, setTargetFps] = useState(0);
  const [streamFallbackReason, setStreamFallbackReason] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [frameSize, setFrameSize] = useState({ width: 390, height: 844 });
  const sessionIdRef = useRef<string | null>(tab.sessionId);
  const startGenerationRef = useRef(0);
  const pendingImageFrameRef = useRef<{
    chunk: Uint8Array;
    codec: 'jpeg' | 'png';
  } | null>(null);
  const imageDrawStateRef = useRef<ImageDrawState>({
    generation: 0,
    pending: null,
    scheduled: false,
  });
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const h264DecoderRef = useRef<VideoDecoder | null>(null);
  const h264ConfiguredRef = useRef(false);

  useEffect(() => {
    if (tab.sessionId) {
      sessionIdRef.current = tab.sessionId;
      return;
    }

    if (sessionState === 'stopped' || sessionState === 'error') {
      sessionIdRef.current = null;
    }
  }, [sessionState, tab.sessionId]);

  const selectedDeviceId = useMemo(() => {
    if (!tab.deviceId) {
      return '';
    }

    return devices.some((entry) => entry.id === tab.deviceId) ? tab.deviceId : '';
  }, [devices, tab.deviceId]);

  const iosAvailable = setupStatus?.ios.available ?? false;
  const androidAvailable = setupStatus?.android.available ?? false;
  const platformAvailable =
    tab.platform === 'android' ? androidAvailable : iosAvailable;
  const hasSetupStatus = setupStatus !== null;

  const prevPlatformRef = useRef(tab.platform);
  const prevVisibleRef = useRef(false);
  const prevPlatformAvailableRef = useRef(false);
  const devicesLengthRef = useRef(devices.length);

  devicesLengthRef.current = devices.length;

  const applyDeviceList = useCallback(
    (nextDevices: EmulatorDevice[]) => {
      setDevices(nextDevices);
      setIsLoadingDevices(false);

      const hasCurrentDevice = nextDevices.some((entry) => entry.id === tab.deviceId);

      if (hasCurrentDevice) {
        return;
      }

      if (nextDevices[0]) {
        onUpdateTab(tab.id, { deviceId: nextDevices[0].id });
        return;
      }

      if (tab.deviceId) {
        onUpdateTab(tab.id, { deviceId: null });
      }
    },
    [onUpdateTab, tab.deviceId, tab.id],
  );

  const fetchDevices = useCallback(
    (showLoading: boolean) => {
      let cancelled = false;

      if (showLoading) {
        setIsLoadingDevices(true);
      }

      void window.nexus.emulator.listDevices(tab.platform).then((nextDevices) => {
        if (cancelled) {
          return;
        }

        applyDeviceList(nextDevices);
      });

      return () => {
        cancelled = true;
      };
    },
    [applyDeviceList, tab.platform],
  );

  const configureH264Decoder = useCallback((canvas: HTMLCanvasElement) => {
    if (h264DecoderRef.current || !('VideoDecoder' in window)) {
      return;
    }

    h264DecoderRef.current = new VideoDecoder({
      output: (frame) => {
        const context = canvas.getContext('2d');

        if (!context) {
          frame.close();
          return;
        }

        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
        }

        context.drawImage(frame, 0, 0, frame.displayWidth, frame.displayHeight);
        frame.close();
      },
      error: () => {
        h264ConfiguredRef.current = false;
      },
    });

    h264DecoderRef.current.configure({
      codec: 'avc1.42E01E',
      optimizeForLatency: true,
    });
    h264ConfiguredRef.current = true;
  }, []);

  const handleVideoChunk = useCallback(
  (payload: {
    sessionId: string;
    codec: EmulatorVideoCodec;
    chunk: Uint8Array;
    width?: number;
    height?: number;
  }) => {
    const activeSessionId = sessionIdRef.current ?? tab.sessionId;

    if (activeSessionId && payload.sessionId !== activeSessionId) {
      return;
    }

    if (!sessionIdRef.current) {
      sessionIdRef.current = payload.sessionId;
    }

    if (payload.width && payload.height) {
      setFrameSize({ width: payload.width, height: payload.height });
    }

    const canvas = canvasRef.current;

    if (payload.codec === 'png' || payload.codec === 'jpeg') {
      if (!canvas) {
        pendingImageFrameRef.current = { chunk: payload.chunk, codec: payload.codec };
        return;
      }

      drawImageFrame(
        canvas,
        payload.chunk,
        payload.codec === 'jpeg' ? 'image/jpeg' : 'image/png',
        imageDrawStateRef.current,
      );
      return;
    }

    if (!canvas) {
      return;
    }

    configureH264Decoder(canvas);

    const decoder = h264DecoderRef.current;

    if (!decoder || decoder.state === 'closed') {
      return;
    }

    try {
      const chunk = new EncodedVideoChunk({
        type: 'key',
        timestamp: performance.now() * 1000,
        data: payload.chunk,
      });
      decoder.decode(chunk);
    } catch {
      h264ConfiguredRef.current = false;
    }
  },
  [configureH264Decoder, tab.sessionId],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const pendingFrame = pendingImageFrameRef.current;

    if (!canvas || !pendingFrame) {
      return;
    }

    drawImageFrame(
      canvas,
      pendingFrame.chunk,
      pendingFrame.codec === 'jpeg' ? 'image/jpeg' : 'image/png',
      imageDrawStateRef.current,
    );
    pendingImageFrameRef.current = null;
  }, [sessionState]);

  useEffect(() => {
    const unsubscribeCreated = window.nexus.emulator.onSessionCreated((payload) => {
      if (payload.tabId !== tab.id) {
        return;
      }

      sessionIdRef.current = payload.sessionId;
      onUpdateTab(tab.id, { sessionId: payload.sessionId });
    });

    return unsubscribeCreated;
  }, [onUpdateTab, tab.id]);

  useEffect(() => {
    if (!isRuntimeActive) {
      return;
    }

    let cancelled = false;

    const refreshSetupStatus = () => {
      void window.nexus.emulator.getSetupStatus().then((status) => {
        if (!cancelled) {
          setSetupStatus(status);
        }
      });
    };

    refreshSetupStatus();

    const intervalId = window.setInterval(refreshSetupStatus, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isRuntimeActive]);

  useEffect(() => {
    if (!isRuntimeActive) {
      prevVisibleRef.current = false;
      return;
    }

    const platformChanged = prevPlatformRef.current !== tab.platform;
    const becameVisible = !prevVisibleRef.current;
    const availabilityEnabled =
      prevPlatformAvailableRef.current === false &&
      platformAvailable &&
      hasSetupStatus;

    prevPlatformRef.current = tab.platform;
    prevVisibleRef.current = true;
    prevPlatformAvailableRef.current = platformAvailable;

    const shouldFetch = platformChanged || becameVisible || availabilityEnabled;

    if (!shouldFetch) {
      return;
    }

    if (hasSetupStatus && !platformAvailable) {
      setIsLoadingDevices(false);
      return;
    }

    const showLoading = platformChanged || devicesLengthRef.current === 0;

    return fetchDevices(showLoading);
  }, [fetchDevices, hasSetupStatus, isRuntimeActive, platformAvailable, tab.platform]);

  useEffect(() => {
    if (!isRuntimeActive || (hasSetupStatus && !platformAvailable)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void window.nexus.emulator.listDevices(tab.platform).then((nextDevices) => {
        applyDeviceList(nextDevices);
      });
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [applyDeviceList, hasSetupStatus, isRuntimeActive, platformAvailable, tab.platform]);

  useEffect(() => {
    const unsubscribeVideo = window.nexus.emulator.onVideoChunk(handleVideoChunk);
    const unsubscribeState = window.nexus.emulator.onSessionState((payload) => {
      if (payload.tabId !== tab.id) {
        return;
      }

      setSessionState(payload.state);
      setSessionMessage(payload.message ?? null);

      if (payload.captureBackend) {
        setCaptureBackend(payload.captureBackend);
      }

      if (typeof payload.targetFps === 'number') {
        setTargetFps(payload.targetFps);
      }

      if (typeof payload.streamFps === 'number') {
        setStreamFps(payload.streamFps);
      }

      if (payload.fallbackReason) {
        setStreamFallbackReason(payload.fallbackReason);
      }

      if (payload.state === 'stopped' || payload.state === 'error') {
        setCaptureBackend(null);
        setStreamFps(0);
        setTargetFps(0);
        setStreamFallbackReason(null);
      }

      if (payload.state === 'running' || payload.state === 'stopped' || payload.state === 'error') {
        setIsStarting(false);
      }
    });
    const unsubscribeStreamStats = window.nexus.emulator.onStreamStats((payload) => {
      if (payload.tabId !== tab.id) {
        return;
      }

      setCaptureBackend(payload.captureBackend);
      setTargetFps(payload.targetFps);
      setStreamFps(payload.streamFps);

      if (payload.fallbackReason) {
        setStreamFallbackReason(payload.fallbackReason);
      }
    });
    const unsubscribeSize = window.nexus.emulator.onFrameSize((payload) => {
      if (payload.sessionId !== sessionIdRef.current) {
        return;
      }

      setFrameSize({ width: payload.width, height: payload.height });
    });

    return () => {
      unsubscribeVideo();
      unsubscribeState();
      unsubscribeStreamStats();
      unsubscribeSize();
      h264DecoderRef.current?.close();
      h264DecoderRef.current = null;
      h264ConfiguredRef.current = false;
    };
  }, [handleVideoChunk, tab.id]);

  useEffect(() => {
    return () => {
      void window.nexus.emulator.stopByTabId(tab.id);
    };
  }, [tab.id]);

  const setPlatform = useCallback(
    (platform: EmulatorPlatform) => {
      if (platform === tab.platform) {
        return;
      }

      setDevices([]);
      setIsLoadingDevices(true);
      onUpdateTab(tab.id, { platform, deviceId: null, sessionId: null });
      setSessionState('stopped');
    },
    [onUpdateTab, tab.id, tab.platform],
  );

  const setDeviceId = useCallback(
    (deviceId: string) => {
      const device = devices.find((entry) => entry.id === deviceId);

      void window.nexus.emulator.recordDeviceUsage(tab.platform, deviceId).then(() =>
        window.nexus.emulator.listDevices(tab.platform),
      ).then((nextDevices) => {
        applyDeviceList(nextDevices);
      });

      onUpdateTab(tab.id, {
        deviceId,
        title: device ? `Emulador · ${device.name}` : tab.title,
      });
    },
    [applyDeviceList, devices, onUpdateTab, tab.id, tab.platform, tab.title],
  );

  const startSession = useCallback(async () => {
    if (!tab.deviceId || isStarting) {
      return;
    }

    const generation = startGenerationRef.current + 1;
    startGenerationRef.current = generation;

    setIsStarting(true);
    setSessionState('booting');
    setSessionMessage(null);
    imageDrawStateRef.current = {
      generation: 0,
      pending: null,
      scheduled: false,
    };
    pendingImageFrameRef.current = null;

    try {
      const sessionId = await window.nexus.emulator.start(tab.id, tab.platform, tab.deviceId);

      if (generation !== startGenerationRef.current) {
        await window.nexus.emulator.stop(sessionId);
        return;
      }

      sessionIdRef.current = sessionId;
      onUpdateTab(tab.id, { sessionId });
    } catch (error) {
      if (generation !== startGenerationRef.current) {
        return;
      }

      setIsStarting(false);
      setSessionState('error');
      setSessionMessage(error instanceof Error ? error.message : 'Falha ao iniciar o emulador.');
    }
  }, [isStarting, onUpdateTab, tab.deviceId, tab.id, tab.platform]);

  useEffect(() => {
    if (
      !isRuntimeActive ||
      !tab.deviceId ||
      tab.sessionId ||
      isStarting ||
      sessionState === 'booting' ||
      sessionState === 'running'
    ) {
      return;
    }

    if (!useAutomationExecutionStore.getState().shouldAutoStartEmulator(tab.id)) {
      return;
    }

    useAutomationExecutionStore.getState().completeEmulatorAutoStart(tab.id);
    void startSession();
  }, [
    isRuntimeActive,
    isStarting,
    sessionState,
    startSession,
    tab.deviceId,
    tab.id,
    tab.sessionId,
  ]);

  const stopSession = useCallback(async () => {
    startGenerationRef.current += 1;

    setSessionState('stopped');
    setIsStarting(false);
    setCaptureBackend(null);
    setStreamFps(0);
    setTargetFps(0);
    setStreamFallbackReason(null);
    sessionIdRef.current = null;
    imageDrawStateRef.current = {
      generation: 0,
      pending: null,
      scheduled: false,
    };
    pendingImageFrameRef.current = null;
    onUpdateTab(tab.id, { sessionId: null });

    await window.nexus.emulator.stopByTabId(tab.id);
  }, [onUpdateTab, tab.id]);

  const mapPointer = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    const x = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    const y = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1);

    return { x, y };
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      event.currentTarget.focus();
      const point = mapPointer(event);

      if (!point) {
        return;
      }

      pointerStartRef.current = point;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [mapPointer],
  );

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointerStartRef.current || event.buttons === 0) {
      return;
    }

    event.preventDefault();
  }, []);

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const point = mapPointer(event);
      const start = pointerStartRef.current;
      pointerStartRef.current = null;

      if (!point || !start) {
        return;
      }

      const sessionId = sessionIdRef.current ?? tab.sessionId;

      if (!sessionId) {
        return;
      }

      const deltaX = Math.abs(point.x - start.x);
      const deltaY = Math.abs(point.y - start.y);
      const isSwipe = deltaX > 0.02 || deltaY > 0.02;

      if (isSwipe) {
        void window.nexus.emulator.swipe(
          sessionId,
          start.x,
          start.y,
          point.x,
          point.y,
          150,
        );
        return;
      }

      void window.nexus.emulator.tap(sessionId, point.x, point.y);
    },
    [mapPointer, tab.sessionId],
  );

  const resolveSessionId = useCallback(() => sessionIdRef.current ?? tab.sessionId, [tab.sessionId]);

  const pressHome = useCallback(async () => {
    const sessionId = resolveSessionId();

    if (!sessionId) {
      return;
    }

    await window.nexus.emulator.pressHome(sessionId);
  }, [resolveSessionId]);

  const pressBack = useCallback(async () => {
    const sessionId = resolveSessionId();

    if (!sessionId) {
      return;
    }

    await window.nexus.emulator.pressBack(sessionId);
  }, [resolveSessionId]);

  const rotate = useCallback(async () => {
    const sessionId = resolveSessionId();

    if (!sessionId) {
      return;
    }

    await window.nexus.emulator.rotate(sessionId);
  }, [resolveSessionId]);

  const typeText = useCallback(
    async (text: string) => {
      const sessionId = resolveSessionId();

      if (!sessionId || !text) {
        return;
      }

      await window.nexus.emulator.typeText(sessionId, text);
    },
    [resolveSessionId],
  );

  const handleCanvasPaste = useCallback(
    (event: React.ClipboardEvent<HTMLCanvasElement>) => {
      if (!isFocused || sessionState !== 'running') {
        return;
      }

      const text = event.clipboardData.getData('text');

      if (!text) {
        return;
      }

      event.preventDefault();
      void typeText(text);
    },
    [isFocused, sessionState, typeText],
  );

  useEffect(() => {
    if (!isFocused || !isRuntimeActive || sessionState !== 'running') {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isOverlayBlockingTerminalHints()) {
        return;
      }

      const target = event.target;

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        void typeText('\n');
        return;
      }

      if (event.key === 'Backspace') {
        event.preventDefault();
        void typeText('\b');
        return;
      }

      if (event.key.length === 1) {
        event.preventDefault();
        void typeText(event.key);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFocused, isRuntimeActive, sessionState, typeText]);

  const takeScreenshot = useCallback(async () => {
    const sessionId = resolveSessionId();

    if (!sessionId) {
      return false;
    }

    return window.nexus.emulator.screenshot(sessionId);
  }, [resolveSessionId]);

  return {
    setupStatus,
    devices,
    selectedDeviceId,
    isLoadingDevices,
    sessionState,
    sessionMessage,
    captureBackend,
    streamFps,
    targetFps,
    streamFallbackReason,
    isStarting,
    frameSize,
    canvasRef,
    setPlatform,
    setDeviceId,
    startSession,
    stopSession,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleCanvasPaste,
    pressHome,
    pressBack,
    rotate,
    takeScreenshot,
  };
}

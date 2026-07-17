import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAutomationExecutionStore } from '@/stores/useAutomationExecutionStore';
import type {
  EmulatorCaptureBackend,
  EmulatorDevice,
  EmulatorDeviceOrientation,
  EmulatorPlatform,
  EmulatorSessionState,
  EmulatorSetupStatus,
  EmulatorTab,
  EmulatorVideoCodec,
  EmulatorAttachResult,
} from '@/types';
import { isOverlayBlockingTerminalHints } from '@/utils/overlayBlocking';
import { formatSimulatorTouchInput } from '@/utils/simulatorServerInput';

function isLandscapeOrientation(orientation: EmulatorDeviceOrientation): boolean {
  return orientation === 'landscapeLeft' || orientation === 'landscapeRight';
}

function mapPointerForOrientation(
  x: number,
  y: number,
  orientation: EmulatorDeviceOrientation,
): { x: number; y: number } {
  switch (orientation) {
    case 'landscapeRight':
      return { x: y, y: 1 - x };
    case 'landscapeLeft':
      return { x: 1 - y, y: x };
    case 'portraitUpsideDown':
      return { x: 1 - x, y: 1 - y };
    default:
      return { x, y };
  }
}

function frameSizeForOrientation(
  width: number,
  height: number,
  orientation: EmulatorDeviceOrientation,
): { width: number; height: number } {
  const portraitWidth = Math.min(width, height);
  const portraitHeight = Math.max(width, height);

  return isLandscapeOrientation(orientation)
    ? { width: portraitHeight, height: portraitWidth }
    : { width: portraitWidth, height: portraitHeight };
}

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
  iosDeviceOrientation: EmulatorDeviceOrientation;
  streamUrl: string | null;
  usesNativeStream: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  streamImgRef: React.RefObject<HTMLImageElement | null>;
  setPlatform: (platform: EmulatorPlatform) => void;
  setDeviceId: (deviceId: string) => void;
  startSession: () => Promise<void>;
  stopSession: () => Promise<void>;
  handlePointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  handlePointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  handlePointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  handleCanvasPaste: (event: React.ClipboardEvent<HTMLElement>) => void;
  handleStreamImgLoad: () => void;
  pressHome: () => Promise<void>;
  pressAppSwitcher: () => Promise<void>;
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
  const onUpdateTabRef = useRef(onUpdateTab);
  onUpdateTabRef.current = onUpdateTab;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamImgRef = useRef<HTMLImageElement | null>(null);
  const [setupStatus, setSetupStatus] = useState<EmulatorSetupStatus | null>(null);
  const [devices, setDevices] = useState<EmulatorDevice[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [sessionState, setSessionState] = useState<EmulatorSessionState>('stopped');
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [captureBackend, setCaptureBackend] = useState<EmulatorCaptureBackend | null>(null);
  const [streamFps, setStreamFps] = useState(0);
  const [targetFps, setTargetFps] = useState(0);
  const [streamFallbackReason, setStreamFallbackReason] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [frameSize, setFrameSize] = useState({ width: 390, height: 844 });
  const [iosDeviceOrientation, setIosDeviceOrientation] =
    useState<EmulatorDeviceOrientation>('portrait');
  const iosDeviceOrientationRef = useRef<EmulatorDeviceOrientation>('portrait');

  useEffect(() => {
    iosDeviceOrientationRef.current = iosDeviceOrientation;
  }, [iosDeviceOrientation]);

  const applyFrameSize = useCallback(
    (width: number, height: number, orientation?: EmulatorDeviceOrientation) => {
      if (tab.platform === 'ios') {
        const resolvedOrientation =
          orientation ??
          (width > height
            ? isLandscapeOrientation(iosDeviceOrientationRef.current)
              ? iosDeviceOrientationRef.current
              : 'landscapeRight'
            : iosDeviceOrientationRef.current === 'portraitUpsideDown'
              ? 'portraitUpsideDown'
              : 'portrait');

        iosDeviceOrientationRef.current = resolvedOrientation;
        setIosDeviceOrientation(resolvedOrientation);
        setFrameSize(frameSizeForOrientation(width, height, resolvedOrientation));
        return;
      }

      setFrameSize({ width, height });
    },
    [tab.platform],
  );
  const sessionIdRef = useRef<string | null>(tab.sessionId);
  const startGenerationRef = useRef(0);
  const intentionalStopRef = useRef(false);
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
  const pointerDraggingRef = useRef(false);
  const pendingMoveRef = useRef<{ x: number; y: number } | null>(null);
  const captureBackendRef = useRef<EmulatorCaptureBackend | null>(null);
  const h264DecoderRef = useRef<VideoDecoder | null>(null);
  const h264ConfiguredRef = useRef(false);
  const usesNativeStream = captureBackend === 'simulator-server';

  useEffect(() => {
    captureBackendRef.current = captureBackend;
  }, [captureBackend]);

  const resolveSessionId = useCallback(() => sessionIdRef.current ?? tab.sessionId, [tab.sessionId]);

  const dispatchSimulatorInput = useCallback(
    (line: string) => {
      const sessionId = resolveSessionId();

      if (!sessionId) {
        return;
      }

      void window.nexus.emulator.sendInput(sessionId, line);
    },
    [resolveSessionId],
  );

  const flushPendingMove = useCallback(() => {
    const point = pendingMoveRef.current;

    if (!point) {
      return;
    }

    pendingMoveRef.current = null;
    dispatchSimulatorInput(formatSimulatorTouchInput('Move', point.x, point.y));
  }, [dispatchSimulatorInput]);

  useEffect(() => {
    if (!usesNativeStream) {
      return;
    }

    let frameId = 0;

    const tick = () => {
      flushPendingMove();
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [flushPendingMove, usesNativeStream]);

  const applyAttachResult = useCallback((result: EmulatorAttachResult) => {
    sessionIdRef.current = result.sessionId;
    setSessionState(result.state);
    setSessionMessage(result.message ?? null);
    setIsStarting(result.state === 'booting');

    if (result.captureBackend) {
      setCaptureBackend(result.captureBackend);
    }

    if (typeof result.targetFps === 'number') {
      setTargetFps(result.targetFps);
    }

    if (typeof result.streamFps === 'number') {
      setStreamFps(result.streamFps);
    }

    if (result.fallbackReason) {
      setStreamFallbackReason(result.fallbackReason);
    } else if (result.state === 'running') {
      setStreamFallbackReason(null);
    }

    if (result.streamUrl) {
      setStreamUrl(result.streamUrl);
    }

    if (result.frameWidth && result.frameHeight) {
      applyFrameSize(result.frameWidth, result.frameHeight);
    }
  }, [applyFrameSize]);

  useEffect(() => {
    if (!isRuntimeActive) {
      return;
    }

    let cancelled = false;

    void window.nexus.emulator.attachTab(tab.id).then((result) => {
      if (cancelled) {
        return;
      }

      if (!result) {
        if (sessionIdRef.current) {
          sessionIdRef.current = null;
          setSessionState('stopped');
          setCaptureBackend(null);
          setStreamUrl(null);
        }

        return;
      }

      applyAttachResult(result);
    });

    return () => {
      cancelled = true;
    };
  }, [applyAttachResult, isRuntimeActive, tab.id]);

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
        onUpdateTabRef.current(tab.id, { deviceId: nextDevices[0].id });
        return;
      }

      if (tab.deviceId) {
        onUpdateTabRef.current(tab.id, { deviceId: null });
      }
    },
    [tab.deviceId, tab.id],
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
    orientation?: EmulatorDeviceOrientation;
  }) => {
    const activeSessionId = sessionIdRef.current ?? tab.sessionId;

    if (activeSessionId && payload.sessionId !== activeSessionId) {
      return;
    }

    if (captureBackendRef.current === 'simulator-server') {
      pendingImageFrameRef.current = null;
      return;
    }

    if (!sessionIdRef.current) {
      sessionIdRef.current = payload.sessionId;
    }

    if (payload.width && payload.height) {
      applyFrameSize(payload.width, payload.height, payload.orientation);
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
  [applyFrameSize, configureH264Decoder, tab.sessionId],
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

      if (intentionalStopRef.current) {
        return;
      }

      sessionIdRef.current = payload.sessionId;
    });

    return unsubscribeCreated;
  }, [tab.id]);

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

      if (
        intentionalStopRef.current &&
        payload.state !== 'stopped' &&
        payload.state !== 'error'
      ) {
        return;
      }

      setSessionState(payload.state);
      setSessionMessage(payload.message ?? null);

      if (payload.captureBackend) {
        setCaptureBackend(payload.captureBackend);
      }

      if (payload.streamUrl) {
        setStreamUrl(payload.streamUrl);
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
        setStreamUrl(null);
        pointerDraggingRef.current = false;
        pendingMoveRef.current = null;
      }

      if (payload.state === 'running' || payload.state === 'stopped' || payload.state === 'error') {
        setIsStarting(false);
      }

      if (payload.state === 'running') {
        intentionalStopRef.current = false;
      }
    });
    const unsubscribeStreamStats = window.nexus.emulator.onStreamStats((payload) => {
      if (payload.tabId !== tab.id) {
        return;
      }

      if (intentionalStopRef.current) {
        return;
      }

      setCaptureBackend(payload.captureBackend);
      setTargetFps(payload.targetFps);
      setStreamFps(payload.streamFps);

      if (payload.streamUrl) {
        setStreamUrl(payload.streamUrl);
      }

      if (payload.fallbackReason) {
        setStreamFallbackReason(payload.fallbackReason);
      }
    });
    const unsubscribeSize = window.nexus.emulator.onFrameSize((payload) => {
      if (payload.sessionId !== sessionIdRef.current) {
        return;
      }

      applyFrameSize(payload.width, payload.height, payload.orientation);
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
  }, [applyFrameSize, handleVideoChunk, tab.id]);

  const setPlatform = useCallback(
    (platform: EmulatorPlatform) => {
      if (platform === tab.platform) {
        return;
      }

      setDevices([]);
      setIsLoadingDevices(true);
      sessionIdRef.current = null;
      onUpdateTabRef.current(tab.id, { platform, deviceId: null, sessionId: null });
      setSessionState('stopped');
    },
    [tab.id, tab.platform],
  );

  const setDeviceId = useCallback(
    (deviceId: string) => {
      const device = devices.find((entry) => entry.id === deviceId);

      void window.nexus.emulator.recordDeviceUsage(tab.platform, deviceId).then(() =>
        window.nexus.emulator.listDevices(tab.platform),
      ).then((nextDevices) => {
        applyDeviceList(nextDevices);
      });

      onUpdateTabRef.current(tab.id, {
        deviceId,
        title: device ? `Emulador · ${device.name}` : tab.title,
      });
    },
    [applyDeviceList, devices, tab.id, tab.platform, tab.title],
  );

  const startSession = useCallback(async () => {
    if (!tab.deviceId || isStarting) {
      return;
    }

    intentionalStopRef.current = false;
    const generation = startGenerationRef.current + 1;
    startGenerationRef.current = generation;

    setIsStarting(true);
    setSessionState('booting');
    setSessionMessage(null);
    setStreamUrl(null);
    imageDrawStateRef.current = {
      generation: 0,
      pending: null,
      scheduled: false,
    };
    pendingImageFrameRef.current = null;

    try {
      const device = devices.find((entry) => entry.id === tab.deviceId);

      if (device) {
        onUpdateTabRef.current(tab.id, { title: `Emulador · ${device.name}` });
      }

      const sessionId = await window.nexus.emulator.start(tab.id, tab.platform, tab.deviceId);

      if (generation !== startGenerationRef.current) {
        await window.nexus.emulator.stop(sessionId);
        return;
      }

      sessionIdRef.current = sessionId;
    } catch (error) {
      if (generation !== startGenerationRef.current) {
        return;
      }

      setIsStarting(false);
      setSessionState('error');
      setSessionMessage(error instanceof Error ? error.message : 'Falha ao iniciar o emulador.');
    }
  }, [devices, isStarting, tab.deviceId, tab.id, tab.platform]);

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
    intentionalStopRef.current = true;
    startGenerationRef.current += 1;

    setSessionState('stopped');
    setIsStarting(false);
    setCaptureBackend(null);
    setStreamFps(0);
    setTargetFps(0);
    setStreamFallbackReason(null);
    setStreamUrl(null);
    setIosDeviceOrientation('portrait');
    iosDeviceOrientationRef.current = 'portrait';
    setFrameSize({ width: 390, height: 844 });
    sessionIdRef.current = null;
    imageDrawStateRef.current = {
      generation: 0,
      pending: null,
      scheduled: false,
    };
    pendingImageFrameRef.current = null;

    await window.nexus.emulator.stopByTabId(tab.id);
  }, [tab.id]);

  const mapPointer = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
      const y = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1);

      if (tab.platform === 'ios') {
        return mapPointerForOrientation(x, y, iosDeviceOrientation);
      }

      return { x, y };
    },
    [iosDeviceOrientation, tab.platform],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      event.currentTarget.focus();
      const point = mapPointer(event);

      if (!point) {
        return;
      }

      if (captureBackendRef.current === 'simulator-server') {
        pointerDraggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        dispatchSimulatorInput(formatSimulatorTouchInput('Down', point.x, point.y));
        return;
      }

      pointerStartRef.current = point;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [dispatchSimulatorInput, mapPointer],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (captureBackendRef.current === 'simulator-server') {
        if (!pointerDraggingRef.current) {
          return;
        }

        const point = mapPointer(event);

        if (!point) {
          return;
        }

        pendingMoveRef.current = point;
        event.preventDefault();
        return;
      }

      if (!pointerStartRef.current || event.buttons === 0) {
        return;
      }

      event.preventDefault();
    },
    [mapPointer],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const point = mapPointer(event);

      if (captureBackendRef.current === 'simulator-server') {
        if (!pointerDraggingRef.current) {
          return;
        }

        pointerDraggingRef.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);

        if (!point) {
          return;
        }

        flushPendingMove();
        dispatchSimulatorInput(formatSimulatorTouchInput('Up', point.x, point.y));
        return;
      }

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
    [dispatchSimulatorInput, flushPendingMove, mapPointer, tab.sessionId],
  );

  const handleStreamImgLoad = useCallback(() => {
    const image = streamImgRef.current;

    if (!image || !image.naturalWidth || !image.naturalHeight) {
      return;
    }

    if (iosDeviceOrientationRef.current !== 'portrait') {
      return;
    }

    applyFrameSize(image.naturalWidth, image.naturalHeight);
  }, [applyFrameSize]);

  const pressHome = useCallback(async () => {
    const sessionId = resolveSessionId();

    if (!sessionId) {
      return;
    }

    await window.nexus.emulator.pressHome(sessionId);
  }, [resolveSessionId]);

  const pressAppSwitcher = useCallback(async () => {
    const sessionId = resolveSessionId();

    if (!sessionId) {
      return;
    }

    await window.nexus.emulator.pressAppSwitcher(sessionId);
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

    const result = await window.nexus.emulator.rotate(sessionId);

    if (!result.ok) {
      return;
    }

    if (tab.platform === 'ios') {
      iosDeviceOrientationRef.current = result.orientation;
      setIosDeviceOrientation(result.orientation);
      setFrameSize((size) =>
        frameSizeForOrientation(size.width, size.height, result.orientation),
      );
    }
  }, [resolveSessionId, tab.platform]);

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
    (event: React.ClipboardEvent<HTMLElement>) => {
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
    iosDeviceOrientation,
    streamUrl,
    usesNativeStream,
    canvasRef,
    streamImgRef,
    setPlatform,
    setDeviceId,
    startSession,
    stopSession,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleCanvasPaste,
    handleStreamImgLoad,
    pressHome,
    pressAppSwitcher,
    pressBack,
    rotate,
    takeScreenshot,
  };
}

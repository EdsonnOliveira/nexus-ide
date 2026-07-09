import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { TERMINAL_AGENTS } from '@/constants/terminalAgents';
import { buildTerminalTheme } from '@/constants/terminalTheme';
import { TerminalLinkContextMenu } from '@/components/terminal/TerminalLinkContextMenu';
import type { TerminalAgent } from '@/types';
import { saveScrollbackForPane } from '@/utils/persistTerminalSession';
import { findUrlAtTerminalPosition, registerNexusTerminalLinks } from '@/utils/terminalLink';
import { createTerminalOutputParser } from '@/utils/terminalStream';
import {
  createAgentReadyStreamDetector,
  createSettledCallback,
  completeShellIdleTaskIfAwaiting,
  dispatchPendingAgentTaskCommands,
  isPaneTrackingAgentCompletion,
  trackAgentReadyDetectorReset,
} from '@/utils/terminalTaskCompletion';
import { completeAgentGitTurn, trackAgentGitPrompt } from '@/utils/agentGitTurn';
import { handleAutomationPaneShellPrompt } from '@/utils/automationPaneExecution';
import {
  feedMobileReleaseOutput,
  handleMobileReleaseShellPrompt,
  startMobileReleaseFromCommand,
} from '@/utils/mobileReleaseTracker';
import { useAgentGitChangeStore } from '@/stores/useAgentGitChangeStore';
import { extractCliAgentCommand } from '@/constants/cliAgentCommands';
import { shouldMarkAgentAwaiting } from '@/utils/projectAgentStatus';
import { parseCdCommandLine } from '@/utils/terminalCwd';
import { isOverlayBlockingTerminalHints } from '@/utils/overlayBlocking';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { useTerminalPasteImageStore } from '@/stores/useTerminalPasteImageStore';
import { attachAgentPromptImageToPane } from '@/utils/attachAgentPromptImage';
import { readClipboardImageDataUrl } from '@/utils/terminalClipboardImage';
import {
  buildRemoveImagePathPromptSequence,
  buildRemoveImagePromptSequence,
  parseImagePathReferences,
  parseImageTokenIds,
} from '@/utils/terminalPasteImageTokens';
import { readShellPromptInput, sanitizeAgentPrompt } from '@/utils/terminalShellPrompt';
import { isProjectSwitching } from '@/utils/projectSwitch';
import { readTerminalCellDimensions } from '@/utils/terminalBadgeMetrics';
import type { XTermViewHandle } from '@/types';

interface XTermViewProps {
  paneId: string;
  projectPath: string;
  ptyId: string | null;
  isVisible: boolean;
  isRuntimeActive: boolean;
  isFocused: boolean;
  cwd: string;
  agent: TerminalAgent;
  isAgentSession: boolean;
  onPtyCreated: (ptyId: string) => void;
  onPtyLost: () => void;
  onCwdChange: (cwd: string) => void;
  onOpenLinkInBrowser: (url: string) => void;
  onFocusHints?: () => void;
  hintsKeyboardActive?: boolean;
  restoreCommand?: string | null;
}

const LAUNCH_COMMAND_DELAY_MS = 350;

function isTerminalAtBottom(terminal: Terminal): boolean {
  const buffer = terminal.buffer.active;
  return buffer.baseY + terminal.rows >= buffer.length;
}

function isLineEditRedraw(data: string): boolean {
  return data.includes('\r') && !data.includes('\n');
}

function readTerminalViewportWidth(mount: HTMLElement): number {
  const screen = mount.querySelector('.xterm-screen');

  if (screen instanceof HTMLElement && screen.clientWidth > 0) {
    return screen.clientWidth;
  }

  return mount.clientWidth;
}

function applyTerminalGeometry(
  fitAddon: FitAddon,
  terminal: Terminal,
  mount: HTMLElement,
  ptyId: string | null,
): void {
  fitAddon.fit();

  const cell = readTerminalCellDimensions(terminal, mount);
  const viewportWidth = readTerminalViewportWidth(mount);

  if (!cell || viewportWidth <= 0 || mount.clientHeight <= 0) {
    return;
  }

  const cols = Math.max(2, Math.floor(viewportWidth / cell.width));
  const rows = Math.max(1, Math.floor(mount.clientHeight / cell.height));

  if (cols !== terminal.cols || rows !== terminal.rows) {
    terminal.resize(cols, rows);
  }

  if (ptyId && terminal.cols > 0 && terminal.rows > 0) {
    window.nexus.terminal.resize(ptyId, terminal.cols, terminal.rows);
  }
}

function fitTerminal(
  fitAddon: FitAddon,
  terminal: Terminal,
  mount: HTMLElement,
  ptyId: string | null,
  stickToBottomRef: { current: boolean },
  isVisible: boolean,
): void {
  if (!isVisible) {
    return;
  }

  const stickToBottom = stickToBottomRef.current;

  applyTerminalGeometry(fitAddon, terminal, mount, ptyId);

  if (stickToBottom) {
    terminal.scrollToBottom();
    stickToBottomRef.current = true;
  } else {
    stickToBottomRef.current = isTerminalAtBottom(terminal);
  }
}

function writeTerminalOutput(
  terminal: Terminal,
  data: string,
  stickToBottomRef: { current: boolean },
): void {
  terminal.write(data);

  if (!stickToBottomRef.current) {
    stickToBottomRef.current = isTerminalAtBottom(terminal);
    return;
  }

  if (!isLineEditRedraw(data)) {
    terminal.scrollToBottom();
  }
}

function refreshTerminalDisplay(
  fitAddon: FitAddon,
  terminal: Terminal,
  mount: HTMLElement,
  ptyId: string | null,
  stickToBottomRef: { current: boolean },
  isVisible: boolean,
): void {
  fitTerminal(fitAddon, terminal, mount, ptyId, stickToBottomRef, isVisible);

  if (terminal.rows > 0) {
    terminal.refresh(0, terminal.rows - 1);
  }
}

function scheduleTerminalDisplayRefresh(
  fitAddon: FitAddon,
  terminal: Terminal,
  mount: HTMLElement,
  ptyId: string | null,
  stickToBottomRef: { current: boolean },
  isVisible: boolean,
): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      refreshTerminalDisplay(fitAddon, terminal, mount, ptyId, stickToBottomRef, isVisible);
    });
  });
}

function scheduleTerminalGeometrySync(
  fitAddon: FitAddon,
  terminal: Terminal,
  mount: HTMLElement,
  ptyId: string | null,
  stickToBottomRef: { current: boolean },
  isVisible: boolean,
  disposedRef: { current: boolean },
): void {
  scheduleTerminalDisplayRefresh(fitAddon, terminal, mount, ptyId, stickToBottomRef, isVisible);

  void document.fonts.ready.then(() => {
    if (!canUseTerminal(terminal, disposedRef)) {
      return;
    }

    refreshTerminalDisplay(fitAddon, terminal, mount, ptyId, stickToBottomRef, isVisible);
  });
}

async function fetchTerminalScrollback(ptyId: string, paneId: string): Promise<string> {
  let scrollback = await window.nexus.terminal.getScrollback(ptyId);

  if (!scrollback) {
    scrollback = await window.nexus.session.getScrollback(paneId);
  }

  return scrollback;
}

function canUseTerminal(terminal: Terminal | null, disposedRef: { current: boolean }): terminal is Terminal {
  return Boolean(terminal && !disposedRef.current);
}

const MAX_SCROLLBACK_REPLAY_BYTES = 262_144;

function trimScrollbackTail(scrollback: string): string {
  if (scrollback.length <= MAX_SCROLLBACK_REPLAY_BYTES) {
    return scrollback;
  }

  const trimmed = scrollback.slice(-MAX_SCROLLBACK_REPLAY_BYTES);
  const firstNewline = trimmed.indexOf('\n');

  return firstNewline >= 0 ? trimmed.slice(firstNewline + 1) : trimmed;
}

async function forceReplayTerminalScrollback(
  terminal: Terminal,
  ptyId: string,
  paneId: string,
  parseStream: (data: string) => string,
  suppressShellPromptClearRef: { current: boolean },
  stickToBottomRef: { current: boolean },
  disposedRef: { current: boolean },
): Promise<void> {
  const raw = await fetchTerminalScrollback(ptyId, paneId);

  if (!raw || !canUseTerminal(terminal, disposedRef)) {
    return;
  }

  const scrollback = trimScrollbackTail(raw);

  suppressShellPromptClearRef.current = true;
  terminal.clear();
  terminal.write(parseStream(scrollback));
  suppressShellPromptClearRef.current = false;
  terminal.scrollToBottom();
  stickToBottomRef.current = true;

  if (terminal.rows > 0) {
    terminal.refresh(0, terminal.rows - 1);
  }
}

async function restoreTerminalScrollback(
  terminal: Terminal,
  ptyId: string,
  paneId: string,
  parseStream: (data: string) => string,
  suppressShellPromptClearRef: { current: boolean },
  stickToBottomRef: { current: boolean },
  disposedRef: { current: boolean },
): Promise<void> {
  if (!canUseTerminal(terminal, disposedRef) || terminal.buffer.active.length > 1) {
    return;
  }

  const scrollback = await fetchTerminalScrollback(ptyId, paneId);

  if (!canUseTerminal(terminal, disposedRef)) {
    return;
  }

  replayTerminalScrollback(
    terminal,
    scrollback,
    parseStream,
    suppressShellPromptClearRef,
    stickToBottomRef,
    disposedRef,
  );
}

function replayTerminalScrollback(
  terminal: Terminal,
  raw: string,
  parseStream: (data: string) => string,
  suppressShellPromptClearRef: { current: boolean },
  stickToBottomRef: { current: boolean },
  disposedRef: { current: boolean },
): void {
  if (!raw || !canUseTerminal(terminal, disposedRef) || terminal.buffer.active.length > 1) {
    return;
  }

  const scrollback = trimScrollbackTail(raw);

  suppressShellPromptClearRef.current = true;
  terminal.write(parseStream(scrollback));
  suppressShellPromptClearRef.current = false;
  terminal.scrollToBottom();
  stickToBottomRef.current = true;

  if (terminal.rows > 0) {
    terminal.refresh(0, terminal.rows - 1);
  }
}

function applyTransparentViewport(container: HTMLDivElement): void {
  const viewport = container.querySelector('.xterm-viewport');

  if (viewport instanceof HTMLElement) {
    viewport.style.backgroundColor = 'transparent';
  }
}

const XTermViewComponent = forwardRef<XTermViewHandle, XTermViewProps>(function XTermViewComponent(
  {
    paneId,
    projectPath,
    ptyId,
    isVisible,
    isRuntimeActive,
    isFocused,
    cwd,
    agent,
    isAgentSession,
    onPtyCreated,
    onPtyLost,
    onCwdChange,
    onOpenLinkInBrowser,
    onFocusHints,
    hintsKeyboardActive = false,
    restoreCommand = null,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(ptyId);
  const agentRef = useRef(agent);
  const isAgentSessionRef = useRef(isAgentSession);
  const isFocusedRef = useRef(isFocused);
  const hintsKeyboardActiveRef = useRef(hintsKeyboardActive);
  const terminalDomFocusedRef = useRef(false);
  const prevAgentRef = useRef(agent);
  const creatingRef = useRef(false);
  const terminalExitedRef = useRef(false);
  const onPtyCreatedRef = useRef(onPtyCreated);
  const onPtyLostRef = useRef(onPtyLost);
  const onOpenLinkInBrowserRef = useRef(onOpenLinkInBrowser);
  const onCwdChangeRef = useRef(onCwdChange);
  const onFocusHintsRef = useRef(onFocusHints);
  const cwdRef = useRef(cwd);
  const projectPathRef = useRef(projectPath);
  const parseStreamRef = useRef<(data: string) => string>((data) => data);
  const replayedScrollbackRef = useRef<{ ptyId: string; terminal: Terminal } | null>(null);
  const suppressShellPromptClearRef = useRef(false);
  const stickToBottomRef = useRef(true);
  const spawnTerminalRef = useRef<() => Promise<void>>(async () => undefined);
  const resizeFrameRef = useRef<number | null>(null);
  const syncPasteImagesTimerRef = useRef<number | null>(null);
  const paneIdRef = useRef(paneId);
  const restoreCommandRef = useRef(restoreCommand);
  const isVisibleRef = useRef(isVisible);
  const disposedRef = useRef(false);
  const scrollbackReplayGenerationRef = useRef(0);
  const [linkMenu, setLinkMenu] = useState<{ url: string; x: number; y: number } | null>(null);

  paneIdRef.current = paneId;
  restoreCommandRef.current = restoreCommand;
  isVisibleRef.current = isVisible;
  isAgentSessionRef.current = isAgentSession;

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        terminalRef.current?.focus();
      },
      write: (data: string) => {
        if (ptyIdRef.current) {
          window.nexus.terminal.write(ptyIdRef.current, data);
        }
      },
      print: (data: string) => {
        const terminal = terminalRef.current;

        if (!canUseTerminal(terminal, disposedRef)) {
          return;
        }

        terminal.write(data);
        terminal.scrollToBottom();
      },
      canPrint: () => canUseTerminal(terminalRef.current, disposedRef),
      isWritable: () => Boolean(ptyIdRef.current),
      interruptAndRun: async (command: string) => {
        const activePtyId = ptyIdRef.current;

        if (!activePtyId) {
          return;
        }

        window.nexus.terminal.write(activePtyId, '\x03');
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 400);
        });
        window.nexus.terminal.write(activePtyId, `${command}\n`);
        useTerminalSessionStore.getState().setLastCommand(paneIdRef.current, command);
        void startMobileReleaseFromCommand(paneIdRef.current, command);

        if (
          shouldMarkAgentAwaiting(
            paneIdRef.current,
            command,
            useTerminalSessionStore.getState().activeAgentByPane,
          )
        ) {
          useTerminalSessionStore.getState().markAwaitingResponse(paneIdRef.current);
        }
      },
      removeImageFromPrompt: (imageId: number) => {
        const activePtyId = ptyIdRef.current;

        if (!activePtyId) {
          return;
        }

        const terminal = terminalRef.current;

        if (!terminal) {
          return;
        }

        const promptText = readShellPromptInput(terminal);
        const image = useTerminalPasteImageStore
          .getState()
          .imagesByPane[paneIdRef.current]
          ?.find((entry) => entry.id === imageId);
        const sequence = image
          ? buildRemoveImagePathPromptSequence(image.relativePath, promptText)
          : buildRemoveImagePromptSequence(imageId, promptText);

        if (!sequence) {
          return;
        }

        window.nexus.terminal.write(activePtyId, sequence);
      },
    }),
    [],
  );

  const syncPasteImagesFromPrompt = useCallback(() => {
    if (!isAgentSessionRef.current) {
      return;
    }

    const terminal = terminalRef.current;

    if (!terminal) {
      return;
    }

    const promptText = readShellPromptInput(terminal);
    const legacyIds = parseImageTokenIds(promptText);
    const activeRelativePaths =
      legacyIds.length > 0
        ? (useTerminalPasteImageStore.getState().imagesByPane[paneIdRef.current] ?? [])
            .filter((image) => legacyIds.includes(image.id))
            .map((image) => image.relativePath)
        : parseImagePathReferences(promptText);

    useTerminalPasteImageStore.getState().syncPaneImages(paneIdRef.current, activeRelativePaths);
  }, []);

  const syncPasteImagesFromPromptRef = useRef(syncPasteImagesFromPrompt);
  syncPasteImagesFromPromptRef.current = syncPasteImagesFromPrompt;

  const syncPasteImagesFrameRef = useRef<number | null>(null);

  const scheduleSyncPasteImagesFromPrompt = useCallback((immediate = false) => {
    if (syncPasteImagesTimerRef.current !== null) {
      window.clearTimeout(syncPasteImagesTimerRef.current);
      syncPasteImagesTimerRef.current = null;
    }

    if (syncPasteImagesFrameRef.current !== null) {
      window.cancelAnimationFrame(syncPasteImagesFrameRef.current);
      syncPasteImagesFrameRef.current = null;
    }

    const runSync = () => {
      syncPasteImagesFrameRef.current = null;
      syncPasteImagesFromPromptRef.current();
    };

    if (immediate) {
      syncPasteImagesFrameRef.current = window.requestAnimationFrame(runSync);
      return;
    }

    syncPasteImagesTimerRef.current = window.setTimeout(() => {
      syncPasteImagesTimerRef.current = null;
      runSync();
    }, 32);
  }, []);

  const scheduleSyncPasteImagesFromPromptRef = useRef(scheduleSyncPasteImagesFromPrompt);
  scheduleSyncPasteImagesFromPromptRef.current = scheduleSyncPasteImagesFromPrompt;

  useEffect(() => {
    if (ptyId !== null) {
      ptyIdRef.current = ptyId;
    }
  }, [ptyId]);

  const applyCwdChange = useCallback((nextCwd: string) => {
    cwdRef.current = nextCwd;
    onCwdChangeRef.current(nextCwd);
  }, []);

  useEffect(() => {
    agentRef.current = agent;
    isFocusedRef.current = isFocused;
    hintsKeyboardActiveRef.current = hintsKeyboardActive;
    const terminal = terminalRef.current;

    if (terminal) {
      terminal.options.theme = buildTerminalTheme(agent);

      if (containerRef.current) {
        applyTransparentViewport(containerRef.current);
      }
    }
  }, [agent, hintsKeyboardActive, isFocused]);

  useEffect(() => {
    onPtyCreatedRef.current = onPtyCreated;
    onPtyLostRef.current = onPtyLost;
    onOpenLinkInBrowserRef.current = onOpenLinkInBrowser;
    onCwdChangeRef.current = onCwdChange;
    onFocusHintsRef.current = onFocusHints;
  }, [onCwdChange, onFocusHints, onOpenLinkInBrowser, onPtyCreated, onPtyLost]);

  useEffect(() => {
    cwdRef.current = cwd;
  }, [cwd]);

  useEffect(() => {
    projectPathRef.current = projectPath;
  }, [projectPath]);

  const spawnTerminal = useCallback(async () => {
    if (creatingRef.current) {
      return;
    }

    creatingRef.current = true;

    try {
      const queuedLaunchCommand =
        useTerminalSessionStore.getState().takePendingLaunchCommand(paneIdRef.current) ??
        restoreCommandRef.current?.trim() ??
        null;
      const createdPtyId = await window.nexus.terminal.create(cwdRef.current, agentRef.current);
      terminalExitedRef.current = false;
      ptyIdRef.current = createdPtyId;
      onPtyCreatedRef.current(createdPtyId);
      applyCwdChange(cwdRef.current);

      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;

      if (terminal) {
        await restoreTerminalScrollback(
          terminal,
          createdPtyId,
          paneIdRef.current,
          parseStreamRef.current,
          suppressShellPromptClearRef,
          stickToBottomRef,
          disposedRef,
        );

        replayedScrollbackRef.current = { ptyId: createdPtyId, terminal };
      }

      window.setTimeout(() => {
        if (ptyIdRef.current !== createdPtyId) {
          return;
        }

        if (!queuedLaunchCommand) {
          return;
        }

        window.nexus.terminal.write(createdPtyId, `${queuedLaunchCommand}\n`);
        useTerminalSessionStore.getState().setLastCommand(paneIdRef.current, queuedLaunchCommand);
      }, LAUNCH_COMMAND_DELAY_MS);

      if (terminal && fitAddon && containerRef.current) {
        scheduleTerminalGeometrySync(
          fitAddon,
          terminal,
          containerRef.current,
          createdPtyId,
          stickToBottomRef,
          isVisibleRef.current,
          disposedRef,
        );

        if (isFocusedRef.current) {
          terminal.focus();
        }
      }
    } catch (error) {
      const terminal = terminalRef.current;
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      terminal?.writeln(`\r\n\x1b[38;5;203mFalha ao iniciar o terminal: ${message}\x1b[0m`);
    } finally {
      creatingRef.current = false;
    }
  }, [applyCwdChange]);

  spawnTerminalRef.current = spawnTerminal;

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 1,
      fontFamily: 'SF Mono, Fira Code, Cascadia Code, Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      letterSpacing: 0,
      theme: buildTerminalTheme(agentRef.current),
      allowTransparency: true,
      drawBoldTextInBrightColors: true,
      minimumContrastRatio: 1,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    applyTransparentViewport(container);

    const themeObserver = new MutationObserver(() => {
      applyTransparentViewport(container);
    });

    themeObserver.observe(container, {
      attributes: true,
      attributeFilter: ['style'],
      subtree: true,
    });

    requestAnimationFrame(() => {
      applyTransparentViewport(container);
      terminal.refresh(0, terminal.rows - 1);
      scheduleTerminalGeometrySync(
        fitAddon,
        terminal,
        container,
        ptyIdRef.current,
        stickToBottomRef,
        isVisibleRef.current,
        disposedRef,
      );
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || !isFocusedRef.current) {
        return true;
      }

      if (hintsKeyboardActiveRef.current) {
        if (
          event.key === 'ArrowLeft' ||
          event.key === 'ArrowRight' ||
          event.key === 'ArrowUp' ||
          event.key === 'Enter' ||
          event.key === 'Escape'
        ) {
          return false;
        }
      }

      if (event.key === 'ArrowDown' && !hintsKeyboardActiveRef.current && onFocusHintsRef.current) {
        if (isOverlayBlockingTerminalHints()) {
          return true;
        }

        if (!isFocusedRef.current || !terminalDomFocusedRef.current) {
          return true;
        }

        const terminal = terminalRef.current;

        if (terminal && readShellPromptInput(terminal).length > 0) {
          return true;
        }

        event.preventDefault();
        onFocusHintsRef.current();
        return false;
      }

      return true;
    });

    const resizeObserver = new ResizeObserver(() => {
      if (!isVisibleRef.current) {
        return;
      }

      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }

      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        fitTerminal(fitAddon, terminal, container, ptyIdRef.current, stickToBottomRef, isVisibleRef.current);
      });
    });

    resizeObserver.observe(container);

    const completeIfAwaiting = createSettledCallback(() => {
      if (!suppressShellPromptClearRef.current) {
        completeShellIdleTaskIfAwaiting(paneIdRef.current);
      }

      handleAutomationPaneShellPrompt(paneIdRef.current);
      handleMobileReleaseShellPrompt(paneIdRef.current);
    });

    const parseStream = createTerminalOutputParser(
      (nextCwd) => {
        cwdRef.current = nextCwd;
        onCwdChangeRef.current(nextCwd);

        if (isVisibleRef.current && !suppressShellPromptClearRef.current) {
          useTerminalSessionStore.getState().clearActiveAgentOnShellPrompt(paneIdRef.current);
        }
      },
      completeIfAwaiting,
    );

    parseStreamRef.current = parseStream;

    const agentReadyDetector = createAgentReadyStreamDetector(
      () => {
        if (!suppressShellPromptClearRef.current) {
          completeAgentGitTurn(paneIdRef.current);
          useTerminalSessionStore.getState().completeTaskIfAwaiting(paneIdRef.current);
        }

        const session = useTerminalSessionStore.getState();
        const paneId = paneIdRef.current;
        const ptyId = ptyIdRef.current;

        if (!ptyId || !session.activeAgentByPane[paneId]) {
          return;
        }

        dispatchPendingAgentTaskCommands(paneId, (command) => {
          if (ptyIdRef.current !== ptyId) {
            return;
          }

          void startMobileReleaseFromCommand(paneId, command);
          window.nexus.terminal.write(ptyId, `${command}\n`);
        });
      },
      {
        isAwaiting: () => {
          const session = useTerminalSessionStore.getState();
          const paneId = paneIdRef.current;
          return isPaneTrackingAgentCompletion(
            paneId,
            session.awaitingResponseByPane,
            session.agentNotifyEligibleByPane,
            session.agentBusyByPane,
          );
        },
        isBlocked: () => {
          const paneId = paneIdRef.current;
          const pending = useAgentGitChangeStore.getState().pendingTurnByPane[paneId];

          if (pending) {
            return false;
          }

          return Boolean(useTerminalSessionStore.getState().agentBusyByPane[paneId]);
        },
      },
    );
    const disposeAgentDetectorReset = trackAgentReadyDetectorReset(
      paneIdRef.current,
      () => agentReadyDetector.reset(),
    );

    let inputLine = '';

    const handleSubmittedLine = (line: string) => {
      const trimmed = line.trim();

      if (trimmed) {
        stickToBottomRef.current = true;

        const session = useTerminalSessionStore.getState();
        const paneId = paneIdRef.current;

        if (shouldMarkAgentAwaiting(paneId, trimmed, session.activeAgentByPane)) {
          session.setLastCommand(paneId, trimmed);
          trackAgentGitPrompt(paneId, trimmed);
          session.markAwaitingResponse(paneId);
        } else {
          session.setLastCommand(paneId, trimmed);
        }

        void startMobileReleaseFromCommand(paneId, trimmed);
      }

      if (isAgentSessionRef.current) {
        useTerminalPasteImageStore.getState().clearPaneImages(paneIdRef.current);
      }

      const target = parseCdCommandLine(line);

      if (!target) {
        return;
      }

      void window.nexus.files.resolveCdPath(cwdRef.current, target).then((resolved) => {
        cwdRef.current = resolved;
        onCwdChangeRef.current(resolved);
      });
    };

    const scrollDisposable = terminal.onScroll(() => {
      stickToBottomRef.current = isTerminalAtBottom(terminal);
    });

    const unsubscribeData = window.nexus.terminal.onData((incomingPtyId, data) => {
      if (incomingPtyId !== ptyIdRef.current) {
        return;
      }

      agentReadyDetector.feed(data);
      feedMobileReleaseOutput(paneIdRef.current, data);

      if (!isVisibleRef.current || isProjectSwitching()) {
        scheduleSyncPasteImagesFromPromptRef.current(true);
        return;
      }

      const activeTerminal = terminalRef.current;

      if (!canUseTerminal(activeTerminal, disposedRef)) {
        return;
      }

      writeTerminalOutput(activeTerminal, parseStream(data), stickToBottomRef);
      scheduleSyncPasteImagesFromPromptRef.current(true);
    });

    const unsubscribeExit = window.nexus.terminal.onExit((incomingPtyId, code) => {
      if (incomingPtyId !== ptyIdRef.current) {
        return;
      }

      const activeTerminal = terminalRef.current;

      if (!canUseTerminal(activeTerminal, disposedRef)) {
        return;
      }

      activeTerminal.writeln(`\r\n\x1b[38;5;244m[processo encerrou com código ${code}]\x1b[0m`);
      terminalExitedRef.current = true;
      ptyIdRef.current = null;
      onPtyLostRef.current();
    });

    const dataDisposable = terminal.onData((data) => {
      if (ptyIdRef.current) {
        window.nexus.terminal.write(ptyIdRef.current, data);
      }

      for (const char of data) {
        if (char === '\r' || char === '\n') {
          const submittedLine = isAgentSessionRef.current
            ? readShellPromptInput(terminal) || sanitizeAgentPrompt(inputLine)
            : inputLine;
          handleSubmittedLine(submittedLine);
          inputLine = '';
          scheduleSyncPasteImagesFromPromptRef.current(true);
          continue;
        }

        if (char === '\u007f') {
          inputLine = inputLine.slice(0, -1);
          scheduleSyncPasteImagesFromPromptRef.current(true);
          continue;
        }

        if (char === '\u0015') {
          inputLine = '';
          continue;
        }

        if (char.charCodeAt(0) >= 32) {
          inputLine += char;
        }
      }
    });

    const linkDisposable = registerNexusTerminalLinks(terminal, (url) => {
      onOpenLinkInBrowserRef.current(url);
    });

    const handlePaste = (event: ClipboardEvent) => {
      if (!isAgentSessionRef.current) {
        return;
      }

      const clipboardData = event.clipboardData;
      const hasImageItem = clipboardData
        ? Array.from(clipboardData.items).some((item) => item.type.startsWith('image/'))
        : false;

      if (!hasImageItem) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      void readClipboardImageDataUrl(event).then(async (dataUrl) => {
        if (!dataUrl) {
          return;
        }

        await attachAgentPromptImageToPane(projectPathRef.current, paneIdRef.current, dataUrl);
        scheduleSyncPasteImagesFromPromptRef.current(true);
      });
    };

    container.addEventListener('paste', handlePaste, true);

    const handleContextMenu = (event: MouseEvent) => {
      const url = findUrlAtTerminalPosition(terminal, event);

      if (!url) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setLinkMenu({ url, x: event.clientX, y: event.clientY });
    };

    container.addEventListener('contextmenu', handleContextMenu);

    const handleFocusIn = () => {
      terminalDomFocusedRef.current = true;
    };

    const handleFocusOut = (event: FocusEvent) => {
      const relatedTarget = event.relatedTarget;

      if (relatedTarget instanceof Node && container.contains(relatedTarget)) {
        return;
      }

      terminalDomFocusedRef.current = false;
    };

    container.addEventListener('focusin', handleFocusIn);
    container.addEventListener('focusout', handleFocusOut);

    return () => {
      disposedRef.current = true;

      if (syncPasteImagesTimerRef.current !== null) {
        window.clearTimeout(syncPasteImagesTimerRef.current);
        syncPasteImagesTimerRef.current = null;
      }

      if (syncPasteImagesFrameRef.current !== null) {
        window.cancelAnimationFrame(syncPasteImagesFrameRef.current);
        syncPasteImagesFrameRef.current = null;
      }

      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }

      container.removeEventListener('paste', handlePaste, true);
      container.removeEventListener('contextmenu', handleContextMenu);
      container.removeEventListener('focusin', handleFocusIn);
      container.removeEventListener('focusout', handleFocusOut);
      disposeAgentDetectorReset();
      scrollDisposable.dispose();
      linkDisposable.dispose();
      themeObserver.disconnect();
      dataDisposable.dispose();
      unsubscribeData();
      unsubscribeExit();
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      replayedScrollbackRef.current = null;
    };
  }, []);

  useEffect(() => {
    void (async () => {
      if (ptyId) {
        const exists = await window.nexus.terminal.has(ptyId);

        if (exists) {
          ptyIdRef.current = ptyId;
          const terminal = terminalRef.current;
          const fitAddon = fitAddonRef.current;

          if (terminal) {
            const alreadyReplayed =
              replayedScrollbackRef.current?.ptyId === ptyId &&
              replayedScrollbackRef.current.terminal === terminal;
            const needsRestore = terminal.buffer.active.length <= 1;

            if (!alreadyReplayed || needsRestore) {
              await restoreTerminalScrollback(
                terminal,
                ptyId,
                paneIdRef.current,
                parseStreamRef.current,
                suppressShellPromptClearRef,
                stickToBottomRef,
                disposedRef,
              );
              replayedScrollbackRef.current = { ptyId, terminal };
            }
          }

          if (terminal && fitAddon && isVisible && containerRef.current && canUseTerminal(terminal, disposedRef)) {
            scheduleTerminalGeometrySync(
              fitAddon,
              terminal,
              containerRef.current,
              ptyId,
              stickToBottomRef,
              true,
              disposedRef,
            );
          }

          return;
        }

        ptyIdRef.current = null;
        onPtyLostRef.current();
      } else if (ptyIdRef.current) {
        const exists = await window.nexus.terminal.has(ptyIdRef.current);

        if (exists) {
          return;
        }

        ptyIdRef.current = null;
      }

      if (!ptyIdRef.current && !creatingRef.current && isRuntimeActive && !terminalExitedRef.current) {
        await spawnTerminalRef.current();
      }
    })();
  }, [isRuntimeActive, ptyId]);

  useEffect(() => {
    if (isVisible) {
      return;
    }

    const activePtyId = ptyIdRef.current;

    if (!activePtyId) {
      return;
    }

    void saveScrollbackForPane(paneIdRef.current, activePtyId);
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const generation = scrollbackReplayGenerationRef.current + 1;
    scrollbackReplayGenerationRef.current = generation;

    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    const activePtyId = ptyIdRef.current;

    if (!terminal || !fitAddon) {
      return;
    }

    const delay = isFocusedRef.current ? 0 : 120;

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        if (generation !== scrollbackReplayGenerationRef.current) {
          return;
        }

        if (activePtyId && (await window.nexus.terminal.has(activePtyId))) {
          if (generation !== scrollbackReplayGenerationRef.current) {
            return;
          }

          await forceReplayTerminalScrollback(
            terminal,
            activePtyId,
            paneIdRef.current,
            parseStreamRef.current,
            suppressShellPromptClearRef,
            stickToBottomRef,
            disposedRef,
          );

          if (generation !== scrollbackReplayGenerationRef.current) {
            return;
          }

          replayedScrollbackRef.current = { ptyId: activePtyId, terminal };
        }

        if (generation !== scrollbackReplayGenerationRef.current) {
          return;
        }

        if (
          containerRef.current &&
          canUseTerminal(terminalRef.current, disposedRef) &&
          fitAddonRef.current
        ) {
          scheduleTerminalGeometrySync(
            fitAddonRef.current,
            terminalRef.current,
            containerRef.current,
            ptyIdRef.current,
            stickToBottomRef,
            true,
            disposedRef,
          );
        }
      })();
    }, delay);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isVisible]);

  useEffect(() => {
    if (prevAgentRef.current === agent) {
      return;
    }

    prevAgentRef.current = agent;

    if (!isVisible || !ptyIdRef.current) {
      return;
    }

    terminalExitedRef.current = false;
    window.nexus.terminal.kill(ptyIdRef.current);
    ptyIdRef.current = null;
    onPtyLostRef.current();
  }, [agent, isVisible]);

  useEffect(() => {
    if (!isFocused || !ptyId) {
      return;
    }

    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;

    if (!terminal || !fitAddon || !containerRef.current) {
      return;
    }

    scheduleTerminalGeometrySync(
      fitAddon,
      terminal,
      containerRef.current,
      ptyId,
      stickToBottomRef,
      true,
      disposedRef,
    );
    terminal.focus();
  }, [isFocused, ptyId]);

  const handleCloseLinkMenu = useCallback(() => {
    setLinkMenu(null);
  }, []);

  const handleOpenLinkInBrowser = useCallback((url: string) => {
    onOpenLinkInBrowserRef.current(url);
  }, []);

  const requestTerminalRestart = useCallback(() => {
    if (!terminalExitedRef.current || creatingRef.current || !isVisibleRef.current) {
      return;
    }

    terminalExitedRef.current = false;
    void spawnTerminalRef.current();
  }, [spawnTerminal]);

  const handleContainerMouseDown = useCallback(() => {
    requestTerminalRestart();
  }, [requestTerminalRestart]);

  return (
    <>
      <div
        className='terminal-panel__container'
        style={{ '--terminal-cursor': TERMINAL_AGENTS[agent].cursorColor } as CSSProperties}
        onMouseDown={handleContainerMouseDown}
      >
        <div ref={containerRef} className='terminal-panel__xterm-mount' />
      </div>
      {linkMenu ? (
        <TerminalLinkContextMenu
          url={linkMenu.url}
          x={linkMenu.x}
          y={linkMenu.y}
          onClose={handleCloseLinkMenu}
          onOpenInBrowser={handleOpenLinkInBrowser}
        />
      ) : null}
    </>
  );
});

export const XTermView = memo(XTermViewComponent);

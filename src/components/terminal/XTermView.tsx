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
import { findUrlAtTerminalPosition, registerNexusTerminalLinks } from '@/utils/terminalLink';
import { createTerminalOutputParser } from '@/utils/terminalStream';
import {
  createAgentReadyStreamDetector,
  createSettledCallback,
  trackAgentReadyDetectorReset,
} from '@/utils/terminalTaskCompletion';
import { parseCdCommandLine } from '@/utils/terminalCwd';
import { isOverlayBlockingTerminalHints } from '@/utils/overlayBlocking';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { useTerminalPasteImageStore } from '@/stores/useTerminalPasteImageStore';
import { readClipboardImageDataUrl } from '@/utils/terminalClipboardImage';
import {
  buildRemoveImagePromptSequence,
  parseImageTokenIds,
} from '@/utils/terminalPasteImageTokens';

function readShellPromptInput(terminal: Terminal): string {
  const buffer = terminal.buffer.active;
  const line = buffer.getLine(buffer.cursorY);

  if (!line) {
    return '';
  }

  const lineText = line.translateToString(true).replace(/\s+$/, '');
  const arrowMatch = lineText.match(/(?:^|\s)->\s*(.*)$/);

  if (arrowMatch) {
    return (arrowMatch[1] ?? '').trim();
  }

  const match = lineText.match(/[%#]\s*(.*)$/);

  if (!match) {
    return lineText.trim();
  }

  return (match[1] ?? '').trim();
}

export interface XTermViewHandle {
  focus: () => void;
  write: (data: string) => void;
  interruptAndRun: (command: string) => Promise<void>;
  removeImageFromPrompt: (imageId: number) => void;
}

interface XTermViewProps {
  paneId: string;
  ptyId: string | null;
  isVisible: boolean;
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
}

function fitTerminal(fitAddon: FitAddon, terminal: Terminal, ptyId: string | null): void {
  fitAddon.fit();

  if (ptyId && terminal.cols > 0 && terminal.rows > 0) {
    window.nexus.terminal.resize(ptyId, terminal.cols, terminal.rows);
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
    ptyId,
    isVisible,
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
  const onPtyCreatedRef = useRef(onPtyCreated);
  const onPtyLostRef = useRef(onPtyLost);
  const onOpenLinkInBrowserRef = useRef(onOpenLinkInBrowser);
  const onCwdChangeRef = useRef(onCwdChange);
  const onFocusHintsRef = useRef(onFocusHints);
  const cwdRef = useRef(cwd);
  const parseStreamRef = useRef<(data: string) => string>((data) => data);
  const replayedScrollbackRef = useRef<{ ptyId: string; terminal: Terminal } | null>(null);
  const suppressShellPromptClearRef = useRef(false);
  const syncPasteImagesTimerRef = useRef<number | null>(null);
  const paneIdRef = useRef(paneId);
  const isVisibleRef = useRef(isVisible);
  const [linkMenu, setLinkMenu] = useState<{ url: string; x: number; y: number } | null>(null);

  paneIdRef.current = paneId;
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
        const sequence = buildRemoveImagePromptSequence(imageId, promptText);

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
    const activeIds = parseImageTokenIds(promptText);

    useTerminalPasteImageStore.getState().syncPaneImages(paneIdRef.current, activeIds);
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

  const spawnTerminal = useCallback(async () => {
    if (creatingRef.current) {
      return;
    }

    creatingRef.current = true;

    try {
      const createdPtyId = await window.nexus.terminal.create(cwd, agentRef.current);
      ptyIdRef.current = createdPtyId;
      onPtyCreatedRef.current(createdPtyId);
      applyCwdChange(cwd);

      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;

      if (terminal) {
        const savedScrollback = await window.nexus.session.getScrollback(paneIdRef.current);

        if (savedScrollback) {
          suppressShellPromptClearRef.current = true;
          terminal.write(parseStreamRef.current(savedScrollback));
          suppressShellPromptClearRef.current = false;
          replayedScrollbackRef.current = { ptyId: createdPtyId, terminal };
        }
      }

      window.setTimeout(() => {
        if (ptyIdRef.current !== createdPtyId) {
          return;
        }

        const pendingCommand = useTerminalSessionStore
          .getState()
          .takePendingLaunchCommand(paneIdRef.current);

        if (!pendingCommand) {
          return;
        }

        window.nexus.terminal.write(createdPtyId, `${pendingCommand}\n`);
        useTerminalSessionStore.getState().setLastCommand(paneIdRef.current, pendingCommand);
      }, 350);

      if (terminal && fitAddon) {
        requestAnimationFrame(() => {
          fitTerminal(fitAddon, terminal, createdPtyId);

          if (isFocusedRef.current) {
            terminal.focus();
          }
        });
      }
    } catch (error) {
      const terminal = terminalRef.current;
      const message = error instanceof Error ? error.message : 'Erro desconhecido';
      terminal?.writeln(`\r\n\x1b[38;5;203mFalha ao iniciar o terminal: ${message}\x1b[0m`);
    } finally {
      creatingRef.current = false;
    }
  }, [applyCwdChange, cwd]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: false,
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
      fitTerminal(fitAddon, terminal, ptyIdRef.current);
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
      fitTerminal(fitAddon, terminal, ptyIdRef.current);
    });

    resizeObserver.observe(container);

    const completeIfAwaiting = createSettledCallback(() => {
      if (!suppressShellPromptClearRef.current) {
        useTerminalSessionStore.getState().completeTaskIfAwaiting(paneIdRef.current);
      }
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
          useTerminalSessionStore.getState().completeTaskIfAwaiting(paneIdRef.current);
        }
      },
      {
        isAwaiting: () =>
          useTerminalSessionStore.getState().awaitingResponseByPane[paneIdRef.current] === true,
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
        useTerminalSessionStore.getState().markAwaitingResponse(paneIdRef.current);
        useTerminalSessionStore.getState().setLastCommand(paneIdRef.current, trimmed);
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

    const unsubscribeData = window.nexus.terminal.onData((incomingPtyId, data) => {
      if (incomingPtyId === ptyIdRef.current) {
        agentReadyDetector.feed(data);
        terminal.write(parseStream(data));
        scheduleSyncPasteImagesFromPromptRef.current(true);
      }
    });

    const unsubscribeExit = window.nexus.terminal.onExit((incomingPtyId, code) => {
      if (incomingPtyId !== ptyIdRef.current) {
        return;
      }

      terminal.writeln(`\r\n\x1b[38;5;244m[processo encerrou com código ${code}]\x1b[0m`);
      ptyIdRef.current = null;
      onPtyLostRef.current();
    });

    const dataDisposable = terminal.onData((data) => {
      if (ptyIdRef.current) {
        window.nexus.terminal.write(ptyIdRef.current, data);
      }

      for (const char of data) {
        if (char === '\r' || char === '\n') {
          handleSubmittedLine(inputLine);
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

      void readClipboardImageDataUrl(event).then((dataUrl) => {
        if (!dataUrl) {
          return;
        }

        useTerminalPasteImageStore.getState().addImage(paneIdRef.current, dataUrl);
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
      if (syncPasteImagesTimerRef.current !== null) {
        window.clearTimeout(syncPasteImagesTimerRef.current);
        syncPasteImagesTimerRef.current = null;
      }

      if (syncPasteImagesFrameRef.current !== null) {
        window.cancelAnimationFrame(syncPasteImagesFrameRef.current);
        syncPasteImagesFrameRef.current = null;
      }

      container.removeEventListener('paste', handlePaste, true);
      container.removeEventListener('contextmenu', handleContextMenu);
      container.removeEventListener('focusin', handleFocusIn);
      container.removeEventListener('focusout', handleFocusOut);
      disposeAgentDetectorReset();
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
            const scrollback = await window.nexus.terminal.getScrollback(ptyId);
            const alreadyReplayed =
              replayedScrollbackRef.current?.ptyId === ptyId &&
              replayedScrollbackRef.current.terminal === terminal;

            if (scrollback && !alreadyReplayed) {
              suppressShellPromptClearRef.current = true;
              terminal.write(parseStreamRef.current(scrollback));
              suppressShellPromptClearRef.current = false;
              replayedScrollbackRef.current = { ptyId, terminal };
            }
          }

          if (terminal && fitAddon && isVisible) {
            requestAnimationFrame(() => {
              fitTerminal(fitAddon, terminal, ptyId);
            });
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

      if (!ptyIdRef.current && !creatingRef.current && isVisible) {
        await spawnTerminal();
      }
    })();
  }, [cwd, isVisible, ptyId, spawnTerminal]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;

    if (!terminal || !fitAddon) {
      return;
    }

    requestAnimationFrame(() => {
      fitTerminal(fitAddon, terminal, ptyIdRef.current);
    });
  }, [isVisible]);

  useEffect(() => {
    if (prevAgentRef.current === agent) {
      return;
    }

    prevAgentRef.current = agent;

    if (!isVisible || !ptyIdRef.current) {
      return;
    }

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

    if (!terminal || !fitAddon) {
      return;
    }

    requestAnimationFrame(() => {
      fitTerminal(fitAddon, terminal, ptyId);
      terminal.focus();
    });
  }, [isFocused, ptyId]);

  const handleCloseLinkMenu = useCallback(() => {
    setLinkMenu(null);
  }, []);

  const handleOpenLinkInBrowser = useCallback((url: string) => {
    onOpenLinkInBrowserRef.current(url);
  }, []);

  return (
    <>
      <div
        className='terminal-panel__container'
        style={{ '--terminal-cursor': TERMINAL_AGENTS[agent].cursorColor } as CSSProperties}
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

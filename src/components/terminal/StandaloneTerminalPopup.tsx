import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Terminal, X } from 'lucide-react';
import { OVERLAY_MODAL_DURATION_MS, useAnimatedUnmount } from '@/hooks/useAnimatedUnmount';
import { TerminalFooter } from '@/components/terminal/TerminalFooter';
import { XTermView } from '@/components/terminal/XTermView';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { registerModalOpen } from '@/utils/overlayBlocking';
import { parseCdCommandLine } from '@/utils/terminalCwd';
import { registerTerminalHandle } from '@/utils/terminalHandleRegistry';
import { shortenPath } from '@/utils/shortenPath';
import type { TerminalTab, XTermViewHandle } from '@/types';

const STANDALONE_TERMINAL_PANE_ID = 'standalone-global-terminal';
const STANDALONE_TERMINAL_PROJECT_ID = 'standalone-global-terminal';

interface StandaloneTerminalPopupProps {
  ptyId: string | null;
  onPtyCreated: (ptyId: string) => void;
  onPtyLost: () => void;
  onClose: () => void;
}

function StandaloneTerminalPopupComponent({
  ptyId,
  onPtyCreated,
  onPtyLost,
  onClose,
}: StandaloneTerminalPopupProps) {
  const { phase, requestClose } = useAnimatedUnmount(onClose, OVERLAY_MODAL_DURATION_MS);
  const terminalHandleRef = useRef<XTermViewHandle | null>(null);
  const [homePath, setHomePath] = useState<string | null>(null);
  const [cwd, setCwd] = useState('');
  const [hintsKeyboardActive, setHintsKeyboardActive] = useState(false);
  const [hintsActiveIndex, setHintsActiveIndex] = useState(0);
  const hintsCountRef = useRef(0);

  const tab = useMemo<TerminalTab>(
    () => ({
      id: STANDALONE_TERMINAL_PANE_ID,
      title: 'Terminal',
      type: 'terminal',
      ptyId,
      agent: 'shell',
      terminalCwd: cwd || null,
    }),
    [cwd, ptyId],
  );

  const displayCwd = useMemo(() => {
    if (!cwd || (homePath && cwd === homePath)) {
      return '~';
    }

    return shortenPath(cwd);
  }, [cwd, homePath]);

  useEffect(() => registerModalOpen(), []);

  useEffect(() => {
    let cancelled = false;

    void window.nexus.files.resolveCdPath('/', '~').then((path) => {
      if (cancelled) {
        return;
      }

      setHomePath(path);
      setCwd((current) => current || path);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleTerminalRef = useCallback((handle: XTermViewHandle | null) => {
    terminalHandleRef.current = handle;
    registerTerminalHandle(STANDALONE_TERMINAL_PANE_ID, handle);
    handle?.focus();
  }, []);

  const handleHintsCountChange = useCallback((count: number) => {
    hintsCountRef.current = count;

    if (count === 0) {
      setHintsKeyboardActive(false);
    }
  }, []);

  const handleFocusHints = useCallback(() => {
    if (hintsCountRef.current === 0) {
      return;
    }

    setHintsKeyboardActive(true);
    setHintsActiveIndex(0);
  }, []);

  const handleDismissHints = useCallback((focusTerminal = true) => {
    setHintsKeyboardActive(false);

    if (focusTerminal) {
      terminalHandleRef.current?.focus();
    }
  }, []);

  const handlePtyLost = useCallback(() => {
    useTerminalSessionStore.getState().setActiveAgent(STANDALONE_TERMINAL_PANE_ID, null);
    onPtyLost();
  }, [onPtyLost]);

  const handleRunCommand = useCallback(
    (command: string) => {
      const commandLine = command.replace(/\n$/, '');

      if (commandLine) {
        useTerminalSessionStore.getState().setLastCommand(STANDALONE_TERMINAL_PANE_ID, commandLine);
      }

      terminalHandleRef.current?.write(command);

      const target = parseCdCommandLine(commandLine);

      if (!target) {
        return;
      }

      void window.nexus.files.resolveCdPath(cwd, target).then(setCwd);
    },
    [cwd],
  );

  const handleOpenLink = useCallback((url: string) => {
    void window.nexus.tasks.openExternalUrl(url);
  }, []);

  return createPortal(
    <div className={`project-dialog-overlay overlay-backdrop--${phase}`} onMouseDown={requestClose}>
      <div
        className={`project-dialog standalone-terminal-popup overlay-panel--${phase}`}
        role='dialog'
        aria-label='Terminal'
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className='standalone-terminal-popup__header'>
          <div className='standalone-terminal-popup__heading'>
            <span className='standalone-terminal-popup__title'>
              <Terminal size={15} strokeWidth={2} />
              Terminal
            </span>
            <span className='standalone-terminal-popup__path' title={cwd || undefined}>
              {displayCwd}
            </span>
          </div>
          <button
            type='button'
            className='standalone-terminal-popup__close app-button app-button--enter'
            aria-label='Fechar terminal'
            onClick={requestClose}
          >
            <X size={16} strokeWidth={2.25} />
          </button>
        </div>
        <div className='standalone-terminal-popup__body'>
          {homePath ? (
            <div className='workspace-pane terminal-panel__shell terminal-panel__shell--shell'>
              <div className='terminal-panel__body'>
                <XTermView
                  ref={handleTerminalRef}
                  paneId={STANDALONE_TERMINAL_PANE_ID}
                  projectPath={homePath}
                  ptyId={ptyId}
                  isVisible
                  isRuntimeActive
                  isFocused
                  cwd={cwd || homePath}
                  agent='shell'
                  isAgentSession={false}
                  onPtyCreated={onPtyCreated}
                  onPtyLost={handlePtyLost}
                  onCwdChange={setCwd}
                  onOpenLinkInBrowser={handleOpenLink}
                  onFocusHints={handleFocusHints}
                  hintsKeyboardActive={hintsKeyboardActive}
                />
              </div>
              <TerminalFooter
                tab={tab}
                projectId={STANDALONE_TERMINAL_PROJECT_ID}
                cwd={cwd || homePath}
                isVisible
                keyboardActive={hintsKeyboardActive}
                activeIndex={hintsActiveIndex}
                onActiveIndexChange={setHintsActiveIndex}
                onDismissKeyboard={handleDismissHints}
                onHintsCountChange={handleHintsCountChange}
                onRunCommand={handleRunCommand}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export const StandaloneTerminalPopup = memo(StandaloneTerminalPopupComponent);

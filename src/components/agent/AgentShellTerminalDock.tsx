import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Terminal, X } from 'lucide-react';
import { XTermView } from '@/components/terminal/XTermView';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import {
  useAgentShellTerminalEntries,
  useAgentShellTerminalStore,
  type AgentShellTerminalEntry,
} from '@/stores/useAgentShellTerminalStore';
import { registerModalOpen } from '@/utils/overlayBlocking';
import { registerTerminalHandle } from '@/utils/terminalHandleRegistry';
import type { XTermViewHandle } from '@/types';

interface AgentShellTerminalDockProps {
  agentPaneId: string;
  projectPath: string;
  onComposerFocus?: () => void;
}

function formatElapsed(startedAt: number, now: number): string {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

interface AgentShellTerminalPanelProps {
  entry: AgentShellTerminalEntry;
  agentPaneId: string;
  projectPath: string;
  isOpen: boolean;
  onClose: () => void;
}

function AgentShellTerminalPanelComponent({
  entry,
  agentPaneId,
  projectPath,
  isOpen,
  onClose,
}: AgentShellTerminalPanelProps) {
  const updateEntry = useAgentShellTerminalStore((state) => state.updateEntry);
  const terminalHandleRef = useRef<XTermViewHandle | null>(null);
  const [cwd, setCwd] = useState(entry.cwd);

  const handleTerminalRef = useCallback((handle: XTermViewHandle | null) => {
    terminalHandleRef.current = handle;
    registerTerminalHandle(entry.paneId, handle);
  }, [entry.paneId]);

  const handlePtyCreated = useCallback(
    (ptyId: string) => {
      updateEntry(agentPaneId, entry.paneId, {
        ptyId,
        status: 'running',
      });
      useTerminalSessionStore.getState().setLastCommand(entry.paneId, entry.command);
    },
    [agentPaneId, entry.command, entry.paneId, updateEntry],
  );

  const handlePtyLost = useCallback(() => {
    updateEntry(agentPaneId, entry.paneId, { ptyId: null });
  }, [agentPaneId, entry.paneId, updateEntry]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    window.requestAnimationFrame(() => {
      terminalHandleRef.current?.focus();
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    return registerModalOpen();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  return createPortal(
    <div
      className={`agent-shell-terminal-panel${isOpen ? ' agent-shell-terminal-panel--open' : ''}`}
    >
      {isOpen ? (
        <button
          type='button'
          className='agent-shell-terminal-panel__backdrop app-button'
          aria-label='Fechar terminal'
          onClick={onClose}
        />
      ) : null}
      <div
        className={`agent-shell-terminal-panel__dialog${isOpen ? ' agent-shell-terminal-panel__dialog--open' : ' agent-shell-terminal-panel__dialog--hidden'}`}
      >
        {isOpen ? (
          <div className='agent-shell-terminal-panel__header'>
            <div className='agent-shell-terminal-panel__heading'>
              <span className='agent-shell-terminal-panel__title'>{entry.title}</span>
              <span className='agent-shell-terminal-panel__command'>{entry.command}</span>
            </div>
            <button
              type='button'
              className='agent-shell-terminal-panel__close app-button app-button--enter'
              aria-label='Fechar terminal'
              onClick={onClose}
            >
              <X size={16} strokeWidth={2.25} />
            </button>
          </div>
        ) : null}
        <div className='agent-shell-terminal-panel__body terminal-panel__body'>
          <XTermView
            ref={handleTerminalRef}
            paneId={entry.paneId}
            projectPath={projectPath}
            ptyId={entry.ptyId}
            isVisible={isOpen}
            isRuntimeActive
            isFocused={isOpen}
            cwd={cwd}
            agent='shell'
            isAgentSession={false}
            onPtyCreated={handlePtyCreated}
            onPtyLost={handlePtyLost}
            onCwdChange={setCwd}
            onOpenLinkInBrowser={() => undefined}
            restoreCommand={entry.command}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

const AgentShellTerminalPanel = memo(AgentShellTerminalPanelComponent);

interface AgentShellTerminalDockItemProps {
  entry: AgentShellTerminalEntry;
  elapsedLabel: string;
  isOpen: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}

function AgentShellTerminalDockItemComponent({
  entry,
  elapsedLabel,
  isOpen,
  onOpen,
  onDismiss,
}: AgentShellTerminalDockItemProps) {
  return (
    <div className={`agent-shell-terminal-dock__item${isOpen ? ' agent-shell-terminal-dock__item--open' : ''}`}>
      <button
        type='button'
        className='agent-shell-terminal-dock__item-main app-button app-button--enter'
        onClick={onOpen}
      >
        <Terminal size={14} strokeWidth={2.25} className='agent-shell-terminal-dock__item-icon' />
        <span className='agent-shell-terminal-dock__item-title'>{entry.title}</span>
        <span className='agent-shell-terminal-dock__item-elapsed'>{elapsedLabel}</span>
      </button>
      <button
        type='button'
        className='agent-shell-terminal-dock__item-dismiss app-button app-button--enter'
        aria-label={`Encerrar ${entry.title}`}
        onClick={onDismiss}
      >
        <X size={14} strokeWidth={2.25} />
      </button>
    </div>
  );
}

const AgentShellTerminalDockItem = memo(AgentShellTerminalDockItemComponent);

function AgentShellTerminalDockComponent({
  agentPaneId,
  projectPath,
  onComposerFocus,
}: AgentShellTerminalDockProps) {
  const entries = useAgentShellTerminalEntries(agentPaneId);
  const removeEntry = useAgentShellTerminalStore((state) => state.removeEntry);
  const disposePaneSession = useTerminalSessionStore((state) => state.disposePaneSession);
  const [openPaneId, setOpenPaneId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const visibleEntries = useMemo(
    () => entries.filter((entry) => entry.status !== 'completed' && entry.status !== 'failed'),
    [entries],
  );

  const closePanel = useCallback(() => {
    setOpenPaneId(null);
    window.requestAnimationFrame(() => {
      onComposerFocus?.();
    });
  }, [onComposerFocus]);

  useEffect(() => {
    if (visibleEntries.length === 0) {
      setOpenPaneId(null);
      return;
    }

    if (openPaneId && !visibleEntries.some((entry) => entry.paneId === openPaneId)) {
      setOpenPaneId(null);
    }
  }, [openPaneId, visibleEntries]);

  useEffect(() => {
    if (visibleEntries.length === 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [visibleEntries.length]);

  const handleDismiss = useCallback(
    (entry: AgentShellTerminalEntry) => {
      if (entry.ptyId) {
        window.nexus.terminal.kill(entry.ptyId);
      }

      disposePaneSession(entry.paneId);
      registerTerminalHandle(entry.paneId, null);
      removeEntry(agentPaneId, entry.paneId);

      if (openPaneId === entry.paneId) {
        closePanel();
      }
    },
    [agentPaneId, closePanel, disposePaneSession, openPaneId, removeEntry],
  );

  if (visibleEntries.length === 0) {
    return null;
  }

  const countLabel =
    visibleEntries.length === 1 ? '1 Terminal Running' : `${visibleEntries.length} Terminals Running`;

  return (
    <>
      <div className='agent-shell-terminal-dock app-button--enter'>
        <div className='agent-shell-terminal-dock__header'>{countLabel}</div>
        <div className='agent-shell-terminal-dock__list'>
          {visibleEntries.map((entry) => (
            <AgentShellTerminalDockItem
              key={entry.paneId}
              entry={entry}
              elapsedLabel={formatElapsed(entry.startedAt, now)}
              isOpen={openPaneId === entry.paneId}
              onOpen={() => setOpenPaneId(entry.paneId)}
              onDismiss={() => handleDismiss(entry)}
            />
          ))}
        </div>
      </div>

      {visibleEntries.map((entry) => (
        <AgentShellTerminalPanel
          key={entry.paneId}
          entry={entry}
          agentPaneId={agentPaneId}
          projectPath={projectPath}
          isOpen={openPaneId === entry.paneId}
          onClose={closePanel}
        />
      ))}
    </>
  );
}

export const AgentShellTerminalDock = memo(AgentShellTerminalDockComponent);

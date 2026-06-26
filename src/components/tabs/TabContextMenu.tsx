import {
  ChevronRight,
  Columns2,
  History,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Terminal,
  X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownAtPointer,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { useTabActions } from '@/stores/useTabStore';
import type { CursorAgentHistoryEntry, Project, TabBarItem, TerminalTab } from '@/types';
import { buildCursorAgentResumeCommand } from '@/utils/cursorAgentResume';
import {
  resolveAgentPaneForTab,
  tabHasAgentSession,
} from '@/utils/resolveAgentPaneForTab';
import { getPanesFromItem, isSplitTab } from '@/utils/tabGroups';
import { MAX_PINNED_TABS, countPinnedTabs, isTabPinned } from '@/utils/tabOrder';

interface TabContextMenuProps {
  tab: TabBarItem;
  project: Project;
  x: number;
  y: number;
  pinnedCount: number;
  canCloseAllTabs: boolean;
  onClose: () => void;
  onRename: (tabId: string) => void;
  onUnsplit: (tabId: string) => void;
  onTogglePin: (tabId: string) => void;
  onCloseAllTabs: () => void;
}

function formatHistoryDate(updatedAtMs: number): string {
  if (!updatedAtMs) {
    return '';
  }

  return new Date(updatedAtMs).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncateRestartCommand(command: string, maxLength = 72): string {
  const singleLine = command.replace(/\s+/g, ' ').trim();

  if (singleLine.length <= maxLength) {
    return singleLine;
  }

  return `${singleLine.slice(0, maxLength - 1)}…`;
}

function TabContextMenuComponent({
  tab,
  project,
  x,
  y,
  pinnedCount,
  canCloseAllTabs,
  onClose,
  onRename,
  onUnsplit,
  onTogglePin,
  onCloseAllTabs,
}: TabContextMenuProps) {
  const activeAgentByPane = useTerminalSessionStore((state) => state.activeAgentByPane);
  const lastRestartCommands = useTerminalSessionStore((state) => state.lastRestartCommands);
  const restartingPaneIds = useTerminalSessionStore((state) => state.restartingPaneIds);
  const restartTerminalPane = useTerminalSessionStore((state) => state.restartTerminalPane);
  const resumeAgentSession = useTerminalSessionStore((state) => state.resumeAgentSession);
  const { selectPane } = useTabActions();
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAtPointer(menu, x, y),
    [x, y],
  );
  const historyRowRef = useRef<HTMLDivElement>(null);
  const historyCloseTimerRef = useRef<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<CursorAgentHistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const canUnsplit = isSplitTab(tab);
  const pinned = isTabPinned(tab);
  const canPin = pinned || pinnedCount < MAX_PINNED_TABS;
  const showAgentHistory = tabHasAgentSession(tab, activeAgentByPane);
  const agentPane = useMemo(
    () => (showAgentHistory ? resolveAgentPaneForTab(tab, project, activeAgentByPane) : null),
    [activeAgentByPane, project, showAgentHistory, tab],
  );

  const terminalRestartEntries = useMemo(
    () =>
      getPanesFromItem(tab)
        .filter((pane): pane is TerminalTab => pane.type === 'terminal')
        .map((pane) => ({
          pane,
          lastCommand: lastRestartCommands[pane.id] ?? null,
        }))
        .filter((entry): entry is { pane: TerminalTab; lastCommand: string } =>
          Boolean(entry.lastCommand),
        ),
    [lastRestartCommands, tab],
  );

  const showPaneTitleInRestart = terminalRestartEntries.length > 1;

  const loadHistory = useCallback(async () => {
    if (historyLoaded || historyLoading) {
      return;
    }

    setHistoryLoading(true);

    try {
      const entries = await window.nexus.files.listCursorAgentHistory(project.path);
      setHistoryEntries(entries);
      setHistoryLoaded(true);
    } finally {
      setHistoryLoading(false);
    }
  }, [historyLoaded, historyLoading, project.path]);

  useEffect(() => {
    if (!showAgentHistory) {
      return;
    }

    void loadHistory();
  }, [loadHistory, showAgentHistory]);

  useEffect(() => {
    return () => {
      if (historyCloseTimerRef.current !== null) {
        window.clearTimeout(historyCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        requestClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        requestClose();
      }
    };

    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown);
    }, 0);

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuRef, requestClose]);

  const runAction = useCallback(
    (action: () => void) => (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      action();
      requestClose();
    },
    [requestClose],
  );

  const handleRename = useCallback(
    runAction(() => onRename(tab.id)),
    [onRename, runAction, tab.id],
  );

  const handleUnsplit = useCallback(
    runAction(() => onUnsplit(tab.id)),
    [onUnsplit, runAction, tab.id],
  );

  const handleTogglePin = useCallback(
    runAction(() => onTogglePin(tab.id)),
    [onTogglePin, runAction, tab.id],
  );

  const handleCloseAllTabs = useCallback(
    runAction(() => onCloseAllTabs()),
    [onCloseAllTabs, runAction],
  );

  const handleRestartTerminal = useCallback(
    (paneId: string) =>
      runAction(() => {
        void restartTerminalPane(paneId, selectPane, false);
      }),
    [restartTerminalPane, runAction, selectPane],
  );

  const handleResumeSession = useCallback(
    (entry: CursorAgentHistoryEntry) =>
      runAction(() => {
        if (!agentPane) {
          return;
        }

        const command = buildCursorAgentResumeCommand(entry.id, project.path);
        void resumeAgentSession(agentPane.id, command, selectPane);
      }),
    [agentPane, project.path, resumeAgentSession, runAction, selectPane],
  );

  const clearHistoryCloseTimer = useCallback(() => {
    if (historyCloseTimerRef.current !== null) {
      window.clearTimeout(historyCloseTimerRef.current);
      historyCloseTimerRef.current = null;
    }
  }, []);

  const handleHistoryEnter = useCallback(() => {
    clearHistoryCloseTimer();
    setHistoryOpen(true);
    void loadHistory();
  }, [clearHistoryCloseTimer, loadHistory]);

  const scheduleHistoryClose = useCallback(() => {
    clearHistoryCloseTimer();
    historyCloseTimerRef.current = window.setTimeout(() => {
      setHistoryOpen(false);
      historyCloseTimerRef.current = null;
    }, 180);
  }, [clearHistoryCloseTimer]);

  const handleHistoryLeave = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget;

      if (nextTarget instanceof Node && historyRowRef.current?.contains(nextTarget)) {
        return;
      }

      scheduleHistoryClose();
    },
    [scheduleHistoryClose],
  );

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu overlay-popup--anchor-pointer ${animationClass}`}
      role='menu'
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type='button' className='context-menu__item' role='menuitem' onMouseDown={handleRename}>
        <Pencil size={14} strokeWidth={2} aria-hidden />
        <span>Renomear</span>
      </button>
      <button
        type='button'
        className='context-menu__item'
        role='menuitem'
        disabled={!canPin}
        onMouseDown={canPin ? handleTogglePin : undefined}
      >
        {pinned ? (
          <PinOff size={14} strokeWidth={2} aria-hidden />
        ) : (
          <Pin size={14} strokeWidth={2} aria-hidden />
        )}
        <span>{pinned ? 'Desafixar aba' : 'Fixar aba'}</span>
      </button>
      {canUnsplit ? (
        <button
          type='button'
          className='context-menu__item'
          role='menuitem'
          onMouseDown={handleUnsplit}
        >
          <Columns2 size={14} strokeWidth={2} aria-hidden />
          <span>Desagrupar</span>
        </button>
      ) : null}
      {showAgentHistory ? (
        <>
          <div className='context-menu__separator' />
          <div
            ref={historyRowRef}
            className={`context-menu__submenu-row${historyOpen ? ' context-menu__submenu-row--open' : ''}`}
            onMouseEnter={handleHistoryEnter}
            onMouseLeave={handleHistoryLeave}
          >
            <button
              type='button'
              className='context-menu__item context-menu__item--submenu'
              role='menuitem'
              aria-haspopup='menu'
              aria-expanded={historyOpen}
            >
              <History size={14} strokeWidth={2} aria-hidden />
              <span>Histórico</span>
              <ChevronRight size={14} strokeWidth={2} className='context-menu__submenu-chevron' aria-hidden />
            </button>
            {historyOpen ? (
              <>
                <div
                  className='context-menu__submenu-bridge'
                  aria-hidden='true'
                  onMouseEnter={handleHistoryEnter}
                  onMouseLeave={handleHistoryLeave}
                />
                <div
                  className='context-menu context-menu__submenu overlay-popup--in'
                  role='menu'
                  onMouseEnter={handleHistoryEnter}
                  onMouseLeave={handleHistoryLeave}
                >
                {historyLoading ? (
                  <div className='context-menu__submenu-state'>
                    <Loader2 size={14} strokeWidth={2} className='context-menu__spinner' aria-hidden />
                    <span>Carregando...</span>
                  </div>
                ) : historyEntries.length === 0 ? (
                  <div className='context-menu__submenu-state'>Nenhuma sessão encontrada</div>
                ) : (
                  historyEntries.map((entry) => (
                    <button
                      key={entry.id}
                      type='button'
                      className='context-menu__item context-menu__item--history'
                      role='menuitem'
                      disabled={Boolean(agentPane && restartingPaneIds[agentPane.id])}
                      onMouseDown={
                        agentPane && restartingPaneIds[agentPane.id]
                          ? undefined
                          : handleResumeSession(entry)
                      }
                    >
                      <span className='context-menu__history-title'>{entry.title}</span>
                      <span className='context-menu__history-date'>
                        {formatHistoryDate(entry.updatedAtMs)}
                      </span>
                    </button>
                  ))
                )}
                </div>
              </>
            ) : null}
          </div>
        </>
      ) : null}
      {terminalRestartEntries.length > 0 ? (
        <>
          <div className='context-menu__separator' />
          {terminalRestartEntries.map((entry) => {
            const isRestarting = Boolean(restartingPaneIds[entry.pane.id]);

            return (
              <button
                key={entry.pane.id}
                type='button'
                className={`context-menu__item context-menu__item--command${isRestarting ? ' context-menu__item--disabled' : ''}`}
                role='menuitem'
                disabled={isRestarting}
                onMouseDown={isRestarting ? undefined : handleRestartTerminal(entry.pane.id)}
              >
                {isRestarting ? (
                  <Loader2 size={14} strokeWidth={2} className='context-menu__spinner' aria-hidden />
                ) : (
                  <Terminal size={14} strokeWidth={2} aria-hidden />
                )}
                <span
                  className={`context-menu__command${isRestarting ? ' context-menu__command--loading' : ''}`}
                  title={entry.lastCommand}
                >
                  {showPaneTitleInRestart ? `${entry.pane.title} · ` : ''}
                  {truncateRestartCommand(entry.lastCommand)}
                </span>
              </button>
            );
          })}
        </>
      ) : null}
      <div className='context-menu__separator' />
      <button
        type='button'
        className='context-menu__item context-menu__item--danger'
        role='menuitem'
        disabled={!canCloseAllTabs}
        onMouseDown={canCloseAllTabs ? handleCloseAllTabs : undefined}
      >
        <X size={14} strokeWidth={2} aria-hidden />
        <span>Fechar todas as abas</span>
      </button>
    </div>,
    document.body,
  );
}

export const TabContextMenu = memo(TabContextMenuComponent);

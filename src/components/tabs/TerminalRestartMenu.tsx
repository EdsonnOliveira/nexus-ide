import { Loader2 } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { useTabActions } from '@/stores/useTabStore';
import type { TerminalTab } from '@/types';
import { collectTerminalPanes } from '@/utils/tabGroups';
import { resolveTabBadgeColor } from '@/utils/tabBadge';

interface TerminalRestartMenuProps {
  anchorRect: DOMRect;
  onClose: () => void;
}

function TerminalRestartMenuComponent({ anchorRect, onClose }: TerminalRestartMenuProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const lastRestartCommands = useTerminalSessionStore((state) => state.lastRestartCommands);
  const restartingPaneIds = useTerminalSessionStore((state) => state.restartingPaneIds);
  const restartTerminalPane = useTerminalSessionStore((state) => state.restartTerminalPane);
  const { selectPane } = useTabActions();

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );

  const terminalEntries = useMemo(() => {
    if (!activeProject) {
      return [];
    }

    return collectTerminalPanes(activeProject.tabs)
      .map((pane, index) => ({
        pane: pane as TerminalTab,
        badgeIndex: index + 1,
        badgeColor: resolveTabBadgeColor(pane, index),
        lastCommand: lastRestartCommands[pane.id] ?? null,
      }))
      .filter((entry) => Boolean(entry.lastCommand));
  }, [activeProject, lastRestartCommands]);

  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownBelowAnchor(menu, anchorRect, 'end'),
    [anchorRect, terminalEntries.length],
  );

  const hasOpenTerminals = useMemo(() => {
    if (!activeProject) {
      return false;
    }

    return collectTerminalPanes(activeProject.tabs).length > 0;
  }, [activeProject]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        requestClose();
      }
    };

    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [requestClose]);

  const handleRestart = useCallback(
    (paneId: string) => {
      void restartTerminalPane(paneId, selectPane);
    },
    [restartTerminalPane, selectPane],
  );

  const handleSelect = useCallback(
    (paneId: string) => (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      handleRestart(paneId);
    },
    [handleRestart],
  );

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu terminal-restart-menu overlay-popup--anchor-end ${animationClass}`}
      role='menu'
    >
      {terminalEntries.length === 0 ? (
        <div className='terminal-restart-menu__empty'>
          {hasOpenTerminals ? 'Nenhum comando recente nos terminais' : 'Nenhum terminal aberto'}
        </div>
      ) : null}
      {terminalEntries.map((entry, index) => {
        const isRestarting = Boolean(restartingPaneIds[entry.pane.id]);

        return (
          <button
            key={entry.pane.id}
            type='button'
            className={`terminal-restart-menu__item${index === activeIndex ? ' terminal-restart-menu__item--active' : ''}${isRestarting ? ' terminal-restart-menu__item--disabled' : ''}`}
            role='menuitem'
            disabled={isRestarting}
            onMouseDown={isRestarting ? undefined : handleSelect(entry.pane.id)}
            onMouseEnter={() => setActiveIndex(index)}
          >
            <span
              className={`terminal-restart-menu__badge${isRestarting ? ' terminal-restart-menu__badge--loading' : ''}`}
              style={{ backgroundColor: entry.badgeColor }}
            >
              {isRestarting ? (
                <Loader2 size={10} strokeWidth={2.5} className='terminal-restart-menu__spinner' />
              ) : (
                entry.badgeIndex
              )}
            </span>
            <span
              className={`terminal-restart-menu__label${isRestarting ? ' terminal-restart-menu__label--loading' : ''}`}
            >
              {entry.pane.title}
              {` - ${entry.lastCommand}`}
            </span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

export const TerminalRestartMenu = memo(TerminalRestartMenuComponent);

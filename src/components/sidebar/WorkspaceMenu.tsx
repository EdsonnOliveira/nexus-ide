import { Check, FolderKanban, Plus } from 'lucide-react';
import { memo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { WorkspaceMark } from '@/components/sidebar/WorkspaceMark';
import {
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { Workspace } from '@/types';

interface WorkspaceMenuProps {
  anchorRect: DOMRect;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  hasHiddenNotifications: boolean;
  notifiedWorkspaceIds: Set<string>;
  hasRunningAgent: boolean;
  runningAgentWorkspaceIds: Set<string>;
  onClose: () => void;
  onSelect: (workspaceId: string | null) => void;
  onCreate: () => void;
  onContextMenu: (workspace: Workspace, x: number, y: number) => void;
}

function WorkspaceMenuComponent({
  anchorRect,
  workspaces,
  activeWorkspaceId,
  hasHiddenNotifications,
  notifiedWorkspaceIds,
  hasRunningAgent,
  runningAgentWorkspaceIds,
  onClose,
  onSelect,
  onCreate,
  onContextMenu,
}: WorkspaceMenuProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownBelowAnchor(menu, anchorRect, 'start'),
    [anchorRect],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (menuRef.current?.contains(target)) {
        return;
      }

      if (target instanceof Element && target.closest('[data-workspace-submenu]')) {
        return;
      }

      requestClose();
    };

    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [requestClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [requestClose]);

  const handleSelectAll = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onSelect(null);
      requestClose();
    },
    [onSelect, requestClose],
  );

  const handleSelectWorkspace = useCallback(
    (workspaceId: string) => (event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onSelect(workspaceId);
      requestClose();
    },
    [onSelect, requestClose],
  );

  const handleWorkspaceContextMenu = useCallback(
    (workspace: Workspace) => (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onContextMenu(workspace, event.clientX, event.clientY);
    },
    [onContextMenu],
  );

  const handleCreate = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onCreate();
      requestClose();
    },
    [onCreate, requestClose],
  );

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu workspace-menu overlay-popup--anchor-start ${animationClass}`}
      role='menu'
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type='button'
        className={`context-menu__item workspace-menu__all${activeWorkspaceId === null ? ' context-menu__item--active' : ''}${hasHiddenNotifications ? ' workspace-menu__item--notified' : ''}`}
        role='menuitem'
        onMouseDown={handleSelectAll}
      >
        <span className='workspace-menu__icon-wrap'>
          <FolderKanban size={14} strokeWidth={2} aria-hidden />
          {hasHiddenNotifications ? (
            <span className='project-item__ping project-item__ping--red workspace-menu__ping' aria-hidden='true' />
          ) : null}
        </span>
        <span>Todos os projetos</span>
        {hasRunningAgent ? (
          <span
            className='project-item__agent project-item__agent--loading workspace-menu__agent'
            aria-label='Agent em execução'
          />
        ) : null}
        {activeWorkspaceId === null ? <Check size={14} strokeWidth={2} aria-hidden /> : null}
      </button>
      {workspaces.length > 0 ? <div className='context-menu__separator' /> : null}
      {workspaces.map((workspace) => {
        const isActive = activeWorkspaceId === workspace.id;
        const hasNotification = notifiedWorkspaceIds.has(workspace.id);
        const isAgentRunning = runningAgentWorkspaceIds.has(workspace.id);
        const isFlagged = Boolean(workspace.flag);

        return (
          <button
            key={workspace.id}
            type='button'
            className={`context-menu__item workspace-menu__item${isActive ? ' context-menu__item--active' : ''}${hasNotification ? ' workspace-menu__item--notified' : ''}${isFlagged ? ' workspace-menu__item--flagged' : ''}`}
            role='menuitem'
            onMouseDown={handleSelectWorkspace(workspace.id)}
            onContextMenu={handleWorkspaceContextMenu(workspace)}
          >
            <span className='workspace-menu__icon-wrap'>
              <WorkspaceMark workspace={workspace} />
              {hasNotification ? (
                <span className='project-item__ping project-item__ping--red workspace-menu__ping' aria-hidden='true' />
              ) : null}
            </span>
            <span className='workspace-menu__label'>{workspace.name}</span>
            {isAgentRunning ? (
              <span
                className='project-item__agent project-item__agent--loading workspace-menu__agent'
                aria-label='Agent em execução'
              />
            ) : null}
            {isActive ? (
              <Check size={14} strokeWidth={2} className='workspace-menu__check' aria-hidden />
            ) : null}
          </button>
        );
      })}
      <div className='context-menu__separator' />
      <button type='button' className='context-menu__item' role='menuitem' onMouseDown={handleCreate}>
        <Plus size={14} strokeWidth={2} aria-hidden />
        <span>Nova workspace...</span>
      </button>
    </div>,
    document.body,
  );
}

export const WorkspaceMenu = memo(WorkspaceMenuComponent);

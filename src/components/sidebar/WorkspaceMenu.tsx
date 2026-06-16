import { Check, FolderKanban, Plus, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { Workspace } from '@/types';

interface WorkspaceMenuProps {
  anchorRect: DOMRect;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  canDeleteWorkspace: boolean;
  onClose: () => void;
  onSelect: (workspaceId: string | null) => void;
  onCreate: () => void;
  onDelete: (workspaceId: string) => void;
}

function WorkspaceMenuComponent({
  anchorRect,
  workspaces,
  activeWorkspaceId,
  canDeleteWorkspace,
  onClose,
  onSelect,
  onCreate,
  onDelete,
}: WorkspaceMenuProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownBelowAnchor(menu, anchorRect, 'start'),
    [anchorRect],
  );

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
      event.preventDefault();
      event.stopPropagation();
      onSelect(null);
      requestClose();
    },
    [onSelect, requestClose],
  );

  const handleSelectWorkspace = useCallback(
    (workspaceId: string) => (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onSelect(workspaceId);
      requestClose();
    },
    [onSelect, requestClose],
  );

  const handleDeleteWorkspace = useCallback(
    (workspaceId: string) => (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onDelete(workspaceId);
      requestClose();
    },
    [onDelete, requestClose],
  );

  const handleCreate = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
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
    >
      <button
        type='button'
        className={`context-menu__item${activeWorkspaceId === null ? ' context-menu__item--active' : ''}`}
        role='menuitem'
        onMouseDown={handleSelectAll}
      >
        <FolderKanban size={14} strokeWidth={2} aria-hidden />
        <span>Todos os projetos</span>
        {activeWorkspaceId === null ? <Check size={14} strokeWidth={2} aria-hidden /> : null}
      </button>
      {workspaces.length > 0 ? <div className='context-menu__separator' /> : null}
      {workspaces.map((workspace) => {
        const isActive = activeWorkspaceId === workspace.id;

        return (
          <div key={workspace.id} className='workspace-menu__row'>
            <button
              type='button'
              className={`context-menu__item workspace-menu__item${isActive ? ' context-menu__item--active' : ''}`}
              role='menuitem'
              onMouseDown={handleSelectWorkspace(workspace.id)}
            >
              <span className='workspace-menu__dot' aria-hidden />
              <span className='workspace-menu__label'>{workspace.name}</span>
              {isActive ? (
                <Check size={14} strokeWidth={2} className='workspace-menu__check' aria-hidden />
              ) : null}
            </button>
            {canDeleteWorkspace ? (
              <button
                type='button'
                className='workspace-menu__delete'
                aria-label={`Excluir workspace ${workspace.name}`}
                onMouseDown={handleDeleteWorkspace(workspace.id)}
              >
                <Trash2 size={14} strokeWidth={2} aria-hidden />
              </button>
            ) : null}
          </div>
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

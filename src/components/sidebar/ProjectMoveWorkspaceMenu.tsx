import { memo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownAtPointer,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { Workspace } from '@/types';

interface ProjectMoveWorkspaceMenuProps {
  x: number;
  y: number;
  workspaces: Workspace[];
  currentWorkspaceId: string;
  onClose: () => void;
  onSelect: (workspaceId: string) => void;
}

function ProjectMoveWorkspaceMenuComponent({
  x,
  y,
  workspaces,
  currentWorkspaceId,
  onClose,
  onSelect,
}: ProjectMoveWorkspaceMenuProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAtPointer(menu, x, y),
    [x, y],
  );
  const availableWorkspaces = workspaces.filter((workspace) => workspace.id !== currentWorkspaceId);

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
        requestClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [requestClose]);

  const handleSelect = useCallback(
    (workspaceId: string) => (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onSelect(workspaceId);
      requestClose();
    },
    [onSelect, requestClose],
  );

  if (availableWorkspaces.length === 0) {
    return null;
  }

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu overlay-popup--anchor-pointer ${animationClass}`}
      role='menu'
      onContextMenu={(event) => event.preventDefault()}
    >
      {availableWorkspaces.map((workspace) => (
        <button
          key={workspace.id}
          type='button'
          className='context-menu__item'
          role='menuitem'
          onMouseDown={handleSelect(workspace.id)}
        >
          <span className='workspace-menu__dot' aria-hidden />
          <span>{workspace.name}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

export const ProjectMoveWorkspaceMenu = memo(ProjectMoveWorkspaceMenuComponent);

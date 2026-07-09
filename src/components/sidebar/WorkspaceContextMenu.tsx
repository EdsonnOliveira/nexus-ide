import {
  Flag,
  ImageOff,
  ImagePlus,
  Pencil,
  Shapes,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownAtPointer,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { Workspace } from '@/types';

interface WorkspaceContextMenuProps {
  workspace: Workspace;
  x: number;
  y: number;
  canDelete: boolean;
  onClose: () => void;
  onSetLogo: (workspaceId: string) => void;
  onRemoveLogo: (workspaceId: string) => void;
  onSetIcon: (workspaceId: string) => void;
  onRename: (workspaceId: string) => void;
  onCreateFlag: (workspaceId: string) => void;
  onDelete: (workspaceId: string) => void;
}

interface WorkspaceContextMenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

function WorkspaceContextMenuComponent({
  workspace,
  x,
  y,
  canDelete,
  onClose,
  onSetLogo,
  onRemoveLogo,
  onSetIcon,
  onRename,
  onCreateFlag,
  onDelete,
}: WorkspaceContextMenuProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAtPointer(menu, x, y),
    [x, y],
    'dropdown',
    { closeOthers: false },
  );
  const hasLogo = Boolean(workspace.logo);
  const hasFlag = Boolean(workspace.flag);

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
  }, [requestClose]);

  const runAction = useCallback(
    (action: () => void) => (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      action();
      requestClose();
    },
    [requestClose],
  );

  const menuItems = useMemo<WorkspaceContextMenuItem[]>(() => {
    const items: WorkspaceContextMenuItem[] = [
      {
        id: 'set-logo',
        label: 'Definir logo...',
        icon: ImagePlus,
        onSelect: () => onSetLogo(workspace.id),
      },
    ];

    if (hasLogo) {
      items.push({
        id: 'remove-logo',
        label: 'Remover logo',
        icon: ImageOff,
        onSelect: () => onRemoveLogo(workspace.id),
      });
    }

    if (!hasLogo) {
      items.push({
        id: 'set-icon',
        label: 'Definir ícone...',
        icon: Shapes,
        onSelect: () => onSetIcon(workspace.id),
      });
    }

    items.push({
      id: 'rename',
      label: 'Renomear',
      icon: Pencil,
      onSelect: () => onRename(workspace.id),
    });

    if (!hasFlag) {
      items.push({
        id: 'create-flag',
        label: 'Criar flag',
        icon: Flag,
        onSelect: () => onCreateFlag(workspace.id),
      });
    }

    items.push({
      id: 'delete',
      label: 'Excluir',
      icon: Trash2,
      onSelect: () => onDelete(workspace.id),
      disabled: !canDelete,
      danger: true,
    });

    return items;
  }, [
    canDelete,
    hasFlag,
    hasLogo,
    onCreateFlag,
    onDelete,
    onRemoveLogo,
    onRename,
    onSetIcon,
    onSetLogo,
    workspace.id,
  ]);

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu overlay-popup--anchor-pointer ${animationClass}`}
      role='menu'
      data-workspace-submenu='true'
      onContextMenu={(event) => event.preventDefault()}
    >
      {menuItems.map((item) => {
        const Icon = item.icon;
        const showSeparator = item.id === 'rename' || item.id === 'delete';

        return (
          <div key={item.id}>
            {showSeparator ? <div className='context-menu__separator' /> : null}
            <button
              type='button'
              className={`context-menu__item${item.danger ? ' context-menu__item--danger' : ''}`}
              role='menuitem'
              disabled={item.disabled}
              onMouseDown={item.disabled ? undefined : runAction(item.onSelect)}
            >
              <Icon size={14} strokeWidth={2} aria-hidden />
              <span>{item.label}</span>
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

export const WorkspaceContextMenu = memo(WorkspaceContextMenuComponent);

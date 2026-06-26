import {
  ArrowRightLeft,
  Copy,
  Flag,
  FolderOpen,
  ImagePlus,
  ImageOff,
  Palette,
  Pencil,
  Shapes,
  Square,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownAtPointer,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { Project } from '@/types';
import { getRevealInFolderLabel } from '@/utils/explorerRelativePath';

interface ProjectContextMenuProps {
  project: Project;
  x: number;
  y: number;
  canMoveWorkspace: boolean;
  onClose: () => void;
  onSetLogo: (projectId: string) => void;
  onRemoveLogo: (projectId: string) => void;
  onSetIcon: (projectId: string) => void;
  onSetIconColor: (projectId: string) => void;
  onRename: (projectId: string) => void;
  onCreateFlag: (projectId: string) => void;
  onMove: (projectId: string, anchorRect: DOMRect) => void;
  onStopAll: (projectId: string) => void;
  onDelete: (projectId: string) => void;
}

interface ProjectContextMenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

function ProjectContextMenuComponent({
  project,
  x,
  y,
  canMoveWorkspace,
  onClose,
  onSetLogo,
  onRemoveLogo,
  onSetIcon,
  onSetIconColor,
  onRename,
  onCreateFlag,
  onMove,
  onStopAll,
  onDelete,
}: ProjectContextMenuProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAtPointer(menu, x, y),
    [x, y],
  );
  const hasCustomIcon = project.iconCustomized;
  const hasLogo = Boolean(project.logo);
  const hasFlag = Boolean(project.flag);

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

  const handleMoveItem = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const anchorRect = menuRef.current?.getBoundingClientRect();

      if (anchorRect) {
        onMove(project.id, anchorRect);
      }

      requestClose();
    },
    [onMove, project.id, requestClose],
  );

  const handleRevealInFolder = useCallback(async () => {
    const resolvedPath = await window.nexus.files.resolveCdPath('/', project.path);
    void window.nexus.files.revealInFolder(resolvedPath);
  }, [project.path]);

  const handleCopyPathname = useCallback(() => {
    void navigator.clipboard.writeText(project.path);
  }, [project.path]);

  const menuItems = useMemo<ProjectContextMenuItem[]>(() => {
    const items: ProjectContextMenuItem[] = [
      {
        id: 'set-logo',
        label: 'Definir logo...',
        icon: ImagePlus,
        onSelect: () => onSetLogo(project.id),
      },
    ];

    if (hasLogo) {
      items.push({
        id: 'remove-logo',
        label: 'Remover logo',
        icon: ImageOff,
        onSelect: () => onRemoveLogo(project.id),
      });
    }

    if (!hasLogo) {
      items.push({
        id: 'set-icon',
        label: 'Definir ícone...',
        icon: Shapes,
        onSelect: () => onSetIcon(project.id),
      });
    }

    if (!hasLogo && hasCustomIcon) {
      items.push({
        id: 'set-icon-color',
        label: 'Definir cor do ícone...',
        icon: Palette,
        onSelect: () => onSetIconColor(project.id),
      });
    }

    items.push(
      {
        id: 'rename',
        label: 'Renomear projeto',
        icon: Pencil,
        onSelect: () => onRename(project.id),
      },
      ...(hasFlag
        ? []
        : [
            {
              id: 'create-flag',
              label: 'Criar flag',
              icon: Flag,
              onSelect: () => onCreateFlag(project.id),
            } satisfies ProjectContextMenuItem,
          ]),
      {
        id: 'move',
        label: 'Mover projeto...',
        icon: ArrowRightLeft,
        onSelect: () => undefined,
        disabled: !canMoveWorkspace,
      },
      {
        id: 'reveal-in-folder',
        label: getRevealInFolderLabel(),
        icon: FolderOpen,
        onSelect: () => {
          void handleRevealInFolder();
        },
      },
      {
        id: 'copy-pathname',
        label: 'Copiar pathname',
        icon: Copy,
        onSelect: handleCopyPathname,
      },
      {
        id: 'stop-all',
        label: 'Parar tudo',
        icon: Square,
        onSelect: () => onStopAll(project.id),
        disabled: project.tabs.length === 0,
      },
      {
        id: 'delete',
        label: 'Excluir projeto',
        icon: Trash2,
        onSelect: () => onDelete(project.id),
        danger: true,
      },
    );

    return items;
  }, [
    canMoveWorkspace,
    handleCopyPathname,
    handleRevealInFolder,
    hasCustomIcon,
    hasFlag,
    hasLogo,
    onCreateFlag,
    onDelete,
    onStopAll,
    onRemoveLogo,
    project.tabs.length,
    onRename,
    onSetIcon,
    onSetIconColor,
    onSetLogo,
    project.id,
  ]);

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu overlay-popup--anchor-pointer ${animationClass}`}
      role='menu'
      onContextMenu={(event) => event.preventDefault()}
    >
      {menuItems.map((item) => {
        const Icon = item.icon;
        const showSeparator =
          item.id === 'rename' || item.id === 'create-flag' || item.id === 'stop-all';

        return (
          <div key={item.id}>
            {showSeparator ? <div className='context-menu__separator' /> : null}
            <button
              type='button'
              className={`context-menu__item${item.danger ? ' context-menu__item--danger' : ''}`}
              role='menuitem'
              disabled={item.disabled}
              onMouseDown={
                item.disabled
                  ? undefined
                  : item.id === 'move'
                    ? handleMoveItem
                    : runAction(item.onSelect)
              }
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

export const ProjectContextMenu = memo(ProjectContextMenuComponent);

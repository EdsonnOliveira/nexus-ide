import {
  Code,
  Copy,
  FilePlus,
  FolderOpen,
  FolderPlus,
  MessageSquarePlus,
  Pencil,
  Trash2,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownAtPointer,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { ProjectDirectoryEntry } from '@/types';
import { getRevealInFolderLabel, isMarkdownFile } from '@/utils/explorerRelativePath';

interface ExplorerEntryContextMenuProps {
  entry?: ProjectDirectoryEntry;
  x: number;
  y: number;
  canAddToChat?: boolean;
  onClose: () => void;
  onNewFile?: () => void;
  onNewFolder?: () => void;
  onAddToChat?: (entry: ProjectDirectoryEntry) => void;
  onRevealInFolder?: (entry: ProjectDirectoryEntry) => void;
  onCopyPath?: (entry: ProjectDirectoryEntry) => void;
  onCopyRelativePath?: (entry: ProjectDirectoryEntry) => void;
  onRename?: (entry: ProjectDirectoryEntry) => void;
  onDelete?: (entry: ProjectDirectoryEntry) => void;
  onViewCode?: (entry: ProjectDirectoryEntry) => void;
  hideRename?: boolean;
  hideDelete?: boolean;
  hideViewCode?: boolean;
}

interface ExplorerContextMenuItem {
  id: string;
  label: string;
  icon: typeof Copy;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

function ExplorerEntryContextMenuComponent({
  entry,
  x,
  y,
  canAddToChat = false,
  onClose,
  onNewFile,
  onNewFolder,
  onAddToChat,
  onRevealInFolder,
  onCopyPath,
  onCopyRelativePath,
  onRename,
  onDelete,
  onViewCode,
  hideRename = false,
  hideDelete = false,
  hideViewCode = false,
}: ExplorerEntryContextMenuProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAtPointer(menu, x, y),
    [x, y],
  );

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

  const menuItems = useMemo<ExplorerContextMenuItem[]>(() => {
    if (!entry) {
      return [
        {
          id: 'new-file',
          label: 'Novo arquivo',
          icon: FilePlus,
          onSelect: () => onNewFile?.(),
        },
        {
          id: 'new-folder',
          label: 'Nova pasta',
          icon: FolderPlus,
          onSelect: () => onNewFolder?.(),
        },
      ];
    }

    const items: ExplorerContextMenuItem[] = [
      {
        id: 'add-to-chat',
        label: 'Adicionar ao chat',
        icon: MessageSquarePlus,
        onSelect: () => onAddToChat?.(entry),
        disabled: !canAddToChat,
      },
      {
        id: 'reveal',
        label: getRevealInFolderLabel(),
        icon: FolderOpen,
        onSelect: () => onRevealInFolder?.(entry),
      },
      {
        id: 'copy-path',
        label: 'Copiar caminho',
        icon: Copy,
        onSelect: () => onCopyPath?.(entry),
      },
      {
        id: 'copy-relative-path',
        label: 'Copiar caminho relativo',
        icon: Copy,
        onSelect: () => onCopyRelativePath?.(entry),
      },
    ];

    if (!hideRename) {
      items.push({
        id: 'rename',
        label: 'Renomear',
        icon: Pencil,
        onSelect: () => onRename?.(entry),
      });
    }

    if (!hideViewCode && entry.type === 'file' && isMarkdownFile(entry.name)) {
      items.push({
        id: 'view-code',
        label: 'Ver código',
        icon: Code,
        onSelect: () => onViewCode?.(entry),
      });
    }

    if (!hideDelete) {
      items.push({
        id: 'delete',
        label: 'Deletar',
        icon: Trash2,
        onSelect: () => onDelete?.(entry),
        danger: true,
      });
    }

    return items;
  }, [
    canAddToChat,
    entry,
    hideDelete,
    hideRename,
    hideViewCode,
    onAddToChat,
    onCopyPath,
    onCopyRelativePath,
    onDelete,
    onNewFile,
    onNewFolder,
    onRename,
    onViewCode,
    onRevealInFolder,
  ]);

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu overlay-popup--anchor-pointer ${animationClass}`}
      role='menu'
      onContextMenu={(event) => event.preventDefault()}
    >
      {menuItems.map((item, index) => {
        const Icon = item.icon;
        const showSeparator = item.danger && index > 0;

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

export const ExplorerEntryContextMenu = memo(ExplorerEntryContextMenuComponent);

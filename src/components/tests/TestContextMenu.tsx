import { Pencil, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownAtPointer,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { ProjectTestEntry } from '@/types/test';

interface TestContextMenuProps {
  entry: ProjectTestEntry;
  x: number;
  y: number;
  onClose: () => void;
  onRename: (entry: ProjectTestEntry) => void;
  onDelete: (entry: ProjectTestEntry) => void;
}

function TestContextMenuComponent({ entry, x, y, onClose, onRename, onDelete }: TestContextMenuProps) {
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
  }, [requestClose, menuRef]);

  const handleRename = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onRename(entry);
      requestClose();
    },
    [entry, onRename, requestClose],
  );

  const handleDelete = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onDelete(entry);
      requestClose();
    },
    [entry, onDelete, requestClose],
  );

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu overlay-popup--anchor-pointer ${animationClass}`}
      role='menu'
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type='button'
        className='context-menu__item'
        role='menuitem'
        onMouseDown={handleRename}
      >
        <Pencil size={14} strokeWidth={2} aria-hidden />
        <span>Renomear</span>
      </button>
      <div className='context-menu__separator' />
      <button
        type='button'
        className='context-menu__item context-menu__item--danger'
        role='menuitem'
        onMouseDown={handleDelete}
      >
        <Trash2 size={14} strokeWidth={2} aria-hidden />
        <span>Excluir</span>
      </button>
    </div>,
    document.body,
  );
}

export const TestContextMenu = memo(TestContextMenuComponent);

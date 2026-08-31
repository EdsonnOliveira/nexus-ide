import { Pencil, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownAtPointer,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';

interface MissionFlowTemplateContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function MissionFlowTemplateContextMenuComponent({
  x,
  y,
  onClose,
  onEdit,
  onDelete,
}: MissionFlowTemplateContextMenuProps) {
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

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu overlay-popup--anchor-start ${animationClass}`}
      role='menu'
      onContextMenu={(event) => event.preventDefault()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        type='button'
        className='context-menu__item app-button'
        role='menuitem'
        onMouseDown={runAction(onEdit)}
      >
        <Pencil size={14} strokeWidth={2.25} aria-hidden='true' />
        <span>Editar</span>
      </button>
      <div className='context-menu__separator' />
      <button
        type='button'
        className='context-menu__item context-menu__item--danger app-button'
        role='menuitem'
        onMouseDown={runAction(onDelete)}
      >
        <Trash2 size={14} strokeWidth={2.25} aria-hidden='true' />
        <span>Apagar</span>
      </button>
    </div>,
    document.body,
  );
}

export const MissionFlowTemplateContextMenu = memo(MissionFlowTemplateContextMenuComponent);

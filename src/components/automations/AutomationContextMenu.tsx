import { Copy, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownAtPointer,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { Automation } from '@/types/automation';

interface AutomationContextMenuProps {
  automation: Automation;
  x: number;
  y: number;
  onClose: () => void;
  onCopyPrompt: (automation: Automation) => void;
  onDelete: (automation: Automation) => void;
}

function AutomationContextMenuComponent({
  automation,
  x,
  y,
  onClose,
  onCopyPrompt,
  onDelete,
}: AutomationContextMenuProps) {
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
        onMouseDown={runAction(() => onCopyPrompt(automation))}
      >
        <Copy size={14} strokeWidth={2} aria-hidden />
        <span>Copiar prompt</span>
      </button>
      <div className='context-menu__separator' />
      <button
        type='button'
        className='context-menu__item context-menu__item--danger'
        role='menuitem'
        onMouseDown={runAction(() => onDelete(automation))}
      >
        <Trash2 size={14} strokeWidth={2} aria-hidden />
        <span>Excluir</span>
      </button>
    </div>,
    document.body,
  );
}

export const AutomationContextMenu = memo(AutomationContextMenuComponent);

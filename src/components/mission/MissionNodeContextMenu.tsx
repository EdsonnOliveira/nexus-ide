import { Copy, Trash2, Workflow } from 'lucide-react';
import { memo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownAtPointer,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';

interface MissionNodeContextMenuProps {
  x: number;
  y: number;
  isToolNode: boolean;
  isMissionRoot?: boolean;
  hasFlowInstance?: boolean;
  onClose: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDeleteFlow?: () => void;
}

function MissionNodeContextMenuComponent({
  x,
  y,
  isToolNode,
  isMissionRoot = false,
  hasFlowInstance = false,
  onClose,
  onDuplicate,
  onDelete,
  onDeleteFlow,
}: MissionNodeContextMenuProps) {
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

  const entityLabel = isToolNode ? 'Display Node' : 'agent';

  if (isMissionRoot) {
    return createPortal(
      <div
        ref={menuRef}
        className={`context-menu overlay-popup--anchor-start ${animationClass}`}
        role='menu'
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className='context-menu__item context-menu__item--disabled' role='menuitem'>
          Nó principal da missão
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu overlay-popup--anchor-start ${animationClass}`}
      role='menu'
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type='button'
        className='context-menu__item'
        role='menuitem'
        onMouseDown={runAction(onDuplicate)}
      >
        <Copy size={14} strokeWidth={2} aria-hidden='true' />
        <span>Duplicar {entityLabel}</span>
      </button>
      <div className='context-menu__separator' />
      <button
        type='button'
        className='context-menu__item context-menu__item--danger'
        role='menuitem'
        onMouseDown={runAction(onDelete)}
      >
        <Trash2 size={14} strokeWidth={2} aria-hidden='true' />
        <span>Apagar {entityLabel}</span>
      </button>
      {hasFlowInstance && onDeleteFlow ? (
        <>
          <div className='context-menu__separator' />
          <button
            type='button'
            className='context-menu__item context-menu__item--danger'
            role='menuitem'
            onMouseDown={runAction(onDeleteFlow)}
          >
            <Workflow size={14} strokeWidth={2} aria-hidden='true' />
            <span>Apagar Auto Fluxo</span>
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  );
}

export const MissionNodeContextMenu = memo(MissionNodeContextMenuComponent);

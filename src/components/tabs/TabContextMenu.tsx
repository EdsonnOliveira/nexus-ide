import { Columns2, Pencil, Pin, PinOff } from 'lucide-react';
import { memo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownAtPointer,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { TabBarItem } from '@/types';
import { isSplitTab } from '@/utils/tabGroups';
import { MAX_PINNED_TABS, countPinnedTabs, isTabPinned } from '@/utils/tabOrder';

interface TabContextMenuProps {
  tab: TabBarItem;
  x: number;
  y: number;
  pinnedCount: number;
  onClose: () => void;
  onRename: (tabId: string) => void;
  onUnsplit: (tabId: string) => void;
  onTogglePin: (tabId: string) => void;
}

function TabContextMenuComponent({
  tab,
  x,
  y,
  pinnedCount,
  onClose,
  onRename,
  onUnsplit,
  onTogglePin,
}: TabContextMenuProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAtPointer(menu, x, y),
    [x, y],
  );
  const canUnsplit = isSplitTab(tab);
  const pinned = isTabPinned(tab);
  const canPin = pinned || pinnedCount < MAX_PINNED_TABS;

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

  const handleRename = useCallback(
    runAction(() => onRename(tab.id)),
    [onRename, runAction, tab.id],
  );

  const handleUnsplit = useCallback(
    runAction(() => onUnsplit(tab.id)),
    [onUnsplit, runAction, tab.id],
  );

  const handleTogglePin = useCallback(
    runAction(() => onTogglePin(tab.id)),
    [onTogglePin, runAction, tab.id],
  );

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu overlay-popup--anchor-pointer ${animationClass}`}
      role='menu'
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type='button' className='context-menu__item' role='menuitem' onMouseDown={handleRename}>
        <Pencil size={14} strokeWidth={2} aria-hidden />
        <span>Renomear</span>
      </button>
      <button
        type='button'
        className='context-menu__item'
        role='menuitem'
        disabled={!canPin}
        onMouseDown={canPin ? handleTogglePin : undefined}
      >
        {pinned ? (
          <PinOff size={14} strokeWidth={2} aria-hidden />
        ) : (
          <Pin size={14} strokeWidth={2} aria-hidden />
        )}
        <span>{pinned ? 'Desafixar aba' : 'Fixar aba'}</span>
      </button>
      {canUnsplit ? (
        <button
          type='button'
          className='context-menu__item'
          role='menuitem'
          onMouseDown={handleUnsplit}
        >
          <Columns2 size={14} strokeWidth={2} aria-hidden />
          <span>Desagrupar</span>
        </button>
      ) : null}
    </div>,
    document.body,
  );
}

export const TabContextMenu = memo(TabContextMenuComponent);

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Pin, X } from 'lucide-react';
import { TAB_DRAG_MIME } from '@/constants/tabDrag';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { PROJECT_COLORS, type TabBarItem } from '@/types';
import { resolveTabDisplayTitle } from '@/utils/resolveAgentPaneForTab';
import { resolveTabBadgeColor } from '@/utils/tabBadge';
import { isTabPinned } from '@/utils/tabOrder';
import type { ProjectPingTone } from '@/utils/projectPingTone';

interface TabItemProps {
  tab: TabBarItem;
  index: number;
  isFocused: boolean;
  isRestarting: boolean;
  hasNotification?: boolean;
  pingTone?: ProjectPingTone;
  isDropTarget: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onDragStart: (tabId: string) => void;
  onDragEnd: () => void;
  onDragOverTab: (index: number) => void;
  onDropTab: (sourceTabId: string, targetIndex: number) => void;
  onContextMenu: (tab: TabBarItem, x: number, y: number) => void;
}

function TabItemComponent({
  tab,
  index,
  isFocused,
  isRestarting,
  hasNotification = false,
  pingTone = 'red',
  isDropTarget,
  onSelect,
  onClose,
  onDragStart,
  onDragEnd,
  onDragOverTab,
  onDropTab,
  onContextMenu,
}: TabItemProps) {
  const pinned = isTabPinned(tab);
  const activeAgentByPane = useTerminalSessionStore((state) => state.activeAgentByPane);

  const badgeStyle = useMemo(() => {
    return { backgroundColor: resolveTabBadgeColor(tab) };
  }, [tab]);

  const badgeLabel = useMemo(() => index + 1, [index]);
  const pingClassName = useMemo(
    () => `project-item__ping project-item__ping--${pingTone} tab-item__ping`,
    [pingTone],
  );
  const wasRestartingRef = useRef(false);
  const itemRef = useRef<HTMLDivElement>(null);
  const [shimmerCycle, setShimmerCycle] = useState(0);
  const displayTitle = useMemo(
    () => resolveTabDisplayTitle(tab, activeAgentByPane),
    [activeAgentByPane, tab],
  );

  useEffect(() => {
    if (isRestarting && !wasRestartingRef.current) {
      setShimmerCycle((cycle) => cycle + 1);
    }

    wasRestartingRef.current = isRestarting;
  }, [isRestarting]);

  useEffect(() => {
    if (!isFocused || !itemRef.current) {
      return;
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    itemRef.current.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [isFocused, tab.id]);

  const handleSelect = useCallback(() => {
    onSelect(tab.id);
  }, [onSelect, tab.id]);

  const handleClose = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onClose(tab.id);
    },
    [onClose, tab.id],
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      onContextMenu(tab, event.clientX, event.clientY);
    },
    [onContextMenu, tab],
  );

  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.dataTransfer.setData(TAB_DRAG_MIME, tab.id);
      event.dataTransfer.effectAllowed = 'move';
      onDragStart(tab.id);
    },
    [onDragStart, tab.id],
  );

  const handleDragEnd = useCallback(() => {
    onDragEnd();
  }, [onDragEnd]);

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      onDragOverTab(index);
    },
    [index, onDragOverTab],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const sourceTabId = event.dataTransfer.getData(TAB_DRAG_MIME);

      if (sourceTabId && sourceTabId !== tab.id) {
        onDropTab(sourceTabId, index);
      }

      onDragEnd();
    },
    [index, onDragEnd, onDropTab, tab.id],
  );

  const className = useMemo(() => {
    const classes = ['tab-item'];

    if (isFocused) {
      classes.push('tab-item--active');
    }

    if (pinned) {
      classes.push('tab-item--pinned');
    }

    if (isDropTarget) {
      classes.push('tab-item--drop-target');
    }

    if (hasNotification) {
      classes.push('tab-item--notified');
    }

    return classes.join(' ');
  }, [hasNotification, isDropTarget, isFocused, pinned]);

  return (
    <div
      ref={itemRef}
      role='tab'
      tabIndex={0}
      aria-selected={isFocused}
      className={className}
      draggable
      onClick={handleSelect}
      onContextMenu={handleContextMenu}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleSelect();
        }
      }}
    >
      {pinned ? <Pin size={11} strokeWidth={2.25} className='tab-item__pin' aria-hidden='true' /> : null}
      <span className='tab-item__badge-wrap'>
        <span
          className={`tab-item__badge${isRestarting ? ' tab-item__badge--loading' : ''}`}
          style={badgeStyle}
        >
          {isRestarting ? <Loader2 size={10} strokeWidth={2.5} className='tab-item__badge-spinner' /> : badgeLabel}
        </span>
        {hasNotification ? <span className={pingClassName} aria-hidden='true' /> : null}
      </span>
      <span
        key={isRestarting ? shimmerCycle : undefined}
        className={`tab-item__title${isRestarting ? ' tab-item__title--loading' : ''}`}
      >
        {displayTitle}
      </span>
      {pinned ? null : (
        <button type='button' className='tab-item__close' onClick={handleClose} aria-label='Fechar aba'>
          <X size={16} strokeWidth={2.25} />
        </button>
      )}
    </div>
  );
}

export const TabItem = memo(TabItemComponent);

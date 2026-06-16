import { Bot, Globe, Terminal } from 'lucide-react';
import { memo, useCallback, useEffect, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';

export type TabAddOptionId = 'terminal' | 'agent' | 'browser';

interface TabAddMenuProps {
  anchorRect: DOMRect;
  onClose: () => void;
  onSelect: (optionId: TabAddOptionId) => void;
}

const TAB_ADD_OPTIONS: {
  id: TabAddOptionId;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}[] = [
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'browser', label: 'Navegador', icon: Globe },
];

function TabAddMenuComponent({ anchorRect, onClose, onSelect }: TabAddMenuProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownBelowAnchor(menu, anchorRect, 'end'),
    [anchorRect],
  );
  const [activeIndex, setActiveIndex] = useState(0);

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
        event.preventDefault();
        event.stopPropagation();
        requestClose();
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((index) => Math.min(index + 1, TAB_ADD_OPTIONS.length - 1));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setActiveIndex((index) => Math.max(index - 1, 0));
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        const option = TAB_ADD_OPTIONS[activeIndex];

        if (option) {
          onSelect(option.id);
          requestClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [activeIndex, onSelect, requestClose]);

  const handleSelect = useCallback(
    (optionId: TabAddOptionId) => (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onSelect(optionId);
      requestClose();
    },
    [onSelect, requestClose],
  );

  const handleHover = useCallback((index: number) => {
    setActiveIndex(index);
  }, []);

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu tab-add-menu overlay-popup--anchor-end ${animationClass}`}
      role='menu'
    >
      {TAB_ADD_OPTIONS.map((option, index) => {
        const Icon = option.icon;

        return (
          <button
            key={option.id}
            type='button'
            className={`tab-add-menu__item${index === activeIndex ? ' tab-add-menu__item--active' : ''}`}
            role='menuitem'
            onMouseDown={handleSelect(option.id)}
            onMouseEnter={() => handleHover(index)}
          >
            <Icon size={14} strokeWidth={2} />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

export const TabAddMenu = memo(TabAddMenuComponent);

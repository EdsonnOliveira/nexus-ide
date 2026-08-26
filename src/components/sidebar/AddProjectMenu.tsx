import { FolderOpen, FolderPlus } from 'lucide-react';
import { memo, useCallback, useEffect, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownAboveAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';

export type AddProjectOptionId = 'new' | 'existing';

interface AddProjectMenuProps {
  anchorRect: DOMRect;
  onClose: () => void;
  onSelect: (optionId: AddProjectOptionId) => void;
}

const ADD_PROJECT_OPTIONS: {
  id: AddProjectOptionId;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}[] = [
  { id: 'new', label: 'Novo projeto', icon: FolderPlus },
  { id: 'existing', label: 'Abrir existente', icon: FolderOpen },
];

function AddProjectMenuComponent({ anchorRect, onClose, onSelect }: AddProjectMenuProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAboveAnchor(menu, anchorRect, 'start'),
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
  }, [menuRef, requestClose]);

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
        setActiveIndex((index) => Math.min(index + 1, ADD_PROJECT_OPTIONS.length - 1));
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
        const option = ADD_PROJECT_OPTIONS[activeIndex];

        if (option) {
          onSelect(option.id);
          requestClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [activeIndex, onSelect, requestClose]);

  const handleSelect = useCallback(
    (optionId: AddProjectOptionId) => (event: React.MouseEvent<HTMLButtonElement>) => {
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
      className={`context-menu add-project-menu overlay-popup--anchor-start ${animationClass}`}
      role='menu'
      aria-label='Adicionar projeto'
    >
      {ADD_PROJECT_OPTIONS.map((option, index) => {
        const Icon = option.icon;

        return (
          <button
            key={option.id}
            type='button'
            className={`context-menu__item app-button app-button--enter${index === activeIndex ? ' context-menu__item--active' : ''}`}
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

export const AddProjectMenu = memo(AddProjectMenuComponent);

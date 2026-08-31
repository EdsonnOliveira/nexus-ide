import { Check, ChevronDown } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import { closeAllAnchoredDropdowns } from '@/utils/overlayBlocking';

export interface AnchoredSelectOption<T extends string = string> {
  value: T;
  label: string;
  labelNode?: React.ReactNode;
  icon?: React.ReactNode;
  subtitle?: string;
  className?: string;
}

interface AnchoredSelectMenuProps<T extends string> {
  anchorRect: DOMRect;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  options: AnchoredSelectOption<T>[];
  value: T | '';
  allowEmpty: boolean;
  emptyLabel: string;
  align: 'start' | 'end';
  menuClassName?: string;
  onClose: () => void;
  onSelect: (value: T | '') => void;
  onOptionContextMenu?: (value: T, event: React.MouseEvent<HTMLButtonElement>) => void;
}

function AnchoredSelectMenuComponent<T extends string>({
  anchorRect,
  anchorRef,
  options,
  value,
  allowEmpty,
  emptyLabel,
  align,
  menuClassName,
  onClose,
  onSelect,
  onOptionContextMenu,
}: AnchoredSelectMenuProps<T>) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownBelowAnchor(menu, anchorRect, align),
    [anchorRect, align],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) {
        return;
      }

      requestClose();
    };

    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [anchorRef, requestClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [requestClose]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const activeItem = menu?.querySelector<HTMLElement>('.context-menu__item--active');

    if (!menu || !activeItem) {
      return;
    }

    const itemTop = activeItem.offsetTop;
    const itemBottom = itemTop + activeItem.offsetHeight;
    const viewTop = menu.scrollTop;
    const viewBottom = viewTop + menu.clientHeight;

    if (itemBottom > viewBottom) {
      menu.scrollTop = itemBottom - menu.clientHeight;
      return;
    }

    if (itemTop < viewTop) {
      menu.scrollTop = itemTop;
    }
  }, [menuRef, value]);

  const handleSelect = useCallback(
    (nextValue: T | '') => (event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onSelect(nextValue);
      requestClose();
    },
    [onSelect, requestClose],
  );

  const handleOptionContextMenu = useCallback(
    (nextValue: T) => (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!onOptionContextMenu) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onOptionContextMenu(nextValue, event);
    },
    [onOptionContextMenu],
  );

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu anchored-select__menu overlay-popup--anchor-${align} ${animationClass}${menuClassName ? ` ${menuClassName}` : ''}`}
      role='menu'
    >
      {allowEmpty ? (
        <button
          type='button'
          className={`context-menu__item anchored-select__menu-item${value === '' ? ' context-menu__item--active' : ''}`}
          role='menuitem'
          onMouseDown={handleSelect('')}
        >
          <span className='anchored-select__menu-label'>{emptyLabel}</span>
          {value === '' ? (
            <Check size={14} strokeWidth={2} className='anchored-select__menu-check' aria-hidden />
          ) : null}
        </button>
      ) : null}
      {options.map((option) => {
        const isSelected = option.value === value;

        return (
          <button
            key={option.value}
            type='button'
            className={`context-menu__item anchored-select__menu-item${isSelected ? ' context-menu__item--active' : ''}`}
            role='menuitem'
            onMouseDown={handleSelect(option.value)}
            onContextMenu={handleOptionContextMenu(option.value)}
          >
            <span className='anchored-select__menu-item-content'>
              {option.icon ? (
                <span className='anchored-select__menu-leading' aria-hidden='true'>
                  {option.icon}
                </span>
              ) : null}
              <span className='anchored-select__menu-item-copy'>
                <span
                  className={`anchored-select__menu-label${option.className ? ` ${option.className}` : ''}`}
                >
                  {option.labelNode ?? option.label}
                </span>
                {option.subtitle ? (
                  <span className='anchored-select__menu-subtitle'>{option.subtitle}</span>
                ) : null}
              </span>
            </span>
            {isSelected ? (
              <Check size={14} strokeWidth={2} className='anchored-select__menu-check' aria-hidden />
            ) : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

const AnchoredSelectMenu = memo(AnchoredSelectMenuComponent) as typeof AnchoredSelectMenuComponent;

interface AnchoredSelectProps<T extends string = string> {
  value: T | '';
  options: AnchoredSelectOption<T>[];
  onChange: (value: T | '') => void;
  placeholder?: string;
  disabled?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  align?: 'start' | 'end';
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  leadingIcon?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOptionContextMenu?: (value: T, event: React.MouseEvent<HTMLButtonElement>) => void;
}

function AnchoredSelectComponent<T extends string = string>({
  value,
  options,
  onChange,
  placeholder = 'Selecionar',
  disabled = false,
  allowEmpty = false,
  emptyLabel = 'Nenhum',
  align = 'start',
  className,
  triggerClassName,
  menuClassName,
  leadingIcon,
  open: openProp,
  onOpenChange,
  onOptionContextMenu,
}: AnchoredSelectProps<T>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : uncontrolledOpen;

  const selectedOption = useMemo(() => {
    if (value === '') {
      return null;
    }

    return options.find((option) => option.value === value) ?? null;
  }, [options, value]);

  const selectedContent = useMemo(() => {
    if (value === '') {
      return allowEmpty ? emptyLabel : placeholder;
    }

    return selectedOption?.labelNode ?? selectedOption?.label ?? placeholder;
  }, [allowEmpty, emptyLabel, placeholder, selectedOption, value]);

  const setOpenState = useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(nextOpen);
      }

      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange],
  );

  const openMenu = useCallback(() => {
    if (disabled) {
      return;
    }

    closeAllAnchoredDropdowns();
    const rect = triggerRef.current?.getBoundingClientRect() ?? null;
    setAnchorRect(rect);
    setOpenState(Boolean(rect));
  }, [disabled, setOpenState]);

  const handleClose = useCallback(() => {
    setAnchorRect(null);
    setOpenState(false);
  }, [setOpenState]);

  const handleToggle = useCallback(() => {
    if (disabled) {
      return;
    }

    if (open) {
      handleClose();
      return;
    }

    openMenu();
  }, [disabled, handleClose, open, openMenu]);

  useEffect(() => {
    if (!open) {
      setAnchorRect(null);
      return;
    }

    const rect = triggerRef.current?.getBoundingClientRect() ?? null;

    if (!rect) {
      setOpenState(false);
      return;
    }

    setAnchorRect(rect);
  }, [open, setOpenState]);

  useEffect(() => {
    if (disabled && open) {
      handleClose();
    }
  }, [disabled, handleClose, open]);

  return (
    <div className={`anchored-select${className ? ` ${className}` : ''}`}>
      <button
        ref={triggerRef}
        type='button'
        className={`anchored-select__trigger app-button${open ? ' anchored-select__trigger--open app-button--enter' : ''}${triggerClassName ? ` ${triggerClassName}` : ''}`}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup='menu'
        onClick={handleToggle}
      >
        <span className='anchored-select__trigger-content'>
          {leadingIcon ? (
            <span className='anchored-select__trigger-leading' aria-hidden='true'>
              {leadingIcon}
            </span>
          ) : null}
          {selectedOption?.subtitle ? (
            <span className='anchored-select__trigger-copy'>
              <span className='anchored-select__trigger-label'>{selectedContent}</span>
              <span className='anchored-select__trigger-subtitle'>{selectedOption.subtitle}</span>
            </span>
          ) : (
            <span className='anchored-select__trigger-label'>{selectedContent}</span>
          )}
        </span>
        <ChevronDown size={14} strokeWidth={2} className='anchored-select__trigger-icon' aria-hidden />
      </button>
      {open && anchorRect ? (
        <AnchoredSelectMenu
          anchorRect={anchorRect}
          anchorRef={triggerRef}
          options={options}
          value={value}
          allowEmpty={allowEmpty}
          emptyLabel={emptyLabel}
          align={align}
          menuClassName={menuClassName}
          onClose={handleClose}
          onSelect={onChange}
          onOptionContextMenu={onOptionContextMenu}
        />
      ) : null}
    </div>
  );
}

export const AnchoredSelect = memo(AnchoredSelectComponent) as typeof AnchoredSelectComponent;

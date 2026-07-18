import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export interface WebAskMenuOption {
  value: string;
  label: string;
  leading?: ReactNode;
  disabled?: boolean;
}

interface MenuRect {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  openUp: boolean;
}

interface WebAskMenuSelectProps {
  value: string;
  options: WebAskMenuOption[];
  disabled?: boolean;
  ariaLabel: string;
  triggerLeading?: ReactNode;
  triggerLabel: string;
  className?: string;
  onChange: (value: string) => void;
}

export function WebAskMenuSelect({
  value,
  options,
  disabled = false,
  ariaLabel,
  triggerLeading,
  triggerLabel,
  className = '',
  onChange,
}: WebAskMenuSelectProps) {
  const [menuPhase, setMenuPhase] = useState<'closed' | 'in' | 'out'>('closed');
  const [menuRect, setMenuRect] = useState<MenuRect | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuVisible = menuPhase !== 'closed';

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const gap = 6;
    const spaceAbove = rect.top - gap;
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const openUp = spaceAbove > spaceBelow || spaceBelow < 180;
    const maxHeight = Math.min(280, Math.max(120, openUp ? spaceAbove : spaceBelow));
    const width = Math.max(rect.width, 220);
    let left = rect.left;
    if (left + width > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - width - 12);
    }
    setMenuRect(
      openUp
        ? {
            left,
            width,
            bottom: window.innerHeight - rect.top + gap,
            maxHeight,
            openUp: true,
          }
        : {
            left,
            width,
            top: rect.bottom + gap,
            maxHeight,
            openUp: false,
          },
    );
  }, []);

  const closeMenu = useCallback(() => {
    setMenuPhase((current) => (current === 'closed' ? current : 'out'));
  }, []);

  const openMenu = useCallback(() => {
    setMenuPhase('in');
  }, []);

  useLayoutEffect(() => {
    if (!menuVisible) {
      setMenuRect(null);
      return;
    }
    updateMenuPosition();
    const onResize = () => updateMenuPosition();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [menuVisible, updateMenuPosition]);

  useEffect(() => {
    if (menuPhase !== 'in') {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuPhase, closeMenu]);

  const menu =
    menuVisible && menuRect
      ? createPortal(
          <div
            ref={menuRef}
            className={`web-ask-project-menu web-ask-project-menu--portal overlay-popup--${menuPhase}${
              menuRect.openUp ? ' web-ask-project-menu--up' : ' web-ask-project-menu--down'
            }`}
            style={{
              left: menuRect.left,
              width: menuRect.width,
              maxHeight: menuRect.maxHeight,
              ...(menuRect.openUp
                ? { bottom: menuRect.bottom, top: 'auto' }
                : { top: menuRect.top, bottom: 'auto' }),
            }}
            role='listbox'
            aria-label={ariaLabel}
            onAnimationEnd={() => {
              if (menuPhase === 'out') {
                setMenuPhase('closed');
                setMenuRect(null);
              }
            }}
          >
            {options.map((option) => (
              <button
                key={option.value || 'empty'}
                type='button'
                className={`app-button web-ask-project-menu__item${
                  option.value === value ? ' web-ask-project-menu__item--active' : ''
                }`}
                disabled={option.disabled}
                onClick={() => {
                  onChange(option.value);
                  closeMenu();
                }}
              >
                {option.leading}
                <span className='web-ask-project-menu__label'>{option.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={`home-dashboard__ask-project-wrap ${className}`.trim()} ref={triggerRef}>
      <button
        type='button'
        className='home-dashboard__ask-project app-button'
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={menuPhase === 'in'}
        aria-haspopup='listbox'
        onClick={() => {
          if (menuPhase === 'in') {
            closeMenu();
            return;
          }
          openMenu();
        }}
      >
        {triggerLeading}
        <span className='home-dashboard__ask-project-label'>{triggerLabel}</span>
        <ChevronDown
          size={14}
          className={
            menuPhase === 'in'
              ? 'web-ask-project-chevron web-ask-project-chevron--open'
              : 'web-ask-project-chevron'
          }
        />
      </button>
      {menu}
    </div>
  );
}

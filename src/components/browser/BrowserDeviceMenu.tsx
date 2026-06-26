import { Laptop, Monitor, Smartphone, Tablet, type LucideIcon } from 'lucide-react';
import { memo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredDropdownMenu } from '@/hooks/useAnchoredDropdownMenu';
import type { OverlayAnimationPhase } from '@/hooks/useAnimatedUnmount';
import {
  BROWSER_DEVICE_PRESETS,
  type BrowserDevicePreset,
} from '@/constants/browserDevices';

const BROWSER_DEVICE_ICONS: Record<string, LucideIcon> = {
  responsive: Monitor,
  'iphone-15-pro': Smartphone,
  'iphone-se': Smartphone,
  'ipad-air': Tablet,
  'ipad-mini': Tablet,
  'macbook-air': Laptop,
  'macbook-pro-14': Laptop,
};

interface BrowserDeviceMenuProps {
  anchorRect: DOMRect;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  devicePresetId: string;
  onClose: () => void;
  onSelect: (preset: BrowserDevicePreset) => void;
  onAnimationPhaseChange?: (phase: OverlayAnimationPhase) => void;
  onRegisterRequestClose?: (requestClose: (() => void) | null) => void;
}

function BrowserDeviceMenuComponent({
  anchorRect,
  anchorRef,
  devicePresetId,
  onClose,
  onSelect,
  onAnimationPhaseChange,
  onRegisterRequestClose,
}: BrowserDeviceMenuProps) {
  const { menuRef, requestClose, animationClass, phase } = useAnchoredDropdownMenu(
    onClose,
    (menu) => {
      const rect = menu.getBoundingClientRect();
      const left = Math.min(anchorRect.right - rect.width, window.innerWidth - rect.width - 8);
      const belowTop = anchorRect.bottom + 8;
      const aboveTop = anchorRect.top - rect.height - 8;
      const fitsBelow = belowTop + rect.height <= window.innerHeight - 8;
      const top = fitsBelow ? belowTop : Math.max(8, aboveTop);

      menu.style.left = `${Math.max(8, left)}px`;
      menu.style.top = `${top}px`;
    },
    [anchorRect],
  );

  useEffect(() => {
    onAnimationPhaseChange?.(phase);
  }, [onAnimationPhaseChange, phase]);

  useEffect(() => {
    onRegisterRequestClose?.(requestClose);

    return () => {
      onRegisterRequestClose?.(null);
    };
  }, [onRegisterRequestClose, requestClose]);

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

  const handleSelect = useCallback(
    (preset: BrowserDevicePreset) => (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onSelect(preset);
      requestClose();
    },
    [onSelect, requestClose],
  );

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu browser-device-menu overlay-popup--anchor-end ${animationClass}`}
      role='menu'
    >
      {BROWSER_DEVICE_PRESETS.map((preset) => {
        const Icon = BROWSER_DEVICE_ICONS[preset.id] ?? Monitor;

        return (
          <button
            key={preset.id}
            type='button'
            className={`context-menu__item${preset.id === devicePresetId ? ' browser-device-menu__item--active' : ''}`}
            role='menuitem'
            onMouseDown={handleSelect(preset)}
          >
            <span className='browser-device-menu__leading'>
              <Icon size={14} strokeWidth={2} aria-hidden />
              <span>{preset.label}</span>
            </span>
            {preset.width && preset.height ? (
              <span className='browser-device-menu__size'>
                {preset.width} × {preset.height}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

export const BrowserDeviceMenu = memo(BrowserDeviceMenuComponent);

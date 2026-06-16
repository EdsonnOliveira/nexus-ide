import { Globe } from 'lucide-react';
import { memo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownAtPointer,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';

interface TerminalLinkContextMenuProps {
  url: string;
  x: number;
  y: number;
  onClose: () => void;
  onOpenInBrowser: (url: string) => void;
}

function TerminalLinkContextMenuComponent({
  url,
  x,
  y,
  onClose,
  onOpenInBrowser,
}: TerminalLinkContextMenuProps) {
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

  const handleOpenInBrowser = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onOpenInBrowser(url);
      requestClose();
    },
    [onOpenInBrowser, requestClose, url],
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
        onMouseDown={handleOpenInBrowser}
      >
        <Globe size={14} strokeWidth={2} aria-hidden />
        <span>Abrir no navegador do Nexus</span>
      </button>
    </div>,
    document.body,
  );
}

export const TerminalLinkContextMenu = memo(TerminalLinkContextMenuComponent);

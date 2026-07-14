import { Copy, FileText, MoreVertical, Terminal } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';

interface TerminalCommandBlockMenuProps {
  visible: boolean;
  top: number;
  left: number;
  command: string;
  output: string;
  all: string;
  onOpenChange?: (open: boolean) => void;
}

interface TerminalCommandBlockMenuPopupProps {
  anchorRect: DOMRect;
  command: string;
  output: string;
  all: string;
  onClose: () => void;
}

async function copyText(value: string): Promise<void> {
  const trimmed = value.trimEnd();

  if (!trimmed) {
    return;
  }

  await navigator.clipboard.writeText(trimmed);
}

function TerminalCommandBlockMenuPopupComponent({
  anchorRect,
  command,
  output,
  all,
  onClose,
}: TerminalCommandBlockMenuPopupProps) {
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownBelowAnchor(menu, anchorRect, 'end'),
    [anchorRect.left, anchorRect.top, anchorRect.width, anchorRect.height],
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

  const handleCopyAll = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      await copyText(all || command);
      requestClose();
    },
    [all, command, requestClose],
  );

  const handleCopyCommand = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      await copyText(command);
      requestClose();
    },
    [command, requestClose],
  );

  const handleCopyOutput = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      await copyText(output);
      requestClose();
    },
    [output, requestClose],
  );

  return createPortal(
    <div
      ref={menuRef}
      className={`context-menu overlay-popup--anchor-end ${animationClass}`}
      role='menu'
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type='button'
        className='context-menu__item app-button'
        role='menuitem'
        onMouseDown={(event) => {
          void handleCopyAll(event);
        }}
      >
        <Copy size={14} strokeWidth={2} aria-hidden />
        <span>Copiar</span>
      </button>
      <button
        type='button'
        className='context-menu__item app-button'
        role='menuitem'
        disabled={!command.trim()}
        onMouseDown={(event) => {
          void handleCopyCommand(event);
        }}
      >
        <Terminal size={14} strokeWidth={2} aria-hidden />
        <span>Copiar comando</span>
      </button>
      <button
        type='button'
        className='context-menu__item app-button'
        role='menuitem'
        disabled={!output.trim()}
        onMouseDown={(event) => {
          void handleCopyOutput(event);
        }}
      >
        <FileText size={14} strokeWidth={2} aria-hidden />
        <span>Copiar saída</span>
      </button>
    </div>,
    document.body,
  );
}

const TerminalCommandBlockMenuPopup = memo(TerminalCommandBlockMenuPopupComponent);

function TerminalCommandBlockMenuComponent({
  visible,
  top,
  left,
  command,
  output,
  all,
  onOpenChange,
}: TerminalCommandBlockMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!visible) {
      setMenuOpen(false);
      setAnchorRect(null);
      onOpenChange?.(false);
    }
  }, [onOpenChange, visible]);

  const handleCloseMenu = useCallback(() => {
    setMenuOpen(false);
    setAnchorRect(null);
    onOpenChange?.(false);
  }, [onOpenChange]);

  const handleToggleMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (menuOpen) {
        handleCloseMenu();
        return;
      }

      const nextRect = event.currentTarget.getBoundingClientRect();
      setAnchorRect(nextRect);
      setMenuOpen(true);
      onOpenChange?.(true);
    },
    [handleCloseMenu, menuOpen, onOpenChange],
  );

  if (!visible) {
    return null;
  }

  return (
    <>
      <button
        ref={triggerRef}
        type='button'
        className='terminal-command-block-menu__trigger app-button app-button--enter'
        style={{ top, left }}
        aria-label='Ações do comando'
        aria-haspopup='menu'
        aria-expanded={menuOpen}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={handleToggleMenu}
      >
        <MoreVertical size={14} strokeWidth={2} aria-hidden />
      </button>
      {menuOpen && anchorRect ? (
        <TerminalCommandBlockMenuPopup
          anchorRect={anchorRect}
          command={command}
          output={output}
          all={all}
          onClose={handleCloseMenu}
        />
      ) : null}
    </>
  );
}

export const TerminalCommandBlockMenu = memo(TerminalCommandBlockMenuComponent);

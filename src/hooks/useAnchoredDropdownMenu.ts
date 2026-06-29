import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAnimatedUnmount } from '@/hooks/useAnimatedUnmount';
import {
  closeAllAnchoredDropdowns,
  registerAnchoredDropdownCloser,
  registerAnchoredDropdownOpen,
  registerModalOpen,
} from '@/utils/overlayBlocking';

export function positionDropdownBelowAnchor(
  menu: HTMLDivElement,
  anchorRect: DOMRect,
  align: 'start' | 'end' = 'start',
): void {
  const rect = menu.getBoundingClientRect();
  const left =
    align === 'end'
      ? Math.min(anchorRect.right - rect.width, window.innerWidth - rect.width - 8)
      : Math.min(anchorRect.left, window.innerWidth - rect.width - 8);
  const top = anchorRect.bottom + 6;

  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.min(top, window.innerHeight - rect.height - 8)}px`;
}

export function positionDropdownAtPointer(menu: HTMLDivElement, x: number, y: number): void {
  const rect = menu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;

  menu.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, maxY))}px`;
}

export function positionDropdownAboveAnchor(
  menu: HTMLDivElement,
  anchorRect: DOMRect,
  align: 'start' | 'end' = 'start',
): void {
  const rect = menu.getBoundingClientRect();
  const left =
    align === 'end'
      ? Math.min(anchorRect.right - rect.width, window.innerWidth - rect.width - 8)
      : Math.min(anchorRect.left, window.innerWidth - rect.width - 8);
  const aboveTop = anchorRect.top - rect.height - 6;
  const belowTop = anchorRect.bottom + 6;
  const top =
    aboveTop >= 8
      ? aboveTop
      : Math.min(belowTop, window.innerHeight - rect.height - 8);

  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

export function positionDropdownAboveComposerInput(
  menu: HTMLDivElement,
  anchorRect: DOMRectReadOnly,
): void {
  const padding = 8;
  const gap = 8;
  const viewportHeight = window.innerHeight;
  const availableAbove = Math.max(0, anchorRect.top - padding - gap);
  const menuHeight = menu.offsetHeight || menu.getBoundingClientRect().height;

  if (menuHeight > availableAbove && availableAbove >= 120) {
    menu.style.maxHeight = `${Math.max(120, availableAbove)}px`;
  }

  const resolvedHeight = menu.offsetHeight || menu.getBoundingClientRect().height;
  const composerNearBottom = anchorRect.bottom > viewportHeight * 0.45;
  let top = anchorRect.top - resolvedHeight - gap;

  if (composerNearBottom) {
    top = anchorRect.top - resolvedHeight - gap;
  } else if (top < padding) {
    top = anchorRect.bottom + gap;
  }

  top = Math.max(padding, Math.min(top, viewportHeight - resolvedHeight - padding));

  if (composerNearBottom) {
    const maxTop = anchorRect.top - resolvedHeight - gap;
    top = Math.min(top, maxTop);
    top = Math.max(padding, top);
  }

  const menuWidth = menu.offsetWidth || menu.getBoundingClientRect().width;
  const left = Math.max(padding, Math.min(anchorRect.left, window.innerWidth - menuWidth - padding));

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

export function positionContextSubmenuWithinViewport(
  submenu: HTMLDivElement,
  rowElement: HTMLElement,
): void {
  const viewportPadding = 8;
  const defaultTopOffset = -12;

  submenu.style.top = `${defaultTopOffset}px`;
  submenu.style.bottom = 'auto';
  submenu.style.maxHeight = '';

  const rowRect = rowElement.getBoundingClientRect();
  let topOffset = defaultTopOffset;
  const submenuHeight = submenu.offsetHeight;
  let viewportTop = rowRect.top + topOffset;
  let viewportBottom = viewportTop + submenuHeight;
  const maxBottom = window.innerHeight - viewportPadding;

  if (viewportBottom > maxBottom) {
    topOffset -= viewportBottom - maxBottom;
    viewportTop = rowRect.top + topOffset;
    viewportBottom = viewportTop + submenuHeight;
  }

  if (viewportTop < viewportPadding) {
    topOffset += viewportPadding - viewportTop;
    viewportTop = rowRect.top + topOffset;
  }

  submenu.style.top = `${topOffset}px`;

  const availableHeight = maxBottom - Math.max(viewportPadding, viewportTop);

  if (submenuHeight > availableHeight) {
    submenu.style.maxHeight = `${Math.max(120, availableHeight)}px`;
  }
}

export function useAnchoredDropdownMenu(
  onClose: () => void,
  positionMenu: (menu: HTMLDivElement) => void,
  deps: readonly unknown[],
  host: 'dropdown' | 'modal' = 'dropdown',
) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const { phase, requestClose } = useAnimatedUnmount(onClose);
  const [isPositioned, setIsPositioned] = useState(false);

  useEffect(() => {
    closeAllAnchoredDropdowns();

    if (host === 'modal') {
      const unregisterModal = registerModalOpen();

      return () => {
        unregisterModal();
      };
    }

    const forceClose = () => {
      onCloseRef.current();
    };

    const unregisterOpen = registerAnchoredDropdownOpen();
    const unregisterCloser = registerAnchoredDropdownCloser(forceClose);
    closeAllAnchoredDropdowns(forceClose);

    return () => {
      unregisterOpen();
      unregisterCloser();
    };
  }, [host]);

  useLayoutEffect(() => {
    const menu = menuRef.current;

    if (!menu) {
      return;
    }

    const position = () => {
      setIsPositioned(false);
      positionMenu(menu);
      setIsPositioned(true);
    };

    position();
    const frameId = window.requestAnimationFrame(position);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, deps);

  const animationClass = isPositioned ? `overlay-popup--${phase}` : 'overlay-popup--pending';

  return { menuRef, requestClose, animationClass, phase };
}

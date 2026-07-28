import { useEffect, useRef } from 'react';
import { useTabActions } from '@/stores/useTabStore';

const CMD_PRESSED_CLASS = 'cmd-pressed';

function findMarkdownPreviewLink(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const link = target.closest('a.markdown-preview__link');

  if (!(link instanceof HTMLAnchorElement) || !link.closest('.markdown-preview')) {
    return null;
  }

  return link;
}

export function useMarkdownPreviewCmdLinks(): void {
  const { openBrowserTab } = useTabActions();
  const openBrowserTabRef = useRef(openBrowserTab);
  openBrowserTabRef.current = openBrowserTab;

  useEffect(() => {
    const root = document.documentElement;

    const setCmdPressed = (pressed: boolean) => {
      root.classList.toggle(CMD_PRESSED_CLASS, pressed);
    };

    const handleMetaKey = (event: KeyboardEvent) => {
      if (event.key !== 'Meta') {
        return;
      }

      setCmdPressed(event.type === 'keydown');
    };

    const handleBlur = () => {
      setCmdPressed(false);
    };

    const handleClick = (event: MouseEvent) => {
      const link = findMarkdownPreviewLink(event.target);

      if (!link) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (!event.metaKey) {
        return;
      }

      const href = link.getAttribute('href')?.trim() ?? '';

      if (!href) {
        return;
      }

      void openBrowserTabRef.current(href);
    };

    window.addEventListener('keydown', handleMetaKey);
    window.addEventListener('keyup', handleMetaKey);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('click', handleClick, true);

    return () => {
      window.removeEventListener('keydown', handleMetaKey);
      window.removeEventListener('keyup', handleMetaKey);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('click', handleClick, true);
      root.classList.remove(CMD_PRESSED_CLASS);
    };
  }, []);
}

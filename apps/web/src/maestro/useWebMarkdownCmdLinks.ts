import { useEffect } from 'react';
import { findWebMarkdownPreviewUrl } from './webMarkdown';

const CMD_PRESSED_CLASS = 'cmd-pressed';

export function useWebMarkdownCmdLinks(): void {
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
      const url = findWebMarkdownPreviewUrl(event);

      if (!event.metaKey || !url) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      window.open(url, '_blank', 'noopener,noreferrer');
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

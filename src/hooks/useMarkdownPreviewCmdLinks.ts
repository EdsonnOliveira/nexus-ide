import { useEffect, useRef } from 'react';
import { useTabActions } from '@/stores/useTabStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { normalizeBrowserUrl } from '@/utils/browserUrl';
import { stripTrailingUrlChars } from '@/utils/terminalUrlExtract';

const CMD_PRESSED_CLASS = 'cmd-pressed';

const MARKDOWN_BARE_URL_REGEX =
  /https?:\/\/[^\s<>"']+|localhost(?::\d+)?(?:\/[^\s<>"']*)?|127\.0\.0\.1(?::\d+)?(?:\/[^\s<>"']*)?/gi;

function resolveMarkdownPreviewUrl(raw: string): string | null {
  const cleaned = stripTrailingUrlChars(raw.trim());

  if (!cleaned || !/^(https?:\/\/|localhost\b|127\.0\.0\.1)/i.test(cleaned)) {
    return null;
  }

  const normalized = normalizeBrowserUrl(cleaned);
  return /^https?:\/\//i.test(normalized) ? normalized : null;
}

function findMarkdownPreviewAnchor(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const link = target.closest('a.markdown-preview__link, a[href^="http"]');

  if (!(link instanceof HTMLAnchorElement) || !link.closest('.markdown-preview')) {
    return null;
  }

  return link;
}

function findUrlInTextAtOffset(text: string, offset: number): string | null {
  const regex = new RegExp(MARKDOWN_BARE_URL_REGEX.source, 'gi');

  for (const match of text.matchAll(regex)) {
    const start = match.index ?? 0;
    const cleaned = stripTrailingUrlChars(match[0]);

    if (!cleaned) {
      continue;
    }

    if (offset >= start && offset <= start + cleaned.length) {
      return resolveMarkdownPreviewUrl(cleaned);
    }
  }

  return null;
}

function findMarkdownPreviewUrl(event: MouseEvent): string | null {
  const anchor = findMarkdownPreviewAnchor(event.target);

  if (anchor) {
    return resolveMarkdownPreviewUrl(linkHref(anchor));
  }

  if (!(event.target instanceof Element) || !event.target.closest('.markdown-preview')) {
    return null;
  }

  const range = document.caretRangeFromPoint(event.clientX, event.clientY);

  if (range?.startContainer.nodeType === Node.TEXT_NODE) {
    const fromCaret = findUrlInTextAtOffset(
      range.startContainer.textContent ?? '',
      range.startOffset,
    );

    if (fromCaret) {
      return fromCaret;
    }
  }

  return resolveMarkdownPreviewUrl(event.target.textContent ?? '');
}

function linkHref(anchor: HTMLAnchorElement): string {
  return anchor.getAttribute('href')?.trim() || anchor.href;
}

function openMarkdownPreviewUrl(url: string, openBrowserTab: (url: string) => Promise<void>): void {
  const isPip = document.documentElement.classList.contains('agent-pip');
  const hasProject = Boolean(useProjectStore.getState().getActiveProject());

  if (!isPip && hasProject) {
    void openBrowserTab(url);
    return;
  }

  void window.nexus.tasks.openExternalUrl(url);
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
      const url = findMarkdownPreviewUrl(event);
      const anchor = findMarkdownPreviewAnchor(event.target);

      if (anchor) {
        event.preventDefault();
        event.stopPropagation();

        if (!event.metaKey || !url) {
          return;
        }

        openMarkdownPreviewUrl(url, openBrowserTabRef.current);
        return;
      }

      if (!event.metaKey || !url) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openMarkdownPreviewUrl(url, openBrowserTabRef.current);
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

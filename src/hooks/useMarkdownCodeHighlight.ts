import { useEffect, useMemo, useRef, useState } from 'react';
import { rehighlightMarkdownCodeBlocks } from '@/utils/codeHighlight';
import {
  hydrateMarkdownImageHtml,
  resolveDesktopMarkdownImage,
} from '@/utils/hydrateMarkdownImages';
import { renderMarkdownPreview, type MarkdownPreviewOptions } from '@/utils/markdownPreview';
import { normalizeMarkdownSource } from '@/utils/markdownText';

export function useDeferredMarkdownHtml(
  source: string,
  imageBaseDir?: string,
  options?: MarkdownPreviewOptions,
): string {
  const normalized = useMemo(() => normalizeMarkdownSource(source), [source]);
  const detectImplicitCode = options?.detectImplicitCode !== false;
  const [html, setHtml] = useState('');
  const lastRenderRef = useRef(0);

  useEffect(() => {
    const trimmed = normalized.trim();

    if (!trimmed) {
      lastRenderRef.current = 0;
      setHtml('');
      return;
    }

    let cancelled = false;
    let idleId = 0;
    let timeoutId = 0;

    const runRender = () => {
      const idleTimeout = trimmed.length > 6000 ? 1200 : 400;
      idleId = window.requestIdleCallback(
        () => {
          if (cancelled) {
            return;
          }

          lastRenderRef.current = Date.now();
          const rendered = renderMarkdownPreview(normalized, imageBaseDir, {
            detectImplicitCode,
          });
          setHtml(rendered);

          void hydrateMarkdownImageHtml(
            rendered,
            imageBaseDir ?? null,
            resolveDesktopMarkdownImage,
          ).then((hydrated) => {
            if (!cancelled && hydrated !== rendered) {
              setHtml(hydrated);
            }
          });
        },
        { timeout: idleTimeout },
      );
    };

    const minInterval = trimmed.length > 4000 ? 600 : 250;
    const elapsed = Date.now() - lastRenderRef.current;

    if (elapsed >= minInterval) {
      runRender();
    } else {
      timeoutId = window.setTimeout(runRender, minInterval - elapsed);
    }

    return () => {
      cancelled = true;

      if (idleId) {
        window.cancelIdleCallback(idleId);
      }

      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [normalized, imageBaseDir, detectImplicitCode]);

  return html;
}

export function useMarkdownCodeHighlight<T extends HTMLElement>(
  html: string,
  imageBaseDir?: string,
) {
  const ref = useRef<T>(null);
  const copiedTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!ref.current || !html) {
      return;
    }

    const node = ref.current;
    const idleId = window.requestIdleCallback(
      () => {
        if (ref.current === node) {
          rehighlightMarkdownCodeBlocks(node);
        }
      },
      { timeout: 500 },
    );

    const handleImageError = (event: Event) => {
      const img = event.target;

      if (!(img instanceof HTMLImageElement) || !img.classList.contains('markdown-preview__img')) {
        return;
      }

      if (img.dataset.imageHydrateFailed === '1' || img.src.startsWith('data:image/')) {
        img.classList.add('markdown-preview__img--broken');
        return;
      }

      const imageRef =
        img.getAttribute('data-image-ref') ||
        img.getAttribute('data-image-path') ||
        img.getAttribute('alt') ||
        '';

      if (!imageRef.trim()) {
        img.classList.add('markdown-preview__img--broken');
        return;
      }

      img.dataset.imageHydrateFailed = '1';

      void resolveDesktopMarkdownImage(imageRef, imageBaseDir ?? null).then((dataUrl) => {
        if (!dataUrl || !ref.current?.contains(img)) {
          img.classList.add('markdown-preview__img--broken');
          return;
        }

        img.src = dataUrl;
        img.classList.remove('markdown-preview__img--pending', 'markdown-preview__img--broken');
      });
    };

    const handleCodeCopyClick = (event: MouseEvent) => {
      const target =
        event.target instanceof HTMLElement
          ? event.target
          : event.target instanceof Node
            ? event.target.parentElement
            : null;

      if (!target) {
        return;
      }

      const button = target.closest('.markdown-preview__code-copy');

      if (!(button instanceof HTMLButtonElement) || !node.contains(button)) {
        return;
      }

      const block = button.closest('.markdown-preview__code-block');
      const code = block?.querySelector('pre code');
      const value = code?.textContent ?? '';

      if (!value) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      void navigator.clipboard.writeText(value).then(
        () => {
          if (copiedTimeoutRef.current !== null) {
            window.clearTimeout(copiedTimeoutRef.current);
          }

          node
            .querySelectorAll('.markdown-preview__code-copy--copied')
            .forEach((el) => el.classList.remove('markdown-preview__code-copy--copied'));

          button.classList.add('markdown-preview__code-copy--copied');
          button.setAttribute('aria-label', 'Código copiado');
          button.setAttribute('title', 'Copiado');

          copiedTimeoutRef.current = window.setTimeout(() => {
            button.classList.remove('markdown-preview__code-copy--copied');
            button.setAttribute('aria-label', 'Copiar código');
            button.setAttribute('title', 'Copiar');
            copiedTimeoutRef.current = null;
          }, 1600);
        },
        () => {
          button.classList.remove('markdown-preview__code-copy--copied');
          button.setAttribute('aria-label', 'Copiar código');
          button.setAttribute('title', 'Copiar');
        },
      );
    };

    node.addEventListener('error', handleImageError, true);
    node.addEventListener('click', handleCodeCopyClick);

    return () => {
      window.cancelIdleCallback(idleId);
      node.removeEventListener('error', handleImageError, true);
      node.removeEventListener('click', handleCodeCopyClick);

      if (copiedTimeoutRef.current !== null) {
        window.clearTimeout(copiedTimeoutRef.current);
        copiedTimeoutRef.current = null;
      }
    };
  }, [html, imageBaseDir]);

  return ref;
}

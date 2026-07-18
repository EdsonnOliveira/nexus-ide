import { useEffect, useMemo, useRef, useState } from 'react';
import { rehighlightMarkdownCodeBlocks } from '@/utils/codeHighlight';
import {
  hydrateMarkdownImageHtml,
  resolveDesktopMarkdownImage,
} from '@/utils/hydrateMarkdownImages';
import { renderMarkdownPreview } from '@/utils/markdownPreview';
import { normalizeMarkdownSource } from '@/utils/markdownText';

export function useDeferredMarkdownHtml(source: string, imageBaseDir?: string): string {
  const normalized = useMemo(() => normalizeMarkdownSource(source), [source]);
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
          const rendered = renderMarkdownPreview(normalized, imageBaseDir);
          setHtml(rendered);

          void hydrateMarkdownImageHtml(rendered, imageBaseDir ?? null, resolveDesktopMarkdownImage).then(
            (hydrated) => {
              if (!cancelled && hydrated !== rendered) {
                setHtml(hydrated);
              }
            },
          );
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
  }, [normalized, imageBaseDir]);

  return html;
}

export function useMarkdownCodeHighlight<T extends HTMLElement>(html: string) {
  const ref = useRef<T>(null);

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

    return () => {
      window.cancelIdleCallback(idleId);
    };
  }, [html]);

  return ref;
}

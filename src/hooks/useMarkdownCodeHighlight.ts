import { useEffect, useMemo, useRef, useState } from 'react';
import { rehighlightMarkdownCodeBlocks } from '@/utils/codeHighlight';
import { normalizeMarkdownSource, renderMarkdownPreview } from '@/utils/markdownPreview';

export function useDeferredMarkdownHtml(source: string): string {
  const normalized = useMemo(() => normalizeMarkdownSource(source), [source]);
  const [html, setHtml] = useState('');

  useEffect(() => {
    const trimmed = normalized.trim();

    if (!trimmed) {
      setHtml('');
      return;
    }

    let cancelled = false;
    const idleTimeout = trimmed.length > 6000 ? 1200 : 400;
    const idleId = window.requestIdleCallback(
      () => {
        if (!cancelled) {
          setHtml(renderMarkdownPreview(normalized));
        }
      },
      { timeout: idleTimeout },
    );

    return () => {
      cancelled = true;
      window.cancelIdleCallback(idleId);
    };
  }, [normalized]);

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

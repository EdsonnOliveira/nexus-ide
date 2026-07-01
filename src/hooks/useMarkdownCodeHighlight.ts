import { useLayoutEffect, useRef } from 'react';
import { rehighlightMarkdownCodeBlocks } from '@/utils/codeHighlight';

export function useMarkdownCodeHighlight<T extends HTMLElement>(html: string) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    if (!ref.current || !html) {
      return;
    }

    rehighlightMarkdownCodeBlocks(ref.current);
  }, [html]);

  return ref;
}

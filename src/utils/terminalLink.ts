import type { IDisposable, ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import { normalizeBrowserUrl } from '@/utils/browserUrl';
import {
  extendTerminalUrlAcrossLines,
  isPositionInsideTerminalUrlRange,
  isTerminalUrlContinuationLine,
  stripTrailingUrlChars,
  TERMINAL_URL_CONTINUE_REGEX,
  TERMINAL_URL_REGEX,
  type TerminalLineTextReader,
} from '@/utils/terminalUrlExtract';

function createLineTextReader(terminal: Terminal): TerminalLineTextReader {
  return (row: number) => terminal.buffer.active.getLine(row)?.translateToString(true) ?? null;
}

function setLinkDecorations(link: ILink, active: boolean): void {
  if (!link.decorations) {
    return;
  }

  link.decorations.underline = active;
  link.decorations.pointerCursor = active;
}

function scheduleLinkDecorations(link: ILink, active: boolean): void {
  queueMicrotask(() => {
    setLinkDecorations(link, active);
  });
}

function isMouseOverLink(terminal: Terminal, link: ILink, event: MouseEvent): boolean {
  const position = getTerminalCellPosition(terminal, event);

  if (!position) {
    return false;
  }

  const linkStartRow = link.range.start.y - 1;
  const linkEndRow = link.range.end.y - 1;

  if (position.row < linkStartRow || position.row > linkEndRow) {
    return false;
  }

  const col = position.col + 1;

  if (position.row === linkStartRow && col < link.range.start.x) {
    return false;
  }

  if (position.row === linkEndRow && col > link.range.end.x) {
    return false;
  }

  return true;
}

function getTerminalCellPosition(
  terminal: Terminal,
  event: MouseEvent,
): { row: number; col: number } | null {
  const screen = terminal.element?.querySelector('.xterm-screen');

  if (!screen) {
    return null;
  }

  const rect = screen.getBoundingClientRect();
  const col = Math.floor((event.clientX - rect.left) / (rect.width / terminal.cols));
  const relativeRow = Math.floor((event.clientY - rect.top) / (rect.height / terminal.rows));
  const row = terminal.buffer.active.viewportY + relativeRow;

  if (col < 0 || col >= terminal.cols || relativeRow < 0 || relativeRow >= terminal.rows) {
    return null;
  }

  return { row, col };
}

export function findUrlAtTerminalPosition(terminal: Terminal, event: MouseEvent): string | null {
  const position = getTerminalCellPosition(terminal, event);

  if (!position) {
    return null;
  }

  const getLineText = createLineTextReader(terminal);
  let scanRow = position.row;

  while (scanRow > 0 && isTerminalUrlContinuationLine(getLineText, scanRow)) {
    scanRow -= 1;
  }

  const text = getLineText(scanRow);

  if (!text) {
    return null;
  }

  const regex = new RegExp(TERMINAL_URL_REGEX.source, TERMINAL_URL_REGEX.flags);

  for (const match of text.matchAll(regex)) {
    const start = match.index ?? 0;
    const seed = stripTrailingUrlChars(match[0]);
    const extended = extendTerminalUrlAcrossLines(getLineText, scanRow, start, seed);

    if (
      isPositionInsideTerminalUrlRange(
        position.row,
        position.col,
        scanRow,
        start,
        extended.endRow,
        extended.endCol,
      )
    ) {
      return normalizeBrowserUrl(extended.url);
    }
  }

  return null;
}

export function registerNexusTerminalLinks(
  terminal: Terminal,
  onOpenLink: (url: string) => void,
): IDisposable {
  const mousePosition = { x: 0, y: 0 };
  const linksByLine = new Map<number, ILink[]>();

  const syncHoveredLinkDecorations = (metaKey: boolean) => {
    const element = terminal.element;

    if (!element) {
      return;
    }

    const mouseEvent = new MouseEvent('mousemove', {
      bubbles: true,
      clientX: mousePosition.x,
      clientY: mousePosition.y,
      metaKey,
    });

    for (const links of linksByLine.values()) {
      for (const link of links) {
        scheduleLinkDecorations(link, metaKey && isMouseOverLink(terminal, link, mouseEvent));
      }
    }
  };

  const refreshLinkHover = (metaKey: boolean) => {
    const element = terminal.element;

    if (!element) {
      return;
    }

    syncHoveredLinkDecorations(metaKey);

    element.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: mousePosition.x,
        clientY: mousePosition.y,
        metaKey,
      }),
    );
  };

  const handleMouseMove = (event: MouseEvent) => {
    mousePosition.x = event.clientX;
    mousePosition.y = event.clientY;
  };

  const handleMetaKey = (event: KeyboardEvent) => {
    if (event.key !== 'Meta') {
      return;
    }

    refreshLinkHover(event.type === 'keydown');
  };

  const provider: ILinkProvider = {
    provideLinks(bufferLineNumber, callback) {
      const bufferRow = bufferLineNumber - 1;
      const getLineText = createLineTextReader(terminal);
      const text = getLineText(bufferRow);

      if (!text) {
        linksByLine.delete(bufferLineNumber);
        callback(undefined);
        return;
      }

      const links: ILink[] = [];

      if (isTerminalUrlContinuationLine(getLineText, bufferRow)) {
        let originRow = bufferRow;

        while (originRow > 0 && isTerminalUrlContinuationLine(getLineText, originRow)) {
          originRow -= 1;
        }

        const originText = getLineText(originRow) ?? '';
        const regex = new RegExp(TERMINAL_URL_REGEX.source, TERMINAL_URL_REGEX.flags);
        const originMatch = [...originText.matchAll(regex)].at(-1);

        if (originMatch) {
          const start = originMatch.index ?? 0;
          const seed = stripTrailingUrlChars(originMatch[0]);
          const extended = extendTerminalUrlAcrossLines(getLineText, originRow, start, seed);

          if (extended.endRow === bufferRow) {
            const leadingSpaces = text.length - text.trimStart().length;
            const continuation = text.trimStart().match(TERMINAL_URL_CONTINUE_REGEX)?.[0] ?? '';

            if (continuation) {
              const link: ILink = {
                text: extended.url,
                range: {
                  start: { x: leadingSpaces + 1, y: bufferLineNumber },
                  end: { x: leadingSpaces + continuation.length, y: bufferLineNumber },
                },
                decorations: {
                  underline: false,
                  pointerCursor: false,
                },
                activate(event, linkText) {
                  if (!event.metaKey) {
                    return;
                  }

                  onOpenLink(normalizeBrowserUrl(linkText));
                },
                hover(event) {
                  scheduleLinkDecorations(link, event.metaKey);
                },
                leave() {
                  scheduleLinkDecorations(link, false);
                },
              };

              links.push(link);
            }
          }
        }
      } else {
        const regex = new RegExp(TERMINAL_URL_REGEX.source, TERMINAL_URL_REGEX.flags);

        for (const match of text.matchAll(regex)) {
          const start = match.index ?? 0;
          const seed = stripTrailingUrlChars(match[0]);
          const extended = extendTerminalUrlAcrossLines(getLineText, bufferRow, start, seed);

          const link: ILink = {
            text: extended.url,
            range: {
              start: { x: start + 1, y: bufferLineNumber },
              end: {
                x: extended.endRow === bufferRow ? extended.endCol : text.length,
                y: bufferLineNumber,
              },
            },
            decorations: {
              underline: false,
              pointerCursor: false,
            },
            activate(event, linkText) {
              if (!event.metaKey) {
                return;
              }

              onOpenLink(normalizeBrowserUrl(linkText));
            },
            hover(event) {
              scheduleLinkDecorations(link, event.metaKey);
            },
            leave() {
              scheduleLinkDecorations(link, false);
            },
          };

          links.push(link);
        }
      }

      if (links.length > 0) {
        linksByLine.set(bufferLineNumber, links);
        callback(links);
        return;
      }

      linksByLine.delete(bufferLineNumber);
      callback(undefined);
    },
  };

  terminal.options.linkHandler = {
    allowNonHttpProtocols: false,
    activate(event, text) {
      if (!event.metaKey) {
        return;
      }

      onOpenLink(normalizeBrowserUrl(text));
    },
  };

  const element = terminal.element;
  element?.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('keydown', handleMetaKey);
  window.addEventListener('keyup', handleMetaKey);

  const linkDisposable = terminal.registerLinkProvider(provider);

  return {
    dispose: () => {
      element?.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleMetaKey);
      window.removeEventListener('keyup', handleMetaKey);
      linksByLine.clear();
      linkDisposable.dispose();
    },
  };
}

import type { IDisposable, ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import { normalizeBrowserUrl } from '@/utils/browserUrl';
import { stripTrailingUrlChars, TERMINAL_URL_REGEX } from '@/utils/terminalUrlExtract';

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

  const line = terminal.buffer.active.getLine(position.row);

  if (!line) {
    return null;
  }

  const text = line.translateToString(true);
  const matches = text.matchAll(TERMINAL_URL_REGEX);

  for (const match of matches) {
    const start = match.index ?? 0;
    const raw = stripTrailingUrlChars(match[0]);
    const end = start + raw.length;

    if (position.col >= start && position.col < end) {
      return normalizeBrowserUrl(raw);
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
      const line = terminal.buffer.active.getLine(bufferLineNumber - 1);

      if (!line) {
        linksByLine.delete(bufferLineNumber);
        callback(undefined);
        return;
      }

      const text = line.translateToString(true);
      const links: ILink[] = [];

      for (const match of text.matchAll(TERMINAL_URL_REGEX)) {
        const start = match.index ?? 0;
        const raw = stripTrailingUrlChars(match[0]);
        const end = start + raw.length;

        const link: ILink = {
          text: raw,
          range: {
            start: { x: start + 1, y: bufferLineNumber },
            end: { x: end, y: bufferLineNumber },
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

import type { ITheme } from '@xterm/xterm';

export const MONOKAI_PALETTE = {
  background: '#272822',
  foreground: '#F8F8F2',
  black: '#272822',
  red: '#F92672',
  green: '#A6E22E',
  yellow: '#E6DB74',
  blue: '#66D9EF',
  magenta: '#AE81FF',
  cyan: '#66D9EF',
  white: '#F8F8F2',
  brightBlack: '#75715E',
  brightRed: '#F92672',
  brightGreen: '#A6E22E',
  brightYellow: '#E6DB74',
  brightBlue: '#66D9EF',
  brightMagenta: '#AE81FF',
  brightCyan: '#66D9EF',
  brightWhite: '#F8F8F2',
} as const;

export function buildMonokaiTheme(
  cursor: string,
  cursorAccent: string,
  selectionBackground: string,
): ITheme {
  return {
    background: 'rgba(0,0,0,0)',
    foreground: MONOKAI_PALETTE.foreground,
    cursor,
    cursorAccent,
    selectionBackground,
    selectionForeground: MONOKAI_PALETTE.foreground,
    black: MONOKAI_PALETTE.black,
    red: MONOKAI_PALETTE.red,
    green: MONOKAI_PALETTE.green,
    yellow: MONOKAI_PALETTE.yellow,
    blue: MONOKAI_PALETTE.blue,
    magenta: MONOKAI_PALETTE.magenta,
    cyan: MONOKAI_PALETTE.cyan,
    white: MONOKAI_PALETTE.white,
    brightBlack: MONOKAI_PALETTE.brightBlack,
    brightRed: MONOKAI_PALETTE.brightRed,
    brightGreen: MONOKAI_PALETTE.brightGreen,
    brightYellow: MONOKAI_PALETTE.brightYellow,
    brightBlue: MONOKAI_PALETTE.brightBlue,
    brightMagenta: MONOKAI_PALETTE.brightMagenta,
    brightCyan: MONOKAI_PALETTE.brightCyan,
    brightWhite: MONOKAI_PALETTE.brightWhite,
  };
}

import type { Terminal } from '@xterm/xterm';

export const TERMINAL_BADGE_ICON_PADDING_COLS = 6;
export const TERMINAL_BADGE_MIN_COLS = 16;
export const TERMINAL_BADGE_MAX_COLS = 32;
export const TERMINAL_BADGE_MAX_PATH_COLS = 26;
export const TERMINAL_BADGE_PROMPT_GAP_COLS = 6;

export interface TerminalCellDimensions {
  width: number;
  height: number;
}

export interface ActiveBadgeLayer {
  top: number;
  left: number;
  badgeWidth: number;
  gapWidth: number;
  visible: boolean;
}

export function computeBadgeWidthCols(displayPath: string): number {
  const pathLength = Math.min(displayPath.length, TERMINAL_BADGE_MAX_PATH_COLS);
  const badgeCols = TERMINAL_BADGE_ICON_PADDING_COLS + pathLength;

  return Math.max(TERMINAL_BADGE_MIN_COLS, Math.min(TERMINAL_BADGE_MAX_COLS, badgeCols));
}

export function computePromptOffsetCols(displayPath: string): number {
  return computeBadgeWidthCols(displayPath) + TERMINAL_BADGE_PROMPT_GAP_COLS;
}

export function readTerminalCellDimensions(
  terminal: Terminal,
  container: HTMLElement,
): TerminalCellDimensions | null {
  const core = (
    terminal as Terminal & {
      _core?: { _renderService?: { dimensions?: { css?: { cell?: TerminalCellDimensions } } } };
    }
  )._core?._renderService?.dimensions?.css?.cell;

  if (core && core.width > 0 && core.height > 0) {
    return core;
  }

  const row = container.querySelector('.xterm-rows > div');
  const screen = container.querySelector('.xterm-screen');

  if (!(row instanceof HTMLElement) || !(screen instanceof HTMLElement) || terminal.cols <= 0) {
    return null;
  }

  const height = row.getBoundingClientRect().height;
  const width = screen.clientWidth / terminal.cols;

  if (height <= 0 || width <= 0) {
    return null;
  }

  return { width, height };
}

export function computeActiveBadgeLayer(
  shell: HTMLElement,
  container: HTMLElement,
  terminal: Terminal,
  displayPath: string,
): ActiveBadgeLayer | null {
  const cursor = container.querySelector('.xterm-cursor');

  if (!(cursor instanceof HTMLElement)) {
    return null;
  }

  const cell = readTerminalCellDimensions(terminal, container);

  if (!cell) {
    return null;
  }

  const screen = container.querySelector('.xterm-screen');

  if (!(screen instanceof HTMLElement)) {
    return null;
  }

  const badgeWidthPx = computeBadgeWidthCols(displayPath) * cell.width;
  const gapWidthPx = TERMINAL_BADGE_PROMPT_GAP_COLS * cell.width;
  const shellRect = shell.getBoundingClientRect();
  const cursorRect = cursor.getBoundingClientRect();
  const screenRect = screen.getBoundingClientRect();
  const badgeHeight = Math.min(24, cursorRect.height);
  const top = cursorRect.top - shellRect.top + Math.max(0, (cursorRect.height - badgeHeight) / 2);
  const left = screenRect.left - shellRect.left;

  return {
    top,
    left,
    badgeWidth: badgeWidthPx,
    gapWidth: gapWidthPx,
    visible: true,
  };
}

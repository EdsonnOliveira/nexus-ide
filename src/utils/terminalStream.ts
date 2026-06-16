import { createNexusCwdStreamParser } from '@/utils/terminalCwd';

const SOFT_INPUT_BG = '\x1b[48;2;28;28;32m';
const SOFT_BORDER_FG = '\x1b[38;2;255;255;255m';

function isDarkTrueColor(r: number, g: number, b: number): boolean {
  return Math.max(r, g, b) <= 55;
}

function rewriteSgrParams(params: string): string | null {
  if (!params) {
    return null;
  }

  const codes = params.split(';').filter((part) => part.length > 0).map(Number);
  const next: number[] = [];
  let changed = false;
  let index = 0;

  while (index < codes.length) {
    const code = codes[index];

    if (code === 38 && codes[index + 1] === 2) {
      const red = codes[index + 2] ?? 0;
      const green = codes[index + 3] ?? 0;
      const blue = codes[index + 4] ?? 0;

      if (isDarkTrueColor(red, green, blue)) {
        next.push(38, 2, 255, 255, 255);
        changed = true;
      } else {
        next.push(38, 2, red, green, blue);
      }

      index += 5;
      continue;
    }

    if (code === 38 && codes[index + 1] === 5) {
      const color = codes[index + 2] ?? 0;

      if (color <= 243) {
        next.push(38, 2, 255, 255, 255);
        changed = true;
      } else {
        next.push(38, 5, color);
      }

      index += 3;
      continue;
    }

    if (code === 48 && codes[index + 1] === 2) {
      const red = codes[index + 2] ?? 0;
      const green = codes[index + 3] ?? 0;
      const blue = codes[index + 4] ?? 0;

      if (isDarkTrueColor(red, green, blue)) {
        next.push(48, 2, 28, 28, 32);
        changed = true;
      } else {
        next.push(48, 2, red, green, blue);
      }

      index += 5;
      continue;
    }

    if (code === 48 && codes[index + 1] === 5) {
      const color = codes[index + 2] ?? 0;

      if (color <= 240) {
        next.push(48, 2, 28, 28, 32);
        changed = true;
      } else {
        next.push(48, 5, color);
      }

      index += 3;
      continue;
    }

    if (code === 30 || code === 90) {
      next.push(38, 2, 255, 255, 255);
      changed = true;
      index += 1;
      continue;
    }

    if (code === 40 || code === 100) {
      next.push(48, 2, 28, 28, 32);
      changed = true;
      index += 1;
      continue;
    }

    next.push(code);
    index += 1;
  }

  if (!changed) {
    return null;
  }

  return next.join(';');
}

export function softenDarkTerminalBackgrounds(chunk: string): string {
  return chunk.replace(/\x1b\[([0-9;]*)m/g, (match, params: string) => {
    const rewritten = rewriteSgrParams(params);

    if (!rewritten) {
      return match;
    }

    return `\x1b[${rewritten}m`;
  });
}

export function createTerminalOutputParser(
  onCwdChange: (cwd: string) => void,
  onShellPrompt?: () => void,
) {
  const parseCwd = createNexusCwdStreamParser((cwd) => {
    onCwdChange(cwd);
    onShellPrompt?.();
  });

  return (chunk: string): string => softenDarkTerminalBackgrounds(parseCwd(chunk));
}

export { SOFT_BORDER_FG, SOFT_INPUT_BG };

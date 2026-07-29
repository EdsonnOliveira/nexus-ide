const HID_CODES: Record<string, number> = {
  KeyA: 4,
  KeyB: 5,
  KeyC: 6,
  KeyD: 7,
  KeyE: 8,
  KeyF: 9,
  KeyG: 10,
  KeyH: 11,
  KeyI: 12,
  KeyJ: 13,
  KeyK: 14,
  KeyL: 15,
  KeyM: 16,
  KeyN: 17,
  KeyO: 18,
  KeyP: 19,
  KeyQ: 20,
  KeyR: 21,
  KeyS: 22,
  KeyT: 23,
  KeyU: 24,
  KeyV: 25,
  KeyW: 26,
  KeyX: 27,
  KeyY: 28,
  KeyZ: 29,
  Digit1: 30,
  Digit2: 31,
  Digit3: 32,
  Digit4: 33,
  Digit5: 34,
  Digit6: 35,
  Digit7: 36,
  Digit8: 37,
  Digit9: 38,
  Digit0: 39,
  Enter: 40,
  Escape: 41,
  Backspace: 42,
  Tab: 43,
  Space: 44,
  Minus: 45,
  Equal: 46,
  BracketLeft: 47,
  BracketRight: 48,
  Backslash: 49,
  Semicolon: 51,
  Quote: 52,
  Backquote: 53,
  Comma: 54,
  Period: 55,
  Slash: 56,
  ArrowRight: 79,
  ArrowLeft: 80,
  ArrowDown: 81,
  ArrowUp: 82,
  ShiftLeft: 225,
};

const SYMBOL_KEYCODES: Record<string, number> = {
  '\n': 40,
  '\r': 40,
  '\b': 42,
  '\t': 43,
  ' ': 44,
  '-': 45,
  '=': 46,
  '[': 47,
  ']': 48,
  '\\': 49,
  ';': 51,
  "'": 52,
  '`': 53,
  ',': 54,
  '.': 55,
  '/': 56,
};

const SHIFTED_SYMBOLS: Record<string, string> = {
  '!': '1',
  '@': '2',
  '#': '3',
  $: '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0',
  _: '-',
  '+': '=',
  '{': '[',
  '}': ']',
  '|': '\\',
  ':': ';',
  '"': "'",
  '~': '`',
  '<': ',',
  '>': '.',
  '?': '/',
};

export const SHIFT_HID_KEYCODE = 225;
export const LEFT_GUI_HID_KEYCODE = 227;
export const KEY_V_HID_KEYCODE = 25;

export interface SimulatorKeyPress {
  keyCode: number;
  withShift: boolean;
}

export function formatSimulatorTouchInput(
  action: 'Down' | 'Move' | 'Up',
  x: number,
  y: number,
): string {
  return `touch ${action} ${x},${y}`;
}

export function formatSimulatorButtonInput(action: 'Down' | 'Up', name: string): string {
  return `button ${action} ${name}`;
}

export function formatSimulatorKeyInput(action: 'Down' | 'Up', code: number): string {
  return `key ${action} ${code}`;
}

export function keyboardCodeToHid(code: string): number | null {
  return HID_CODES[code] ?? null;
}

export function charToKeyPress(char: string): SimulatorKeyPress | null {
  if (char.length !== 1) {
    return null;
  }

  const codePoint = char.charCodeAt(0);

  if (codePoint >= 0x61 && codePoint <= 0x7a) {
    return { keyCode: codePoint - 0x61 + 4, withShift: false };
  }

  if (codePoint >= 0x41 && codePoint <= 0x5a) {
    return { keyCode: codePoint - 0x41 + 4, withShift: true };
  }

  if (codePoint >= 0x31 && codePoint <= 0x39) {
    return { keyCode: codePoint - 0x31 + 30, withShift: false };
  }

  if (char === '0') {
    return { keyCode: 39, withShift: false };
  }

  const shiftedBase = SHIFTED_SYMBOLS[char];

  if (shiftedBase !== undefined) {
    const basePress = charToKeyPress(shiftedBase);

    if (!basePress) {
      return null;
    }

    return { keyCode: basePress.keyCode, withShift: true };
  }

  const symbolCode = SYMBOL_KEYCODES[char];

  if (symbolCode === undefined) {
    return null;
  }

  return { keyCode: symbolCode, withShift: false };
}

export function charToHid(char: string): number | null {
  return charToKeyPress(char)?.keyCode ?? null;
}

export function isValidSimulatorInputLine(line: string): boolean {
  return line.length > 0 && line.length <= 256 && !line.includes('\n') && !line.includes('\r');
}

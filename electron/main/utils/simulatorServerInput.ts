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
};

const CHAR_TO_HID: Record<string, number> = {
  a: 4,
  b: 5,
  c: 6,
  d: 7,
  e: 8,
  f: 9,
  g: 10,
  h: 11,
  i: 12,
  j: 13,
  k: 14,
  l: 15,
  m: 16,
  n: 17,
  o: 18,
  p: 19,
  q: 20,
  r: 21,
  s: 22,
  t: 23,
  u: 24,
  v: 25,
  w: 26,
  x: 27,
  y: 28,
  z: 29,
  '1': 30,
  '2': 31,
  '3': 32,
  '4': 33,
  '5': 34,
  '6': 35,
  '7': 36,
  '8': 37,
  '9': 38,
  '0': 39,
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

export function charToHid(char: string): number | null {
  if (char === '\n' || char === '\r') {
    return 40;
  }

  if (char === '\b') {
    return 42;
  }

  if (char in CHAR_TO_HID) {
    return CHAR_TO_HID[char]!;
  }

  const lower = char.toLowerCase();

  if (lower in CHAR_TO_HID) {
    return CHAR_TO_HID[lower]!;
  }

  return null;
}

export function isValidSimulatorInputLine(line: string): boolean {
  return line.length > 0 && line.length <= 256 && !line.includes('\n') && !line.includes('\r');
}

export type ProjectPingTone = 'red' | 'yellow';

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim().toLowerCase();
  const match = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);

  if (!match) {
    return null;
  }

  let value = match[1];

  if (value.length === 3) {
    value = value
      .split('')
      .map((char) => char + char)
      .join('');
  }

  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l: lightness };
  }

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let hue = 0;

  if (max === red) {
    hue = ((green - blue) / delta + (green < blue ? 6 : 0)) / 6;
  } else if (max === green) {
    hue = ((blue - red) / delta + 2) / 6;
  } else {
    hue = ((red - green) / delta + 4) / 6;
  }

  return { h: hue * 360, s: saturation, l: lightness };
}

function isWarmOrVioletHue(hue: number): boolean {
  return hue <= 60 || hue >= 260;
}

export function getProjectPingTone(projectColor: string): ProjectPingTone {
  const rgb = parseHexColor(projectColor);

  if (!rgb) {
    return 'red';
  }

  const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b);

  if (s < 0.12) {
    return 'red';
  }

  if (isWarmOrVioletHue(h)) {
    return 'yellow';
  }

  return 'red';
}

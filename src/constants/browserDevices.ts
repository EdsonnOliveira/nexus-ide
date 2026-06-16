export interface BrowserDevicePreset {
  id: string;
  label: string;
  width: number | null;
  height: number | null;
}

export const BROWSER_DEVICE_PRESETS: BrowserDevicePreset[] = [
  { id: 'responsive', label: 'Responsivo', width: null, height: null },
  { id: 'iphone-15-pro', label: 'iPhone 15 Pro', width: 393, height: 852 },
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667 },
  { id: 'ipad-air', label: 'iPad Air', width: 820, height: 1180 },
  { id: 'ipad-mini', label: 'iPad Mini', width: 744, height: 1133 },
  { id: 'macbook-air', label: 'MacBook Air 13"', width: 1280, height: 832 },
  { id: 'macbook-pro-14', label: 'MacBook Pro 14"', width: 1512, height: 982 },
];

export const DEFAULT_BROWSER_DEVICE_ID = 'responsive';

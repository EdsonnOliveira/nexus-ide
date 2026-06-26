import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { EmulatorDevice, EmulatorPlatform } from '../../types';

interface DeviceUsageEntry {
  count: number;
  lastUsedAt: number;
}

interface DeviceUsageFile {
  entries: Record<string, DeviceUsageEntry>;
}

function usageKey(platform: EmulatorPlatform, deviceId: string): string {
  return `${platform}:${deviceId}`;
}

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'emulator-device-usage.json');
}

let cache: DeviceUsageFile | null = null;

function loadStore(): DeviceUsageFile {
  if (cache) {
    return cache;
  }

  const filePath = getStorePath();

  if (existsSync(filePath)) {
    try {
      cache = JSON.parse(readFileSync(filePath, 'utf8')) as DeviceUsageFile;
      return cache;
    } catch {
      cache = { entries: {} };
      return cache;
    }
  }

  cache = { entries: {} };
  return cache;
}

function persistStore(store: DeviceUsageFile): void {
  cache = store;
  const filePath = getStorePath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(store));
}

function readUsage(platform: EmulatorPlatform, deviceId: string): DeviceUsageEntry {
  const store = loadStore();
  return store.entries[usageKey(platform, deviceId)] ?? { count: 0, lastUsedAt: 0 };
}

function defaultDeviceRank(device: EmulatorDevice, platform: EmulatorPlatform): number {
  if (platform === 'android') {
    return 0;
  }

  const name = device.name.toLowerCase();
  let rank = 0;

  if (name.includes('iphone')) {
    rank -= 1_000;
  }

  if (name.includes('ipad')) {
    rank += 500;
  }

  const iosMatch = device.subtitle?.match(/iOS\s+(\d+)/i);

  if (iosMatch) {
    rank -= Number(iosMatch[1]) * 10;
  }

  return rank;
}

export function recordEmulatorDeviceUsage(
  platform: EmulatorPlatform,
  deviceId: string,
): void {
  const store = loadStore();
  const key = usageKey(platform, deviceId);
  const current = store.entries[key] ?? { count: 0, lastUsedAt: 0 };

  store.entries[key] = {
    count: current.count + 1,
    lastUsedAt: Date.now(),
  };

  persistStore(store);
}

export function sortEmulatorDevicesByUsage(
  devices: EmulatorDevice[],
  platform: EmulatorPlatform,
): EmulatorDevice[] {
  return [...devices].sort((left, right) => {
    const leftBooted = left.state === 'booted' ? 1 : 0;
    const rightBooted = right.state === 'booted' ? 1 : 0;

    if (leftBooted !== rightBooted) {
      return rightBooted - leftBooted;
    }

    const leftUsage = readUsage(platform, left.id);
    const rightUsage = readUsage(platform, right.id);

    if (leftUsage.count !== rightUsage.count) {
      return rightUsage.count - leftUsage.count;
    }

    if (leftUsage.lastUsedAt !== rightUsage.lastUsedAt) {
      return rightUsage.lastUsedAt - leftUsage.lastUsedAt;
    }

    const leftDefault = defaultDeviceRank(left, platform);
    const rightDefault = defaultDeviceRank(right, platform);

    if (leftDefault !== rightDefault) {
      return leftDefault - rightDefault;
    }

    return left.name.localeCompare(right.name);
  });
}

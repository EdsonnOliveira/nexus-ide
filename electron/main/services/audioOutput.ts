import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';

const execFileAsync = promisify(execFile);

export interface AudioOutputDeviceItem {
  id: string;
  name: string;
  active: boolean;
  kind: 'builtin' | 'headphones' | 'tv' | 'virtual' | 'other';
}

function assertDarwinSupported(): void {
  if (process.platform !== 'darwin') {
    throw new Error('Audio output control is only supported on macOS.');
  }
}

function resolveSwiftScriptPath(): string {
  const candidates = [
    path.join(process.cwd(), 'resources/shell/macosAudioOutput.swift'),
    path.join(app.getAppPath(), 'resources/shell/macosAudioOutput.swift'),
    path.join(process.resourcesPath, 'app.asar.unpacked/resources/shell/macosAudioOutput.swift'),
    path.join(process.resourcesPath, 'resources/shell/macosAudioOutput.swift'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('macosAudioOutput.swift not found.');
}

async function runSwiftScript(args: string[]): Promise<string> {
  const scriptPath = resolveSwiftScriptPath();
  const { stdout } = await execFileAsync('/usr/bin/swift', [scriptPath, ...args]);
  return stdout.trim();
}

function inferDeviceKind(name: string, uid: string): AudioOutputDeviceItem['kind'] {
  const lowerName = name.toLowerCase();
  const lowerUid = uid.toLowerCase();

  if (
    lowerName.includes('airpods') ||
    lowerName.includes('headphone') ||
    lowerName.includes('beats') ||
    lowerName.includes('earbuds')
  ) {
    return 'headphones';
  }

  if (lowerName.includes('tv') || lowerName.includes('hdmi') || lowerName.includes('display')) {
    return 'tv';
  }

  if (
    lowerUid.includes('builtin') ||
    (lowerName.includes('macbook') && lowerName.includes('speaker')) ||
    lowerName.includes('speakers')
  ) {
    return 'builtin';
  }

  if (
    lowerName.includes('blackhole') ||
    lowerName.includes('loopback') ||
    lowerName.includes('virtual') ||
    lowerName.includes('teams') ||
    lowerName.includes('recorder')
  ) {
    return 'virtual';
  }

  return 'other';
}

function parseDeviceRows(raw: string): AudioOutputDeviceItem[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, name, activeRaw] = line.split('\t');

      return {
        id: id ?? '',
        name: name ?? 'Unknown',
        active: activeRaw === '1',
        kind: inferDeviceKind(name ?? '', id ?? ''),
      };
    })
    .filter((device) => device.id.length > 0 && device.name.length > 0);
}

export async function listAudioOutputDevices(): Promise<AudioOutputDeviceItem[]> {
  if (process.platform !== 'darwin') {
    return [];
  }

  try {
    const raw = await runSwiftScript(['list']);
    const devices = parseDeviceRows(raw);

    return devices.sort((left, right) => {
      if (left.active && !right.active) {
        return -1;
      }

      if (!left.active && right.active) {
        return 1;
      }

      return left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' });
    });
  } catch {
    return [];
  }
}

export async function setAudioOutputDevice(deviceId: string): Promise<boolean> {
  assertDarwinSupported();

  const trimmedId = deviceId.trim();

  if (!trimmedId) {
    return false;
  }

  try {
    const result = await runSwiftScript(['set', trimmedId]);
    return result === 'ok';
  } catch {
    return false;
  }
}

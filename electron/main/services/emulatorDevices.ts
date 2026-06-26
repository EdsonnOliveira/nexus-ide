import { spawn } from 'node:child_process';
import type { EmulatorDevice, EmulatorPlatform, EmulatorPlatformSetup } from '../../types';
import { sortEmulatorDevicesByUsage } from './emulatorDeviceUsageStore';
import {
  resolveAdbPath,
  resolveEmulatorPath,
  resolveIdbCompanionPath,
  resolveIdbPath,
  resolveXcrunPath,
  hasAndroidSdkRoot,
} from './emulatorPaths';

interface SimctlDeviceEntry {
  name: string;
  udid: string;
  state: string;
  isAvailable?: boolean;
}

interface SimctlRuntimeDevices {
  devices: Record<string, SimctlDeviceEntry[]>;
}

function runCommand(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    const child = spawn(command, args, { env: process.env });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
    child.on('error', () => {
      resolve({ stdout, stderr, code: 1 });
    });
  });
}

export async function listAndroidAvds(): Promise<EmulatorDevice[]> {
  const emulator = resolveEmulatorPath();

  if (!emulator.found) {
    return [];
  }

  const result = await runCommand(emulator.path, ['-list-avds']);
  const avdNames = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const adb = resolveAdbPath();
  const bootedSerials = new Set<string>();

  if (adb.found) {
    const devicesResult = await runCommand(adb.path, ['devices']);
    const lines = devicesResult.stdout.split('\n').slice(1);

    for (const line of lines) {
      const [serial, state] = line.trim().split(/\s+/);

      if (serial && state === 'device') {
        bootedSerials.add(serial);
      }
    }
  }

  return sortEmulatorDevicesByUsage(
    avdNames.map((name) => ({
      id: name,
      name,
      platform: 'android' as const,
      subtitle: 'AVD',
      state: bootedSerials.has(name) || [...bootedSerials].some((serial) => serial.includes(name))
        ? 'booted'
        : 'available',
    })),
    'android',
  );
}

export async function listIosSimulators(): Promise<EmulatorDevice[]> {
  const xcrun = resolveXcrunPath();

  if (!xcrun.found) {
    return [];
  }

  const result = await runCommand(xcrun.path, ['simctl', 'list', 'devices', 'available', '-j']);

  if (result.code !== 0) {
    return [];
  }

  let parsed: SimctlRuntimeDevices;

  try {
    parsed = JSON.parse(result.stdout) as SimctlRuntimeDevices;
  } catch {
    return [];
  }

  const devices: EmulatorDevice[] = [];

  for (const [runtime, entries] of Object.entries(parsed.devices)) {
    const runtimeLabel = runtime.replace('com.apple.CoreSimulator.SimRuntime.', '').replace(/-/g, ' ');

    for (const entry of entries) {
      if (entry.isAvailable === false) {
        continue;
      }

      devices.push({
        id: entry.udid,
        name: entry.name,
        platform: 'ios',
        subtitle: runtimeLabel,
        state: entry.state === 'Booted' ? 'booted' : 'available',
      });
    }
  }

  return sortEmulatorDevicesByUsage(devices, 'ios');
}

export { recordEmulatorDeviceUsage } from './emulatorDeviceUsageStore';

export async function listEmulatorDevices(platform: EmulatorPlatform): Promise<EmulatorDevice[]> {
  if (platform === 'android') {
    return listAndroidAvds();
  }

  return listIosSimulators();
}

export function getEmulatorSetupStatus(): {
  android: EmulatorPlatformSetup;
  ios: EmulatorPlatformSetup;
} {
  const adb = resolveAdbPath();
  const emulator = resolveEmulatorPath();
  const xcrun = resolveXcrunPath();
  const idb = resolveIdbPath();
  const idbCompanion = resolveIdbCompanionPath();

  const androidMissing: string[] = [];

  if (!hasAndroidSdkRoot()) {
    androidMissing.push('ANDROID_HOME');
  }

  if (!adb.found) {
    androidMissing.push('adb');
  }

  if (!emulator.found) {
    androidMissing.push('emulator');
  }

  const iosMissing: string[] = [];
  const iosOptionalMissing: string[] = [];

  if (process.platform !== 'darwin') {
    iosMissing.push('macOS');
  }

  if (!xcrun.found) {
    iosMissing.push('xcrun');
  }

  if (!idb.found) {
    iosOptionalMissing.push('idb');
  }

  if (!idbCompanion.found) {
    iosOptionalMissing.push('idb-companion');
  }

  const androidInstallCommand =
    androidMissing.length > 0 && process.platform === 'darwin'
      ? 'open -a "Android Studio"'
      : null;

  const iosInstallCommand = iosMissing.includes('xcrun')
    ? 'xcode-select --install'
    : iosOptionalMissing.includes('idb-companion')
      ? 'brew tap facebook/fb && brew install idb-companion'
      : iosOptionalMissing.includes('idb')
        ? 'pip3 install fb-idb'
        : null;

  return {
    android: {
      available: androidMissing.length === 0,
      missingTools: androidMissing,
      installHint:
        androidMissing.length > 0
          ? 'Instale o Android Studio e configure ANDROID_HOME com platform-tools e emulator.'
          : null,
      installCommand: androidInstallCommand,
    },
    ios: {
      available: iosMissing.length === 0,
      missingTools: [...iosMissing, ...iosOptionalMissing],
      installHint:
        iosMissing.includes('macOS')
          ? 'O emulador iOS só funciona no macOS com Xcode.'
          : iosMissing.includes('xcrun')
            ? 'Instale o Xcode e as ferramentas de linha de comando.'
            : iosOptionalMissing.includes('idb-companion')
              ? 'Para stream em 60 FPS, instale o idb-companion: brew tap facebook/fb && brew install idb-companion'
              : iosOptionalMissing.includes('idb')
                ? 'Visualização disponível. Para toques e stream rápido, instale o idb: pip3 install fb-idb'
                : null,
      installCommand: iosInstallCommand,
    },
  };
}

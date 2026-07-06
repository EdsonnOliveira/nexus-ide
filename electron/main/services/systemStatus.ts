import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  disconnectWifiNetwork as disconnectWifiFromInterface,
  getWifiConnectedFromInterface,
  scanAvailableWifiNetworks,
} from './wifiControl';

const execFileAsync = promisify(execFile);

let cachedWifiDevice: string | null = null;

export interface SystemStatusSnapshot {
  platformSupported: boolean;
  volume: number;
  muted: boolean;
  batteryLevel: number | null;
  batteryCharging: boolean;
  batteryPresent: boolean;
  batteryTimeRemaining: string | null;
  wifiConnected: boolean;
  wifiNetwork: string | null;
}

export interface WifiNetworkItem {
  ssid: string;
  connected: boolean;
  secured: boolean;
}

export interface WifiConnectResult {
  ok: boolean;
  error?: string;
  needsPassword?: boolean;
}

export interface WifiPopupState {
  wifiEnabled: boolean;
  connectedNetwork: string | null;
  networks: WifiNetworkItem[];
}

const EMPTY_SNAPSHOT: SystemStatusSnapshot = {
  platformSupported: false,
  volume: 0,
  muted: false,
  batteryLevel: null,
  batteryCharging: false,
  batteryPresent: false,
  batteryTimeRemaining: null,
  wifiConnected: false,
  wifiNetwork: null,
};

function assertDarwinSupported(): void {
  if (process.platform !== 'darwin') {
    throw new Error('System status is only supported on macOS.');
  }
}

async function runCommand(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args);
  return stdout.trim();
}

function parseVolumeSettings(raw: string): { volume: number; muted: boolean } {
  const volumeMatch = raw.match(/output volume:(\d+)/i);
  const mutedMatch = raw.match(/output muted:(true|false)/i);

  return {
    volume: volumeMatch ? Number.parseInt(volumeMatch[1], 10) : 0,
    muted: mutedMatch?.[1]?.toLowerCase() === 'true',
  };
}

function parseBatteryStatus(raw: string): {
  level: number | null;
  charging: boolean;
  present: boolean;
  timeRemaining: string | null;
} {
  const line = raw
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.includes('%'));

  if (!line) {
    return { level: null, charging: false, present: false, timeRemaining: null };
  }

  const levelMatch = line.match(/(\d+)%/);
  const charging =
    (/\bcharging\b/i.test(line) && !/\bnot charging\b/i.test(line) && !/\bdischarging\b/i.test(line)) ||
    /\bcharged\b/i.test(line) ||
    /\bfinishing charge\b/i.test(line) ||
    /\bAC Power\b/i.test(line) && /\bfull\b/i.test(line);
  const present = /\bpresent:\s*true\b/i.test(line);
  const timeMatch = line.match(/(\d+:\d+)\s+remaining/i);

  return {
    level: levelMatch ? Number.parseInt(levelMatch[1], 10) : null,
    charging,
    present,
    timeRemaining: timeMatch?.[1] ?? null,
  };
}

async function resolveWifiDeviceName(): Promise<string> {
  if (cachedWifiDevice) {
    return cachedWifiDevice;
  }

  try {
    const raw = await runCommand('/usr/sbin/networksetup', ['-listallhardwareports']);
    const blocks = raw.split(/\n\n+/);

    for (const block of blocks) {
      if (!/Hardware Port:\s*Wi-Fi/i.test(block)) {
        continue;
      }

      const deviceMatch = block.match(/Device:\s*(\S+)/i);

      if (deviceMatch?.[1]) {
        cachedWifiDevice = deviceMatch[1];
        return cachedWifiDevice;
      }
    }
  } catch {
    // ignore
  }

  cachedWifiDevice = 'en0';
  return cachedWifiDevice;
}

function parseIpconfigLinkActive(raw: string): boolean {
  return /InterfaceType\s*:\s*WiFi/i.test(raw) && /LinkStatusActive\s*:\s*TRUE/i.test(raw);
}

async function isWifiInterfaceLinkActive(device: string): Promise<boolean> {
  const summary = await runCommand('/usr/sbin/ipconfig', ['getsummary', device]).catch(() => '');

  return parseIpconfigLinkActive(summary);
}

function parseWifiStatus(raw: string): { connected: boolean; network: string | null } {
  if (!raw || /not associated/i.test(raw)) {
    return { connected: false, network: null };
  }

  const networkMatch = raw.match(/Current Wi-Fi Network:\s*(.+)$/i);

  if (networkMatch?.[1]) {
    return { connected: true, network: networkMatch[1].trim() };
  }

  return { connected: false, network: null };
}

function isValidSsid(value: string): boolean {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return false;
  }

  if (/^<redacted>$/i.test(trimmed)) {
    return false;
  }

  if (/^<[^>]+>$/.test(trimmed)) {
    return false;
  }

  return true;
}

function normalizeSsid(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.normalize('NFC').trim();

  if (!isValidSsid(normalized)) {
    return null;
  }

  return normalized.length > 0 ? normalized : null;
}

function parseIpconfigSsid(raw: string): string | null {
  const lineMatch = raw.match(/^\s*SSID\s*:\s*(.+)$/m);

  if (lineMatch?.[1]) {
    return normalizeSsid(lineMatch[1]);
  }

  const inlineMatch = raw.match(/\bSSID\s*:\s*([^\n<]+)/);

  return normalizeSsid(inlineMatch?.[1] ?? null);
}

function clearProfilerSsidCache(): void {
  cachedProfilerSsid = null;
}

let cachedProfilerSsid: { value: string | null; fetchedAt: number } | null = null;

const PROFILER_SSID_CACHE_MS = 60_000;

async function getSsidFromSystemProfiler(device: string): Promise<string | null> {
  if (
    cachedProfilerSsid &&
    Date.now() - cachedProfilerSsid.fetchedAt < PROFILER_SSID_CACHE_MS
  ) {
    return cachedProfilerSsid.value;
  }

  try {
    const { stdout } = await execFileAsync('/usr/sbin/system_profiler', [
      'SPAirPortDataType',
      '-json',
    ]);
    const parsed = JSON.parse(stdout) as {
      SPAirPortDataType?: Array<{
        spairport_airport_interfaces?: Array<{
          _name?: string;
          spairport_current_network_information?: {
            _name?: string;
          };
        }>;
      }>;
    };

    const interfaces = parsed.SPAirPortDataType?.[0]?.spairport_airport_interfaces ?? [];
    const activeInterface = interfaces.find((entry) => entry._name === device);
    const ssid = normalizeSsid(
      activeInterface?.spairport_current_network_information?._name ?? null,
    );

    cachedProfilerSsid = { value: ssid, fetchedAt: Date.now() };

    return ssid;
  } catch {
    cachedProfilerSsid = { value: null, fetchedAt: Date.now() };
    return null;
  }
}

async function resolveConnectedWifiNetwork(): Promise<string | null> {
  const wifiDevice = await resolveWifiDeviceName();
  const [networkRaw, interfaceSsid] = await Promise.all([
    runCommand('/usr/sbin/networksetup', ['-getairportnetwork', wifiDevice]).catch(() => ''),
    getWifiConnectedFromInterface(),
  ]);

  const parsed = parseWifiStatus(networkRaw);

  if (parsed.connected && parsed.network) {
    const networksetupSsid = normalizeSsid(parsed.network);

    if (networksetupSsid) {
      return networksetupSsid;
    }
  }

  const interfaceNetwork = normalizeSsid(interfaceSsid);

  if (interfaceNetwork) {
    return interfaceNetwork;
  }

  const ipSummary = await runCommand('/usr/sbin/ipconfig', ['getsummary', wifiDevice]).catch(
    () => '',
  );
  const ssidFromIpconfig = parseIpconfigSsid(ipSummary);

  if (ssidFromIpconfig) {
    return ssidFromIpconfig;
  }

  return getSsidFromSystemProfiler(wifiDevice);
}

export async function getConnectedWifiNetwork(): Promise<string | null> {
  if (process.platform !== 'darwin') {
    return null;
  }

  return resolveConnectedWifiNetwork();
}

export async function getWifiPopupState(): Promise<WifiPopupState> {
  if (process.platform !== 'darwin') {
    return {
      wifiEnabled: false,
      connectedNetwork: null,
      networks: [],
    };
  }

  const wifiEnabled = await getWifiPower();

  if (!wifiEnabled) {
    return {
      wifiEnabled: false,
      connectedNetwork: null,
      networks: [],
    };
  }

  const availableNetworks = await scanAvailableWifiNetworks();
  const activeFromScan = normalizeSsid(
    availableNetworks.find((network) => network.connected)?.ssid ?? null,
  );
  const connectedNetwork = activeFromScan ?? (await resolveConnectedWifiNetwork());

  const networks = availableNetworks
    .map((network) => ({
      ssid: network.ssid,
      connected:
        connectedNetwork !== null && connectedNetwork === normalizeSsid(network.ssid),
      secured: network.secured,
    }))
    .sort((left, right) => {
      if (left.connected && !right.connected) {
        return -1;
      }

      if (!left.connected && right.connected) {
        return 1;
      }

      return left.ssid.localeCompare(right.ssid, 'pt-BR', { sensitivity: 'base' });
    });

  return {
    wifiEnabled,
    connectedNetwork,
    networks,
  };
}

export async function disconnectWifiNetwork(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false;
  }

  return disconnectWifiFromInterface();
}

function parseWifiPower(raw: string): boolean {
  return /\bOn\b/i.test(raw);
}

async function getVolumeStatus(): Promise<{ volume: number; muted: boolean }> {
  const raw = await runCommand('/usr/bin/osascript', ['-e', 'get volume settings']);
  return parseVolumeSettings(raw);
}

async function getBatteryStatus(): Promise<{
  level: number | null;
  charging: boolean;
  present: boolean;
  timeRemaining: string | null;
}> {
  const raw = await runCommand('/usr/bin/pmset', ['-g', 'batt']);
  return parseBatteryStatus(raw);
}

async function getWifiStatus(): Promise<{ connected: boolean; network: string | null }> {
  const wifiDevice = await resolveWifiDeviceName();
  const network = await resolveConnectedWifiNetwork();

  if (network !== null) {
    return { connected: true, network };
  }

  const linkActive = await isWifiInterfaceLinkActive(wifiDevice);

  return {
    connected: linkActive,
    network: null,
  };
}

export async function getSystemStatusSnapshot(): Promise<SystemStatusSnapshot> {
  if (process.platform !== 'darwin') {
    return EMPTY_SNAPSHOT;
  }

  try {
    const [volumeStatus, batteryStatus, wifiStatus] = await Promise.all([
      getVolumeStatus(),
      getBatteryStatus(),
      getWifiStatus(),
    ]);

    return {
      platformSupported: true,
      volume: volumeStatus.volume,
      muted: volumeStatus.muted,
      batteryLevel: batteryStatus.level,
      batteryCharging: batteryStatus.charging,
      batteryPresent: batteryStatus.present,
      batteryTimeRemaining: batteryStatus.timeRemaining,
      wifiConnected: wifiStatus.connected,
      wifiNetwork: wifiStatus.network,
    };
  } catch {
    return {
      ...EMPTY_SNAPSHOT,
      platformSupported: true,
    };
  }
}

export async function setOutputVolume(volume: number): Promise<void> {
  assertDarwinSupported();
  const clamped = Math.min(Math.max(Math.round(volume), 0), 100);
  await runCommand('/usr/bin/osascript', ['-e', `set volume output volume ${clamped}`]);
}

export async function setOutputMuted(muted: boolean): Promise<void> {
  assertDarwinSupported();
  await runCommand('/usr/bin/osascript', ['-e', `set volume output muted ${muted ? 'true' : 'false'}`]);
}

export async function getWifiPower(): Promise<boolean> {
  assertDarwinSupported();
  const wifiDevice = await resolveWifiDeviceName();
  const raw = await runCommand('/usr/sbin/networksetup', ['-getairportpower', wifiDevice]);
  return parseWifiPower(raw);
}

export async function setWifiPower(enabled: boolean): Promise<void> {
  assertDarwinSupported();
  const wifiDevice = await resolveWifiDeviceName();
  await runCommand('/usr/sbin/networksetup', [
    '-setairportpower',
    wifiDevice,
    enabled ? 'on' : 'off',
  ]);
}

export async function listWifiNetworks(): Promise<WifiNetworkItem[]> {
  const state = await getWifiPopupState();
  return state.networks;
}

export async function connectWifiNetwork(
  ssid: string,
  password?: string,
): Promise<WifiConnectResult> {
  assertDarwinSupported();

  const trimmedSsid = ssid.trim();

  if (!trimmedSsid) {
    return { ok: false, error: 'Rede inválida.' };
  }

  const wifiDevice = await resolveWifiDeviceName();
  const args = ['-setairportnetwork', wifiDevice, trimmedSsid];

  if (password?.trim()) {
    args.push(password.trim());
  }

  try {
    await runCommand('/usr/sbin/networksetup', args);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível conectar.';

    if (!password?.trim()) {
      return {
        ok: false,
        error: 'Informe a senha da rede.',
        needsPassword: true,
      };
    }

    return { ok: false, error: message };
  }
}

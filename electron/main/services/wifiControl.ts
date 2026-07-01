import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import type { WifiNetworkItem } from './systemStatus';

const execFileAsync = promisify(execFile);

function resolveSwiftScriptPath(): string {
  const candidates = [
    path.join(process.cwd(), 'resources/shell/macosWifiControl.swift'),
    path.join(app.getAppPath(), 'resources/shell/macosWifiControl.swift'),
    path.join(process.resourcesPath, 'app.asar.unpacked/resources/shell/macosWifiControl.swift'),
    path.join(process.resourcesPath, 'resources/shell/macosWifiControl.swift'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('macosWifiControl.swift not found.');
}

async function runWifiScript(args: string[]): Promise<string> {
  const scriptPath = resolveSwiftScriptPath();
  const { stdout } = await execFileAsync('/usr/bin/swift', [
    '-framework',
    'CoreWLAN',
    scriptPath,
    ...args,
  ]);
  return stdout.trim();
}

function parseScanRows(raw: string): WifiNetworkItem[] {
  const seen = new Set<string>();
  const items: WifiNetworkItem[] = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('error')) {
      continue;
    }

    const [ssid, securedRaw, activeRaw] = trimmed.split('\t');

    if (!ssid || seen.has(ssid)) {
      continue;
    }

    seen.add(ssid);
    items.push({
      ssid,
      connected: activeRaw === '1',
      secured: securedRaw !== '0',
    });
  }

  return items;
}

export async function scanAvailableWifiNetworks(): Promise<WifiNetworkItem[]> {
  if (process.platform !== 'darwin') {
    return [];
  }

  try {
    const raw = await runWifiScript(['scan']);
    return parseScanRows(raw);
  } catch {
    return [];
  }
}

export async function getWifiConnectedFromInterface(): Promise<string | null> {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    const raw = await runWifiScript(['connected']);
    const ssid = raw.trim();

    if (ssid.length === 0 || ssid === '__link_active__') {
      return null;
    }

    return ssid;
  } catch {
    return null;
  }
}

export async function disconnectWifiNetwork(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false;
  }

  try {
    const raw = await runWifiScript(['disconnect']);
    return raw === 'ok';
  } catch {
    return false;
  }
}

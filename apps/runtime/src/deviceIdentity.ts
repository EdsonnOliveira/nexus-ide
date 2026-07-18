import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sanitizeDeviceName } from '@nexus/protocol';

export interface DeviceIdentity {
  deviceId: string;
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}

function identityDir(): string {
  const dir = path.join(os.homedir(), '.nexus', 'runtime');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function identityPath(): string {
  return path.join(identityDir(), 'device.json');
}

export function loadOrCreateDeviceIdentity(): DeviceIdentity {
  const filePath = identityPath();
  if (existsSync(filePath)) {
    return JSON.parse(readFileSync(filePath, 'utf8')) as DeviceIdentity;
  }

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const fingerprint = createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 32);

  const identity: DeviceIdentity = {
    deviceId: randomUUID(),
    publicKey: publicKeyPem,
    privateKey: privateKeyPem,
    fingerprint,
  };

  writeFileSync(filePath, JSON.stringify(identity, null, 2), { mode: 0o600 });
  return identity;
}

export function detectCapabilities(): Record<string, boolean> {
  return {
    terminal: true,
    filesystem: true,
    git: true,
    docker: false,
    ios_simulator: process.platform === 'darwin',
    android_emulator: true,
    xcode: process.platform === 'darwin',
    node: true,
  };
}

export function defaultDeviceName(override?: string | null): string {
  const cleanOverride = sanitizeDeviceName(override);
  if (cleanOverride) {
    return cleanOverride;
  }
  const cleanHostname = sanitizeDeviceName(os.hostname().replace(/\.local$/i, ''));
  return cleanHostname || 'Mac Nexus';
}

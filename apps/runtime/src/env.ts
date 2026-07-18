import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNexusSupabaseUrl } from '@nexus/supabase';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }
  const content = readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = stripEnvValueQuotes(trimmed.slice(eq + 1).trim());
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function stripEnvValueQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function loadRuntimeEnv(): {
  url: string;
  anonKey: string;
  serviceRoleKey: string | null;
  email: string | null;
  password: string | null;
  deviceName: string | null;
  pairingCode: string | null;
  socketPath: string;
} {
  const root = path.resolve(__dirname, '../../..');
  loadEnvFile(path.join(root, '.env.local'));
  loadEnvFile(path.join(root, '.env'));

  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;

  if (!url || !anonKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  }

  assertNexusSupabaseUrl(url);

  return {
    url,
    anonKey,
    serviceRoleKey,
    email: process.env.NEXUS_RUNTIME_EMAIL ?? null,
    password: process.env.NEXUS_RUNTIME_PASSWORD ?? null,
    deviceName: process.env.NEXUS_DEVICE_NAME ?? null,
    pairingCode: process.env.NEXUS_PAIRING_CODE ?? null,
    socketPath:
      process.env.NEXUS_RUNTIME_SOCKET ??
      path.join(process.env.HOME ?? '/tmp', '.nexus-runtime.sock'),
  };
}

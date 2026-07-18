import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncLocalState } from '../apps/runtime/src/syncLocalState';
import {
  defaultDeviceName,
  detectCapabilities,
  loadOrCreateDeviceIdentity,
} from '../apps/runtime/src/deviceIdentity';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
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

loadEnvFile(path.join(root, '.env.local'));
loadEnvFile(path.join(root, '.env'));

const EXPECTED = 'ktmngnpwmgvciutrgqbq';
const url = process.env.VITE_SUPABASE_URL ?? '';
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const email = process.env.NEXUS_RUNTIME_EMAIL ?? '';
const password = process.env.NEXUS_RUNTIME_PASSWORD ?? '';

if (!url.includes(EXPECTED) || !anonKey) {
  console.error('[cloud:sync] invalid Supabase project');
  process.exit(1);
}

if (!email || !password) {
  console.error('[cloud:sync] set NEXUS_RUNTIME_EMAIL and NEXUS_RUNTIME_PASSWORD');
  process.exit(1);
}

const client = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: authData, error: authError } = await client.auth.signInWithPassword({
  email,
  password,
});

if (authError || !authData.user) {
  console.error('[cloud:sync] auth failed', authError?.message);
  process.exit(1);
}

const identity = loadOrCreateDeviceIdentity();
const { data: membership } = await client
  .from('workspace_members')
  .select('workspace_id')
  .limit(1)
  .maybeSingle();

if (!membership?.workspace_id) {
  console.error('[cloud:sync] workspace not found');
  process.exit(1);
}

const { data: existingDevice } = await client
  .from('devices')
  .select('id')
  .eq('id', identity.deviceId)
  .maybeSingle();

if (!existingDevice) {
  const { error } = await client.from('devices').insert({
    id: identity.deviceId,
    workspace_id: membership.workspace_id,
    owner_id: authData.user.id,
    name: defaultDeviceName(process.env.NEXUS_DEVICE_NAME),
    hostname: os.hostname(),
    platform: 'macos',
    architecture: os.arch(),
    runtime_version: '1.0.0',
    status: 'online',
    last_seen_at: new Date().toISOString(),
    is_enabled: true,
    is_default: true,
    capabilities: detectCapabilities(),
  });
  if (error) {
    console.error('[cloud:sync] device insert failed', error.message);
    process.exit(1);
  }
}

console.log('[cloud:sync] starting…');
try {
  const result = await syncLocalState(client, identity.deviceId, authData.user.id);
  console.log('[cloud:sync] done', JSON.stringify(result, null, 2));
} catch (error) {
  console.error('[cloud:sync] failed', error);
  process.exit(1);
}

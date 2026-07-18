import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface NexusAuthStorage {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
}

export interface NexusSupabaseConfig {
  url: string;
  anonKey: string;
  storage?: NexusAuthStorage;
  storageKey?: string;
}

const EXPECTED_PROJECT_REF = 'ktmngnpwmgvciutrgqbq';

export type NexusClient = SupabaseClient;

export function assertNexusSupabaseUrl(url: string): void {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('Invalid Supabase URL');
  }

  if (!host.startsWith(`${EXPECTED_PROJECT_REF}.`)) {
    throw new Error(
      `Refusing to connect: expected Nexus project ${EXPECTED_PROJECT_REF}, got ${host}`,
    );
  }
}

const anonClients = new Map<string, NexusClient>();

export function createNexusSupabaseClient(config: NexusSupabaseConfig): NexusClient {
  assertNexusSupabaseUrl(config.url);
  const storageKey = config.storageKey ?? 'nexus-cloud-auth';
  const cacheKey = `${config.url}::${config.anonKey}::${storageKey}::${config.storage ? 'custom' : 'default'}`;
  const cached = anonClients.get(cacheKey);
  if (cached) {
    return cached;
  }

  const client = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey,
      storage: config.storage,
    },
  });
  anonClients.set(cacheKey, client);
  return client;
}

export function createNexusServiceClient(config: {
  url: string;
  serviceRoleKey: string;
}): NexusClient {
  assertNexusSupabaseUrl(config.url);

  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function getNexusProjectRef(): string {
  return EXPECTED_PROJECT_REF;
}

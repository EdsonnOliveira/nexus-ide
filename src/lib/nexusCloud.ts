import { createElectronBridge } from '@nexus/bridge';
import { createNexusSupabaseClient } from '@nexus/supabase';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isNexusCloudConfigured = Boolean(url && anonKey);

export const cloudSupabase =
  url && anonKey
    ? createNexusSupabaseClient({
        url,
        anonKey,
        storageKey: 'nexus-cloud-electron-auth',
      })
    : null;

export const cloudBridge =
  url && anonKey
    ? createElectronBridge({
        url,
        anonKey,
        storageKey: 'nexus-cloud-electron-auth',
      })
    : null;

import { createNexusSupabaseClient } from '@nexus/supabase';
import { createWebBridge } from '@nexus/bridge';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

export const supabase = createNexusSupabaseClient({
  url,
  anonKey,
  storageKey: 'nexus-cloud-web-auth',
});
export const bridge = createWebBridge({
  url,
  anonKey,
  storageKey: 'nexus-cloud-web-auth',
});

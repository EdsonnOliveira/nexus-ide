import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function invokeSendPush(input: {
  userId: string;
  kind: 'agent' | 'deploy' | 'device';
  title: string;
  body: string;
  dedupeKey?: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const secret = Deno.env.get('NOTIFY_SECRET') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url) {
    return;
  }
  await fetch(`${url}/functions/v1/send-push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceKey}`,
      ...(secret ? { 'x-nexus-notify-secret': secret } : {}),
    },
    body: JSON.stringify(input),
  });
}

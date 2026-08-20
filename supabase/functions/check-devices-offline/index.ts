import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { CORS_HEADERS, jsonResponse } from '../_shared/cors.ts';
import { createServiceClient, invokeSendPush } from '../_shared/supabaseAdmin.ts';

const OFFLINE_AFTER_MS = 5 * 60_000;
const OFFLINE_NOTIFY_MAX_AGE_MS = 30 * 60_000;

function authorizeCron(req: Request): boolean {
  const secret = Deno.env.get('NOTIFY_SECRET') ?? '';
  const headerSecret = req.headers.get('x-nexus-notify-secret') ?? '';
  if (secret && headerSecret === secret) {
    return true;
  }
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return Boolean(serviceRole && token === serviceRole);
}

function presenceDedupeKey(deviceId: string, state: 'online' | 'offline'): string {
  return `device:${deviceId}:${state}`;
}

function shouldNotifyMacOffline(lastSeenAt: string | null | undefined): boolean {
  if (!lastSeenAt) {
    return false;
  }
  const lastSeenMs = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(lastSeenMs)) {
    return false;
  }
  const ageMs = Date.now() - lastSeenMs;
  return ageMs >= OFFLINE_AFTER_MS && ageMs <= OFFLINE_NOTIFY_MAX_AGE_MS;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  if (!authorizeCron(req)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const admin = createServiceClient();
  const cutoff = new Date(Date.now() - OFFLINE_AFTER_MS).toISOString();

  const { data: devices, error } = await admin
    .from('devices')
    .select('id, name, owner_id, workspace_id, status, last_seen_at')
    .eq('status', 'online')
    .lt('last_seen_at', cutoff);

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  let marked = 0;
  let notified = 0;

  for (const device of devices ?? []) {
    const deviceId = String(device.id);
    const ownerId = String(device.owner_id);
    const name = String(device.name || 'Mac');

    const { data: updated, error: updateError } = await admin
      .from('devices')
      .update({ status: 'offline', updated_at: new Date().toISOString() })
      .eq('id', deviceId)
      .eq('status', 'online')
      .select('id');
    if (updateError || !updated?.length) {
      continue;
    }
    marked += 1;

    if (!shouldNotifyMacOffline(device.last_seen_at)) {
      continue;
    }

    const recipientIds = new Set<string>([ownerId]);
    const { data: members } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', device.workspace_id);
    for (const member of members ?? []) {
      recipientIds.add(String(member.user_id));
    }

    for (const userId of recipientIds) {
      const { count } = await admin
        .from('push_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);
      if (!count) {
        continue;
      }
      await invokeSendPush({
        userId,
        kind: 'device',
        title: 'Mac offline',
        body: `${name} ficou offline`,
        dedupeKey: presenceDedupeKey(deviceId, 'offline'),
        clearDedupeKeys: [presenceDedupeKey(deviceId, 'online')],
        data: { deviceId, name },
      });
      notified += 1;
    }
  }

  return jsonResponse({ ok: true, marked, notified });
});

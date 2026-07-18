import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { CORS_HEADERS, jsonResponse } from '../_shared/cors.ts';
import { createServiceClient, invokeSendPush } from '../_shared/supabaseAdmin.ts';

const OFFLINE_AFTER_MS = 45_000;

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

function hourBucket(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  return `${year}${month}${day}${hour}`;
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
  const bucket = hourBucket();

  for (const device of devices ?? []) {
    const deviceId = String(device.id);
    const ownerId = String(device.owner_id);
    const name = String(device.name || 'Mac');

    const { error: updateError } = await admin
      .from('devices')
      .update({ status: 'offline', updated_at: new Date().toISOString() })
      .eq('id', deviceId)
      .eq('status', 'online');
    if (updateError) {
      continue;
    }
    marked += 1;

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
        dedupeKey: `device:${deviceId}:offline:${bucket}`,
        data: { deviceId, name },
      });
      notified += 1;
    }
  }

  return jsonResponse({ ok: true, marked, notified });
});

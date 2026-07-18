import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import webpush from 'npm:web-push@3';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { CORS_HEADERS, jsonResponse } from '../_shared/cors.ts';
import { createServiceClient } from '../_shared/supabaseAdmin.ts';

type PushKind = 'agent' | 'deploy' | 'device';

interface SendPushBody {
  userId?: string;
  kind?: PushKind;
  title?: string;
  body?: string;
  dedupeKey?: string;
  data?: Record<string, unknown>;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

function preferenceColumn(kind: PushKind): 'agent_enabled' | 'deploy_enabled' | 'device_enabled' {
  if (kind === 'deploy') {
    return 'deploy_enabled';
  }
  if (kind === 'device') {
    return 'device_enabled';
  }
  return 'agent_enabled';
}

async function authorize(
  req: Request,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const notifySecret = Deno.env.get('NOTIFY_SECRET') ?? '';
  const headerSecret = req.headers.get('x-nexus-notify-secret') ?? '';
  if (notifySecret && headerSecret && headerSecret === notifySecret) {
    return { ok: true };
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (serviceRole && token === serviceRole) {
    return { ok: true };
  }

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!url || !anon) {
    return { ok: false, status: 500, error: 'Missing Supabase env' };
  }

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error,
  } = await userClient.auth.getUser();
  if (error || !user) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  if (user.id !== userId) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  return { ok: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let body: SendPushBody;
  try {
    body = (await req.json()) as SendPushBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const userId = body.userId?.trim() ?? '';
  const kind = body.kind;
  const title = body.title?.trim() ?? '';
  const message = body.body?.trim() ?? '';
  if (!userId || !kind || !title || !message) {
    return jsonResponse({ error: 'Missing userId, kind, title or body' }, 400);
  }
  if (kind !== 'agent' && kind !== 'deploy' && kind !== 'device') {
    return jsonResponse({ error: 'Invalid kind' }, 400);
  }

  const auth = await authorize(req, userId);
  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.status);
  }

  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY') ?? Deno.env.get('VITE_VAPID_PUBLIC_KEY') ?? '';
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:nexus@localhost';
  if (!vapidPublic || !vapidPrivate) {
    return jsonResponse({ error: 'Missing VAPID keys' }, 500);
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const admin = createServiceClient();
  const prefColumn = preferenceColumn(kind);
  const { data: preferences } = await admin
    .from('push_preferences')
    .select('agent_enabled, deploy_enabled, device_enabled')
    .eq('user_id', userId)
    .maybeSingle();

  const enabled =
    preferences == null
      ? true
      : Boolean((preferences as Record<string, unknown>)[prefColumn] ?? true);
  if (!enabled) {
    return jsonResponse({ ok: true, skipped: 'preference_disabled' });
  }

  const { data: subscriptions, error: subError } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);
  if (subError) {
    return jsonResponse({ error: subError.message }, 500);
  }

  const rows = (subscriptions as SubscriptionRow[] | null) ?? [];
  if (rows.length === 0) {
    return jsonResponse({ ok: true, sent: 0 });
  }

  const dedupeKey = body.dedupeKey?.trim();
  if (dedupeKey) {
    const { data: claimed, error: claimError } = await admin.rpc('claim_push_dedupe', {
      p_user_id: userId,
      p_kind: kind,
      p_dedupe_key: dedupeKey,
    });
    if (claimError) {
      return jsonResponse({ error: claimError.message }, 500);
    }
    if (!claimed) {
      return jsonResponse({ ok: true, skipped: 'dedupe' });
    }
  }

  const payload = JSON.stringify({
    title,
    body: message,
    data: body.data ?? { kind },
  });

  const staleIds: string[] = [];
  const results = await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          payload,
        );
        return true;
      } catch (error) {
        const statusCode =
          error && typeof error === 'object' && 'statusCode' in error
            ? Number((error as { statusCode?: number }).statusCode)
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          staleIds.push(row.id);
        }
        return false;
      }
    }),
  );
  const sent = results.filter(Boolean).length;

  if (staleIds.length > 0) {
    await admin.from('push_subscriptions').delete().in('id', staleIds);
  }

  return jsonResponse({ ok: true, sent, removed: staleIds.length });
});

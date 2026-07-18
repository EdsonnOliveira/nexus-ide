import webpush from 'web-push';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type PushKind = 'agent' | 'deploy' | 'device';

function createServiceClient(): SupabaseClient | null {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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

export async function sendWebPush(input: {
  userId: string;
  kind: PushKind;
  title: string;
  body: string;
  dedupeKey?: string;
  data?: Record<string, unknown>;
}): Promise<{ sent: number; skipped?: string }> {
  const publicKey =
    process.env.VITE_VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY ?? '';
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? '';
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:nexus@localhost';
  if (!publicKey || !privateKey) {
    return { sent: 0, skipped: 'missing_vapid' };
  }

  const admin = createServiceClient();
  if (!admin) {
    return { sent: 0, skipped: 'missing_service_role' };
  }

  const prefColumn = preferenceColumn(input.kind);
  const { data: preferences } = await admin
    .from('push_preferences')
    .select('agent_enabled, deploy_enabled, device_enabled')
    .eq('user_id', input.userId)
    .maybeSingle();

  const enabled =
    preferences == null
      ? true
      : Boolean((preferences as Record<string, unknown>)[prefColumn] ?? true);
  if (!enabled) {
    return { sent: 0, skipped: 'preference_disabled' };
  }

  const { data: subscriptions, error: subError } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', input.userId);
  if (subError) {
    return { sent: 0, skipped: subError.message };
  }

  const rows =
    (subscriptions as Array<{ id: string; endpoint: string; p256dh: string; auth: string }> | null) ??
    [];
  if (rows.length === 0) {
    return { sent: 0, skipped: 'no_subscriptions' };
  }

  if (input.dedupeKey) {
    const { data: claimed, error: claimError } = await admin.rpc('claim_push_dedupe', {
      p_user_id: input.userId,
      p_kind: input.kind,
      p_dedupe_key: input.dedupeKey,
    });
    if (claimError) {
      return { sent: 0, skipped: claimError.message };
    }
    if (!claimed) {
      return { sent: 0, skipped: 'dedupe' };
    }
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const payload = JSON.stringify({
    title: input.title,
    body: input.body,
    data: input.data ?? { kind: input.kind },
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

  if (staleIds.length > 0) {
    await admin.from('push_subscriptions').delete().in('id', staleIds);
  }

  return { sent: results.filter(Boolean).length };
}

export function getServiceSupabaseClient(): SupabaseClient | null {
  return createServiceClient();
}

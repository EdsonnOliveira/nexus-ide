import { sendPushNotification } from '@nexus/supabase';
import { cloudSupabase } from '@/lib/nexusCloud';

export function notifyDeployWebPush(input: {
  provider: 'vercel' | 'render';
  uid: string;
  state: string;
  projectName: string;
  branch: string;
  dedupeKey: string;
}): void {
  void (async () => {
    const client = cloudSupabase;
    if (!client) {
      return;
    }

    try {
      const {
        data: { session },
      } = await client.auth.getSession();
      if (!session?.user?.id) {
        return;
      }

      const failed = input.provider === 'vercel' ? input.state !== 'READY' : input.state !== 'live';
      const platform = input.provider === 'vercel' ? 'Vercel' : 'Render';
      const branch = input.branch.trim() && input.branch.trim() !== '—' ? input.branch.trim() : '';

      await sendPushNotification(client, {
        userId: session.user.id,
        kind: 'deploy',
        title: failed ? `Deploy ${platform} com erro` : `Deploy ${platform} pronto`,
        body: branch ? `${input.projectName} · ${branch}` : input.projectName,
        dedupeKey: input.dedupeKey,
        data: {
          kind: 'deploy',
          provider: input.provider,
          uid: input.uid,
          state: input.state,
        },
      });
    } catch {
      return;
    }
  })();
}

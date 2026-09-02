import { sendPushNotification } from '@nexus/supabase';
import { supabase } from '../lib/supabase';
import { isWebPushSupported } from './webPush';

async function showLocalDeployNotification(title: string, body: string): Promise<void> {
  if (!isWebPushSupported() || Notification.permission !== 'granted') {
    return;
  }
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, {
      body,
      icon: '/nexus-icon-192.png',
      badge: '/nexus-icon-192.png',
      tag: 'nexus-deploy',
    });
  } catch {
    try {
      new Notification(title, { body, tag: 'nexus-deploy' });
    } catch {
      return;
    }
  }
}

export function notifyWebDeployFinished(input: {
  provider: 'vercel' | 'render';
  uid: string;
  state: string;
  projectName: string;
  branch: string;
  userId: string | null;
  dedupeKey: string;
}): void {
  const failed = input.provider === 'vercel' ? input.state !== 'READY' : input.state !== 'live';
  const platform = input.provider === 'vercel' ? 'Vercel' : 'Render';
  const title = failed ? `Deploy ${platform} com erro` : `Deploy ${platform} pronto`;
  const branch = input.branch.trim() && input.branch.trim() !== '—' ? input.branch.trim() : '';
  const body = branch ? `${input.projectName} · ${branch}` : input.projectName;

  void showLocalDeployNotification(title, body);

  if (!input.userId) {
    return;
  }

  void sendPushNotification(supabase, {
    userId: input.userId,
    kind: 'deploy',
    title,
    body,
    dedupeKey: input.dedupeKey,
    data: {
      kind: 'deploy',
      provider: input.provider,
      uid: input.uid,
      state: input.state,
    },
  }).catch(() => undefined);
}

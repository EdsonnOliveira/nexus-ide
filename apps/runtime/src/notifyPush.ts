import { sendWebPush } from './webPushSend';

export async function notifyPush(input: {
  userId: string;
  kind: 'agent' | 'deploy' | 'device';
  title: string;
  body: string;
  dedupeKey?: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  try {
    await sendWebPush(input);
  } catch {
  }
}

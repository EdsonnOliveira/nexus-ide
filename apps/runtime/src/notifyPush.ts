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
    const result = await sendWebPush(input);
    if (result.sent === 0) {
      console.warn(
        `[nexus-runtime] push skipped kind=${input.kind} user=${input.userId} reason=${result.skipped ?? 'none_sent'}`,
      );
    } else {
      console.log(`[nexus-runtime] push sent=${result.sent} kind=${input.kind} user=${input.userId}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[nexus-runtime] push failed kind=${input.kind} user=${input.userId}`, message);
  }
}

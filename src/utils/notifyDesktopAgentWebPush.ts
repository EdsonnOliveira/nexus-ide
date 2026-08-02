import { sendPushNotification } from '@nexus/supabase';
import { cloudSupabase } from '@/lib/nexusCloud';
import { useProjectStore } from '@/stores/useProjectStore';

export function notifyDesktopAgentWebPush(projectId: string, paneId: string): void {
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

      const project = useProjectStore.getState().projects.find((item) => item.id === projectId);
      const projectName = project?.name?.trim() || 'Projeto';

      await sendPushNotification(client, {
        userId: session.user.id,
        kind: 'agent',
        title: 'Agent concluiu',
        body: projectName,
        dedupeKey: `agent:desktop:${paneId}:${Math.floor(Date.now() / 2000)}`,
        data: {
          projectId,
          paneId,
          status: 'completed',
          source: 'desktop',
        },
      });
    } catch {
      return;
    }
  })();
}

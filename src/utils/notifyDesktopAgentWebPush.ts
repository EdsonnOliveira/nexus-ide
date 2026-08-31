import { collectProjectPanes } from '@/utils/tabGroups';
import { sendPushNotification } from '@nexus/supabase';
import { cloudSupabase } from '@/lib/nexusCloud';
import { useProjectStore } from '@/stores/useProjectStore';

function findLastAgentTurnId(paneId: string): string | null {
  for (const project of useProjectStore.getState().projects) {
    for (const pane of collectProjectPanes(project.tabs)) {
      if (pane.id !== paneId || pane.type !== 'agent') {
        continue;
      }
      const last = pane.turns[pane.turns.length - 1];
      return last?.id ?? null;
    }
  }
  return null;
}

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
      const turnId = findLastAgentTurnId(paneId);

      await sendPushNotification(client, {
        userId: session.user.id,
        kind: 'agent',
        title: 'Agent concluiu',
        body: projectName,
        dedupeKey: `agent:${turnId ?? paneId}:completed`,
        data: {
          kind: 'agent',
          projectId,
          paneId,
          executionId: turnId,
          status: 'completed',
          source: 'desktop',
        },
      });
    } catch {
      return;
    }
  })();
}

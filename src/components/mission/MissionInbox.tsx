import { memo, useCallback, useMemo } from 'react';
import { Bell, Check, X } from 'lucide-react';
import { EmptyState } from '@/components/overlay/EmptyState';
import { useMissionStore } from '@/stores/useMissionStore';
import { startMission } from '@/utils/missionOrchestrator';
import { useTabActions } from '@/stores/useTabStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { resolveAgentLaunchCommand } from '@/utils/resolveAgentLaunchCommand';

interface MissionInboxProps {
  onOpenMission: (missionId: string) => void;
}

function MissionInboxComponent({ onOpenMission }: MissionInboxProps) {
  const inbox = useMissionStore((state) => state.inbox);
  const missions = useMissionStore((state) => state.missions);
  const upsertInboxItem = useMissionStore((state) => state.upsertInboxItem);
  const upsertNode = useMissionStore((state) => state.upsertNode);
  const { addAgentTabForProject } = useTabActions();
  const projects = useProjectStore((state) => state.projects);

  const openItems = useMemo(
    () => inbox.filter((item) => !item.resolvedAt),
    [inbox],
  );

  const resolveItem = useCallback(
    async (itemId: string, actionId: string) => {
      const item = openItems.find((entry) => entry.id === itemId);

      if (!item) {
        return;
      }

      const mission = missions.find((entry) => entry.id === item.missionId);
      const node = item.nodeId
        ? mission?.nodes.find((entry) => entry.id === item.nodeId)
        : null;

      await upsertInboxItem(item.missionId, {
        ...item,
        resolvedAt: new Date().toISOString(),
      });

      if (!mission || !node) {
        return;
      }

      if (actionId === 'approve') {
        if (node.kind === 'automation') {
          await upsertNode(mission.id, {
            ...node,
            status: 'completed',
            progress: 100,
            completedAt: new Date().toISOString(),
            automation: node.automation
              ? {
                  ...node.automation,
                  output: {
                    ...(node.automation.output ?? {}),
                    approved: true,
                  },
                }
              : node.automation,
          });
        } else {
          await upsertNode(mission.id, { ...node, status: 'waiting' });
        }
        await startMission({
          missionId: mission.id,
          addAgentTabForProject: async (projectId, command) => {
            if (command?.trim()) {
              return addAgentTabForProject(projectId, command);
            }
            const project = projects.find((entry) => entry.id === projectId);
            if (!project) {
              return null;
            }
            const resolved = await resolveAgentLaunchCommand(project.path);
            return addAgentTabForProject(projectId, resolved);
          },
        });
        return;
      }

      if (actionId === 'reject') {
        await upsertNode(mission.id, {
          ...node,
          status: 'cancelled',
          lastError: 'Rejeitado pelo usuário',
        });
      }
    },
    [addAgentTabForProject, missions, openItems, projects, upsertInboxItem, upsertNode],
  );

  if (openItems.length === 0) {
    return null;
  }

  return (
    <div className='mission-inbox app-button--enter'>
      <div className='mission-inbox__header'>
        <Bell size={14} strokeWidth={2.25} aria-hidden='true' />
        <span>Precisa de você ({openItems.length})</span>
      </div>
      <ul className='mission-inbox__list'>
        {openItems.map((item) => (
          <li key={item.id} className='mission-inbox__item'>
            <button
              type='button'
              className='mission-inbox__title app-button'
              onClick={() => onOpenMission(item.missionId)}
            >
              {item.title}
            </button>
            <p className='mission-inbox__message'>{item.message}</p>
            <div className='mission-inbox__actions'>
              {(item.actions ?? []).map((action) => (
                <button
                  key={action.id}
                  type='button'
                  className={`project-dialog__btn app-button${
                    action.id === 'approve' ? ' project-dialog__btn--primary' : ''
                  }`}
                  onClick={() => {
                    void resolveItem(item.id, action.id);
                  }}
                >
                  {action.id === 'approve' ? (
                    <Check size={13} />
                  ) : action.id === 'reject' ? (
                    <X size={13} />
                  ) : null}
                  {action.label}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const MissionInbox = memo(MissionInboxComponent);

export function MissionInboxEmptyHint() {
  return (
    <EmptyState icon={Bell} message='Nenhuma pendência da missão' compact />
  );
}

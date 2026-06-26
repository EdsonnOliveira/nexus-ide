import { memo, useCallback } from 'react';
import { useProjectStore } from '@/stores/useProjectStore';
import {
  useAgentGitChangeStore,
  useAgentGitGroupsForProject,
} from '@/stores/useAgentGitChangeStore';

interface AgentGitChangePillProps {
  projectId: string;
  paneId: string;
}

function formatPillLabel(fileCount: number, additions: number, deletions: number): string {
  const fileLabel =
    fileCount === 1 ? '1 arquivo alterado' : `${fileCount} arquivos alterados`;

  return `${fileLabel} +${additions} -${deletions}`;
}

function AgentGitChangePillComponent({ projectId, paneId }: AgentGitChangePillProps) {
  const groups = useAgentGitGroupsForProject(projectId);
  const group =
    groups.find((entry) => entry.paneId === paneId && entry.files.length > 0) ?? null;
  const setSidePanel = useProjectStore((state) => state.setSidePanel);
  const setFocusedGroupId = useAgentGitChangeStore((state) => state.setFocusedGroupId);

  const handleClick = useCallback(() => {
    if (!group) {
      return;
    }

    setFocusedGroupId(group.id);
    setSidePanel('git');
  }, [group, setFocusedGroupId, setSidePanel]);

  if (!group || group.files.length === 0) {
    return null;
  }

  return (
    <button
      type='button'
      className='agent-git-change-pill app-button app-button--enter'
      onClick={handleClick}
      aria-label={formatPillLabel(group.files.length, group.additions, group.deletions)}
    >
      <span className='agent-git-change-pill__label'>
        {group.files.length === 1 ? '1 arquivo alterado' : `${group.files.length} arquivos alterados`}
      </span>
      <span className='agent-git-change-pill__stats'>
        <span className='agent-git-change-pill__add'>+{group.additions}</span>
        <span className='agent-git-change-pill__del'>-{group.deletions}</span>
      </span>
    </button>
  );
}

export const AgentGitChangePill = memo(AgentGitChangePillComponent);

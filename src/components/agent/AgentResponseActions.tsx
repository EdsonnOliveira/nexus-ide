import { memo, useCallback, useMemo } from 'react';
import { AgentProjectSkillPills } from '@/components/agent/AgentProjectSkillPills';
import { AgentResponseCopyPill } from '@/components/agent/AgentResponseCopyPill';
import { useProjectStore } from '@/stores/useProjectStore';
import {
  useAgentGitChangeStore,
  useAgentGitGroupsForProject,
} from '@/stores/useAgentGitChangeStore';
import type { AgentTurnSummary } from '@/types';
import type { AgentGitChangeGroup } from '@/types/agentGit';

interface AgentResponseActionsProps {
  projectId: string;
  projectPath: string;
  paneId: string;
  content: string;
  summary?: AgentTurnSummary;
  showSkillPills?: boolean;
  showCopyPill?: boolean;
}

function findGroupForTurn(
  groups: AgentGitChangeGroup[],
  paneId: string,
  summary?: AgentTurnSummary,
): AgentGitChangeGroup | null {
  const withFiles = groups.filter((entry) => entry.files.length > 0);
  const paneGroups = withFiles.filter((entry) => entry.paneId === paneId);
  const candidates = paneGroups.length > 0 ? paneGroups : withFiles;

  if (candidates.length === 0) {
    return null;
  }

  const editedPaths = summary?.editedFiles?.map((file) => file.path) ?? [];

  if (editedPaths.length > 0) {
    const matched = candidates.find((group) => {
      const groupPaths = new Set(group.files.map((file) => file.path));

      return editedPaths.some((path) => groupPaths.has(path));
    });

    if (matched) {
      return matched;
    }
  }

  if (summary) {
    const matched = candidates.find(
      (group) => group.additions === summary.additions && group.deletions === summary.deletions,
    );

    if (matched) {
      return matched;
    }
  }

  return candidates[0] ?? null;
}

function AgentResponseChangesPill({
  additions,
  deletions,
  onClick,
}: {
  additions: number;
  deletions: number;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      className='agent-view__response-pill agent-view__response-changes app-button app-button--enter'
      aria-label={`Ver alterações +${additions} -${deletions}`}
      onClick={onClick}
    >
      <span className='agent-view__response-pill-label'>Alterações</span>
      {additions > 0 ? (
        <span className='agent-view__response-changes-add'>+{additions}</span>
      ) : null}
      {deletions > 0 ? (
        <span className='agent-view__response-changes-del'>-{deletions}</span>
      ) : null}
    </button>
  );
}

function AgentResponseActionsComponent({
  projectId,
  projectPath,
  paneId,
  content,
  summary,
  showSkillPills = false,
  showCopyPill = true,
}: AgentResponseActionsProps) {
  const groups = useAgentGitGroupsForProject(projectId);
  const openExplorerGit = useProjectStore((state) => state.openExplorerGit);
  const setFocusedGroupId = useAgentGitChangeStore((state) => state.setFocusedGroupId);
  const showChangesPill = Boolean(summary && (summary.additions > 0 || summary.deletions > 0));

  const matchedGroup = useMemo(
    () => (showChangesPill ? findGroupForTurn(groups, paneId, summary) : null),
    [groups, paneId, showChangesPill, summary],
  );

  const handleOpenChanges = useCallback(() => {
    if (matchedGroup) {
      setFocusedGroupId(matchedGroup.id);
    }

    openExplorerGit();
  }, [matchedGroup, openExplorerGit, setFocusedGroupId]);

  return (
    <div
      className={`agent-view__response-actions${showSkillPills ? '' : ' agent-view__response-actions--copy-only'}${showChangesPill ? ' agent-view__response-actions--with-changes' : ''}`}
    >
      {showChangesPill && summary ? (
        <AgentResponseChangesPill
          additions={summary.additions}
          deletions={summary.deletions}
          onClick={handleOpenChanges}
        />
      ) : null}
      <div className='agent-view__response-actions-trailing'>
        {showSkillPills ? (
          <AgentProjectSkillPills
            projectId={projectId}
            projectPath={projectPath}
            paneId={paneId}
            responseContent={content}
          />
        ) : null}
        {showCopyPill ? <AgentResponseCopyPill content={content} /> : null}
      </div>
    </div>
  );
}

export const AgentResponseActions = memo(AgentResponseActionsComponent);

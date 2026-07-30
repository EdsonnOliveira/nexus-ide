import { memo, useCallback, useMemo } from 'react';
import { AgentProjectSkillPills } from '@/components/agent/AgentProjectSkillPills';
import { AgentResponseCopyPill } from '@/components/agent/AgentResponseCopyPill';
import { AgentResponseGitCommitPill } from '@/components/agent/AgentResponseGitCommitPill';
import { AgentFilesChangedCard } from '@/components/agent/AgentFilesChangedCard';
import { useProjectStore } from '@/stores/useProjectStore';
import {
  useAgentGitChangeStore,
  useAgentGitGroupsForProject,
} from '@/stores/useAgentGitChangeStore';
import type { AgentTurnSummary, AgentTurnSummaryFileRef } from '@/types';
import type { AgentGitChangeGroup } from '@/types/agentGit';

interface AgentResponseActionsProps {
  projectId: string;
  projectPath: string;
  paneId: string;
  content: string;
  summary?: AgentTurnSummary;
  editedFiles?: AgentTurnSummaryFileRef[];
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

function buildFallbackCommitGroup(
  projectId: string,
  paneId: string,
  summary: AgentTurnSummary,
  content: string,
): AgentGitChangeGroup {
  return {
    id: `agent-commit-${paneId}-${summary.additions}-${summary.deletions}`,
    paneId,
    projectId,
    prompt: content.trim() || 'Alterações do agent',
    files: (summary.editedFiles ?? []).map((file) => ({
      path: file.path,
      status: 'modified',
      staged: false,
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
    })),
    additions: summary.additions,
    deletions: summary.deletions,
    completedAt: Date.now(),
  };
}

function resolveFilesForCard(
  summary: AgentTurnSummary | undefined,
  matchedGroup: AgentGitChangeGroup | null,
  editedFiles?: AgentTurnSummaryFileRef[],
): AgentTurnSummaryFileRef[] {
  if (editedFiles && editedFiles.length > 0) {
    return editedFiles;
  }

  if (summary?.editedFiles && summary.editedFiles.length > 0) {
    return summary.editedFiles;
  }

  if (matchedGroup && matchedGroup.files.length > 0) {
    return matchedGroup.files.map((file) => ({
      path: file.path,
      ...(file.additions > 0 ? { additions: file.additions } : {}),
      ...(file.deletions > 0 ? { deletions: file.deletions } : {}),
    }));
  }

  return [];
}

function AgentResponseActionsComponent({
  projectId,
  projectPath,
  paneId,
  content,
  summary,
  editedFiles,
  showSkillPills = false,
  showCopyPill = true,
}: AgentResponseActionsProps) {
  const groups = useAgentGitGroupsForProject(projectId);
  const openExplorerGit = useProjectStore((state) => state.openExplorerGit);
  const setFocusedGroupId = useAgentGitChangeStore((state) => state.setFocusedGroupId);

  const matchedGroup = useMemo(
    () => findGroupForTurn(groups, paneId, summary),
    [groups, paneId, summary],
  );

  const filesForCard = useMemo(
    () => resolveFilesForCard(summary, matchedGroup, editedFiles),
    [editedFiles, matchedGroup, summary],
  );

  const showFilesCard = filesForCard.length > 0;
  const showCommitPill = Boolean(
    summary && (summary.additions > 0 || summary.deletions > 0 || showFilesCard),
  );

  const commitGroup = useMemo(() => {
    if (!showCommitPill || !summary) {
      return null;
    }

    return matchedGroup ?? buildFallbackCommitGroup(projectId, paneId, summary, content);
  }, [content, matchedGroup, paneId, projectId, showCommitPill, summary]);

  const handleOpenChanges = useCallback(() => {
    if (matchedGroup) {
      setFocusedGroupId(matchedGroup.id);
    }

    openExplorerGit();
  }, [matchedGroup, openExplorerGit, setFocusedGroupId]);

  if (!showFilesCard && !showCommitPill && !showSkillPills && !showCopyPill) {
    return null;
  }

  return (
    <div
      className={`agent-view__response-actions-block${showFilesCard ? ' agent-view__response-actions-block--with-files' : ''}`}
    >
      {showFilesCard ? (
        <AgentFilesChangedCard
          files={filesForCard}
          projectPath={projectPath}
          onReview={handleOpenChanges}
        />
      ) : null}
      <div
        className={`agent-view__response-actions${showSkillPills ? '' : ' agent-view__response-actions--copy-only'}${showCommitPill ? ' agent-view__response-actions--with-changes' : ''}`}
      >
        {showCommitPill && summary && commitGroup ? (
          <div
            className={`agent-view__response-actions-leading${showSkillPills ? ' agent-view__response-actions-leading--always-visible' : ''}`}
          >
            <AgentResponseGitCommitPill
              projectPath={projectPath}
              paneId={paneId}
              group={commitGroup}
            />
          </div>
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
    </div>
  );
}

export const AgentResponseActions = memo(AgentResponseActionsComponent);

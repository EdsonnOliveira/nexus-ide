import { memo, useCallback, useMemo } from 'react';
import { ExplorerFileIcon } from '@/components/explorer/ExplorerTreeIcon';
import { useTabActions } from '@/stores/useTabStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { AgentTurnSummaryFileRef } from '@/types';
import { resolveAgentActivityFilePath } from '@/utils/agentTranscriptParser';
import { buildFlatChanges } from '@/utils/gitFlatChanges';
import {
  findGitFlatChangeByPath,
  resolveGitRepoPathForFile,
  toGitRelativePath,
} from '@/utils/gitPaths';

export interface AgentFilesChangedCardProps {
  files: AgentTurnSummaryFileRef[];
  projectPath: string;
  onReview: () => void;
}

function getFileName(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.split('/').pop() ?? path;
}

function AgentFilesChangedCardComponent({
  files,
  projectPath,
  onReview,
}: AgentFilesChangedCardProps) {
  const { openDiffTab } = useTabActions();
  const openExplorerGit = useProjectStore((state) => state.openExplorerGit);

  const visibleFiles = useMemo(
    () => files.filter((file) => file.path.trim()),
    [files],
  );

  const handleOpenFile = useCallback(
    async (filePath: string) => {
      const trimmed = filePath.trim();

      if (!trimmed) {
        return;
      }

      openExplorerGit();
      const absolutePath = resolveAgentActivityFilePath(projectPath, trimmed);
      const diffTargetPath = absolutePath || trimmed;

      if (!diffTargetPath) {
        return;
      }

      const repoPath = await resolveGitRepoPathForFile(projectPath, diffTargetPath);

      let staged = false;
      let untracked = false;

      let openPath = diffTargetPath;
      const fileName = getFileName(diffTargetPath);

      try {
        const status = await window.nexus.git.getStatus(repoPath);
        const relativePath = toGitRelativePath(repoPath, diffTargetPath);
        const change =
          findGitFlatChangeByPath(buildFlatChanges(status), relativePath) ??
          findGitFlatChangeByPath(buildFlatChanges(status), fileName);

        if (change) {
          staged = change.staged;
          untracked = change.status === 'untracked';
          openPath = change.path;
        }
      } catch {
        staged = false;
        untracked = false;
      }

      void openDiffTab(openPath, {
        staged,
        untracked,
        repoPath,
      });
    },
    [openDiffTab, openExplorerGit, projectPath],
  );

  if (visibleFiles.length === 0) {
    return null;
  }

  const countLabel = `${visibleFiles.length} File${visibleFiles.length === 1 ? '' : 's'} Changed`;

  return (
    <div className='agent-view__files-changed app-button--enter'>
      <div className='agent-view__files-changed-header'>
        <span className='agent-view__files-changed-title'>{countLabel}</span>
        <button
          type='button'
          className='agent-view__files-changed-review app-button'
          onClick={onReview}
        >
          Review
        </button>
      </div>
      <div className='agent-view__files-changed-list'>
        {visibleFiles.map((file) => {
          const fileName = getFileName(file.path);
          const additions = file.additions ?? 0;
          const deletions = file.deletions ?? 0;

          return (
            <button
              key={file.path}
              type='button'
              className='agent-view__files-changed-row app-button'
              title={file.path}
              onClick={() => {
                void handleOpenFile(file.path);
              }}
            >
              <span className='agent-view__files-changed-icon' aria-hidden='true'>
                <ExplorerFileIcon name={fileName} />
              </span>
              <span className='agent-view__files-changed-name'>{fileName}</span>
              <span className='agent-view__files-changed-diff'>
                {additions > 0 ? (
                  <span className='agent-view__files-changed-add'>+{additions}</span>
                ) : null}
                {deletions > 0 ? (
                  <span className='agent-view__files-changed-del'>-{deletions}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const AgentFilesChangedCard = memo(AgentFilesChangedCardComponent);

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTabActions } from '@/stores/useTabStore';
import type { AgentActivity, AgentTurnSummaryCommandRef } from '@/types';
import { resolveAgentActivityFilePath } from '@/utils/agentTranscriptParser';
import { buildFlatChanges } from '@/utils/gitFlatChanges';
import { findGitFlatChangeByPath, toGitRelativePath } from '@/utils/gitPaths';

export const AGENT_FILE_ACTIVITY_VISIBLE_ROWS = 5;

interface AgentFileActivityRowProps {
  activity: AgentActivity;
  projectPath: string;
  verbOverride?: string;
  live?: boolean;
}

interface AgentFileActivityScrollListProps {
  activities: AgentActivity[];
  projectPath: string;
  live?: boolean;
  stickToBottom?: boolean;
}

function AgentFileActivityRowComponent({
  activity,
  projectPath,
  verbOverride,
  live = false,
}: AgentFileActivityRowProps) {
  const { openFileTab, openDiffTab } = useTabActions();
  const openExplorerGit = useProjectStore((state) => state.openExplorerGit);
  const filePath = activity.filePath?.trim() ?? '';
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
  const absolutePath = useMemo(
    () => (filePath ? resolveAgentActivityFilePath(projectPath, filePath) : null),
    [filePath, projectPath],
  );
  const verb =
    verbOverride ?? (activity.kind === 'file_read' ? 'Read' : 'Edited');
  const showDiff = activity.kind === 'file_edit' && !live;
  const isEdited = activity.kind === 'file_edit';

  const handleOpenFile = useCallback(async () => {
    if (!absolutePath || !fileName) {
      return;
    }

    if (isEdited) {
      openExplorerGit();
      const relativePath = toGitRelativePath(projectPath, absolutePath);
      let staged = false;
      let untracked = false;

      try {
        const status = await window.nexus.git.getStatus(projectPath);
        const change = findGitFlatChangeByPath(buildFlatChanges(status), relativePath);

        if (change) {
          staged = change.staged;
          untracked = change.status === 'untracked';
        }
      } catch {
        staged = false;
        untracked = false;
      }

      void openDiffTab(absolutePath, {
        staged,
        untracked,
        repoPath: projectPath,
      });
      return;
    }

    void openFileTab(absolutePath, fileName);
  }, [
    absolutePath,
    fileName,
    isEdited,
    openDiffTab,
    openExplorerGit,
    openFileTab,
    projectPath,
  ]);

  return (
    <div
      className={`agent-view__file-row app-button--enter${live ? ' agent-view__file-row--live' : ''}`}
    >
      <span className='agent-view__file-verb'>{verb}</span>
      {fileName ? (
        absolutePath ? (
          <button
            type='button'
            className='agent-view__file-name-btn app-button'
            aria-label={isEdited ? `Ver alterações de ${fileName}` : `Abrir ${fileName}`}
            onClick={handleOpenFile}
          >
            {fileName}
          </button>
        ) : (
          <span className='agent-view__file-name'>{fileName}</span>
        )
      ) : null}
      {showDiff ? (
        <span className='agent-view__file-diff'>
          {activity.additions !== undefined && activity.additions > 0 ? (
            <span className='agent-view__diff agent-view__diff--add'>+{activity.additions}</span>
          ) : null}
          {activity.deletions !== undefined && activity.deletions > 0 ? (
            <span className='agent-view__diff agent-view__diff--del'>-{activity.deletions}</span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

export const AgentFileActivityRow = memo(AgentFileActivityRowComponent);

function AgentFileActivityScrollListComponent({
  activities,
  projectPath,
  live = false,
  stickToBottom = false,
}: AgentFileActivityScrollListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const scrollable = activities.length > AGENT_FILE_ACTIVITY_VISIBLE_ROWS;

  useEffect(() => {
    if (!stickToBottom || !scrollable || !listRef.current) {
      return;
    }

    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [activities, scrollable, stickToBottom]);

  if (activities.length === 0) {
    return null;
  }

  return (
    <div
      ref={listRef}
      className={`agent-view__file-list app-button--enter${scrollable ? ' agent-view__file-list--scrollable' : ''}`}
    >
      {activities.map((activity) => (
        <AgentFileActivityRow
          key={activity.id}
          activity={activity}
          projectPath={projectPath}
          live={live}
        />
      ))}
    </div>
  );
}

export const AgentFileActivityScrollList = memo(AgentFileActivityScrollListComponent);

interface AgentCommandActivityRowProps {
  command: string;
}

function AgentCommandActivityRowComponent({ command }: AgentCommandActivityRowProps) {
  const displayCommand = command.length > 96 ? `${command.slice(0, 93)}…` : command;

  return (
    <div className='agent-view__file-row app-button--enter'>
      <span className='agent-view__file-verb'>Run</span>
      <span className='agent-view__file-name' title={command}>
        {displayCommand}
      </span>
    </div>
  );
}

const AgentCommandActivityRow = memo(AgentCommandActivityRowComponent);

interface AgentCommandActivityScrollListProps {
  commands: AgentTurnSummaryCommandRef[];
}

function AgentCommandActivityScrollListComponent({ commands }: AgentCommandActivityScrollListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const scrollable = commands.length > AGENT_FILE_ACTIVITY_VISIBLE_ROWS;

  if (commands.length === 0) {
    return null;
  }

  return (
    <div
      ref={listRef}
      className={`agent-view__file-list app-button--enter${scrollable ? ' agent-view__file-list--scrollable' : ''}`}
    >
      {commands.map((entry, index) => (
        <AgentCommandActivityRow key={`${entry.command}-${index}`} command={entry.command} />
      ))}
    </div>
  );
}

export const AgentCommandActivityScrollList = memo(AgentCommandActivityScrollListComponent);

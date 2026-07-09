import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTabActions } from '@/stores/useTabStore';
import type { AgentActivity, AgentTurnSummaryCommandRef } from '@/types';
import {
  buildLiveToolBatchSummary,
  findLiveToolBatchDetailActivity,
  shouldShowLiveToolBatchDetail,
} from '@/utils/agentTurnSummary';
import { parseAgentLiveFileStatus } from '@/utils/agentActivityLabel';
import { resolveAgentActivityFilePath } from '@/utils/agentTranscriptParser';
import { buildFlatChanges } from '@/utils/gitFlatChanges';
import {
  findGitFlatChangeByPath,
  resolveGitRepoPathForFile,
  toGitRelativePath,
} from '@/utils/gitPaths';

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
    if (!fileName) {
      return;
    }

    if (isEdited) {
      openExplorerGit();
      const repoPath = await resolveGitRepoPathForFile(projectPath, filePath || absolutePath || fileName);
      const diffTargetPath = filePath || absolutePath;

      if (!diffTargetPath) {
        return;
      }

      let staged = false;
      let untracked = false;

      try {
        const status = await window.nexus.git.getStatus(repoPath);
        const relativePath = toGitRelativePath(repoPath, diffTargetPath);
        const change = findGitFlatChangeByPath(buildFlatChanges(status), relativePath);

        if (change) {
          staged = change.staged;
          untracked = change.status === 'untracked';
        }
      } catch {
        staged = false;
        untracked = false;
      }

      void openDiffTab(diffTargetPath, {
        staged,
        untracked,
        repoPath,
      });
      return;
    }

    if (!absolutePath) {
      return;
    }

    void openFileTab(absolutePath, fileName);
  }, [
    absolutePath,
    fileName,
    filePath,
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

interface AgentToolActivityScrollListProps {
  activities: AgentActivity[];
  projectPath: string;
  running?: boolean;
}

function renderAgentToolActivityRow(
  activity: AgentActivity,
  projectPath: string,
  running: boolean,
): ReactNode {
  if (activity.kind === 'file_edit' || activity.kind === 'file_read') {
    return (
      <AgentFileActivityRow
        key={activity.id}
        activity={activity}
        projectPath={projectPath}
        live={running}
      />
    );
  }

  if (activity.kind === 'tool_run') {
    const liveFileStatus = parseAgentLiveFileStatus(activity.label);

    if (liveFileStatus || activity.filePath?.trim()) {
      return (
        <AgentFileActivityRow
          key={activity.id}
          activity={{
            ...activity,
            kind: 'file_edit',
            filePath: liveFileStatus?.fileName ?? activity.filePath,
          }}
          projectPath={projectPath}
          verbOverride={liveFileStatus?.verb ?? activity.label.split(' ')[0]}
          live={Boolean(activity.streaming)}
        />
      );
    }

    return <AgentToolRunRow key={activity.id} activity={activity} />;
  }

  if (activity.kind === 'live_status') {
    const liveFileStatus = parseAgentLiveFileStatus(activity.label);

    if (liveFileStatus) {
      return (
        <AgentFileActivityRow
          key={activity.id}
          activity={{
            ...activity,
            kind: 'file_edit',
            filePath: liveFileStatus.fileName,
          }}
          projectPath={projectPath}
          verbOverride={liveFileStatus.verb}
          live
        />
      );
    }

    return (
      <div
        key={activity.id}
        className='agent-view__file-row agent-view__file-row--live app-button--enter'
      >
        <span className='agent-view__file-verb'>{activity.label.trim()}</span>
      </div>
    );
  }

  if (activity.kind === 'status' && /^Ran\b/i.test(activity.label.trim())) {
    const command = activity.label.trim().replace(/^Ran\s+/i, '').trim();

    return (
      <div key={activity.id} className='agent-view__file-row app-button--enter'>
        <span className='agent-view__file-verb'>Run</span>
        <span className='agent-view__file-name' title={command}>
          {command.length > 96 ? `${command.slice(0, 93)}…` : command}
        </span>
      </div>
    );
  }

  return null;
}

function AgentToolActivityScrollListComponent({
  activities,
  projectPath,
  running = false,
}: AgentToolActivityScrollListProps) {
  if (activities.length === 0) {
    return null;
  }

  if (running) {
    const summary = buildLiveToolBatchSummary(activities, true);
    const detail = findLiveToolBatchDetailActivity(activities);
    const showDetail = shouldShowLiveToolBatchDetail(detail, summary);
    const detailRow =
      showDetail && detail
        ? renderAgentToolActivityRow(detail, projectPath, true)
        : null;

    if (!summary && !detailRow) {
      return null;
    }

    return (
      <div className='agent-view__tool-batch app-button--enter'>
        {summary ? (
          <div className='agent-view__status-line agent-view__status-line--batch'>{summary}</div>
        ) : null}
        {detailRow}
      </div>
    );
  }

  return (
    <div className='agent-view__file-list agent-view__file-list--inline app-button--enter'>
      {activities.map((activity) => renderAgentToolActivityRow(activity, projectPath, running))}
    </div>
  );
}

export const AgentToolActivityScrollList = memo(AgentToolActivityScrollListComponent);

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

interface AgentToolRunRowProps {
  activity: AgentActivity;
}

function AgentToolRunRowComponent({ activity }: AgentToolRunRowProps) {
  const live = Boolean(activity.streaming);
  const command = activity.toolCommand?.trim() ?? '';
  const output = activity.toolOutput?.trim() ?? '';
  const verb = live ? 'Running' : 'Run';
  const displayCommand =
    command.length > 120 ? `${command.slice(0, 117)}…` : command || activity.label.trim();
  const [outputExpanded, setOutputExpanded] = useState(false);
  const hasOutput = output.length > 0;

  const handleToggleOutput = useCallback(() => {
    setOutputExpanded((prev) => !prev);
  }, []);

  return (
    <div
      className={`agent-view__tool-run app-button--enter${live ? ' agent-view__tool-run--live' : ''}`}
    >
      <div className={`agent-view__file-row${live ? ' agent-view__file-row--live' : ''}`}>
        <span className='agent-view__file-verb'>{verb}</span>
        <span className='agent-view__file-name' title={command || activity.label}>
          {displayCommand}
        </span>
      </div>
      {hasOutput && !live ? (
        <button
          type='button'
          className='agent-view__tool-run-toggle app-button app-button--enter'
          onClick={handleToggleOutput}
        >
          {outputExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span>Saída do comando</span>
        </button>
      ) : null}
      {hasOutput && outputExpanded ? (
        <pre className='agent-view__tool-run-output app-button--enter'>{output}</pre>
      ) : null}
    </div>
  );
}

export const AgentToolRunRow = memo(AgentToolRunRowComponent);

import { Fragment, memo, useCallback, useMemo, useRef, type MouseEvent, type ReactNode } from 'react';
import type { AgentActivity, AgentQuestionAnswers, AgentTurnSummary } from '@/types';
import { useMarkdownCodeHighlight } from '@/hooks/useMarkdownCodeHighlight';
import {
  AgentFileActivityRow,
  AgentFileActivityScrollList,
} from '@/components/agent/AgentFileActivityRow';
import { AgentThoughtBlock } from '@/components/agent/AgentThoughtBlock';
import { AgentQuestionCard } from '@/components/agent/AgentQuestionCard';
import { AgentPlanReviewDock } from '@/components/agent/AgentPlanReviewDock';
import { AgentResponseActions } from '@/components/agent/AgentResponseActions';
import { AgentTurnSummaryLine } from '@/components/agent/AgentTurnSummaryLine';
import {
  extractAgentFinalResponseText,
  isAgentTurnSummaryVisible,
  partitionAgentToolActivitiesForResponse,
  splitAgentResponseForSummary,
} from '@/utils/agentTurnSummary';
import { sanitizeResponseText, isValidReadFileTarget } from '@/utils/agentTranscriptParser';
import { parseAgentLiveFileStatus } from '@/utils/agentActivityLabel';
import { normalizeMarkdownSource, renderMarkdownPreview } from '@/utils/markdownPreview';

interface AgentActivityListProps {
  activities: AgentActivity[];
  running: boolean;
  summary?: AgentTurnSummary;
  projectId: string;
  projectPath: string;
  paneId: string;
  isLatestTurn?: boolean;
  onSubmitQuestion?: (activityId: string, answers: AgentQuestionAnswers) => boolean | Promise<boolean>;
}

function getSanitizedResponseLabel(label: string): string {
  return sanitizeResponseText(normalizeMarkdownSource(label));
}

function resolveThoughtLiveStatus(
  activities: AgentActivity[],
  thoughtIndex: number,
  running: boolean,
): string | null {
  if (!running) {
    return null;
  }

  for (let index = activities.length - 1; index > thoughtIndex; index -= 1) {
    const entry = activities[index];

    if (entry?.kind === 'live_status' && entry.label.trim()) {
      return entry.label.trim();
    }
  }

  return null;
}

function isRenderableActivity(activity: AgentActivity, running: boolean): boolean {
  if (activity.kind === 'section') {
    return false;
  }

  if (activity.kind === 'live_status') {
    return running && Boolean(activity.label.trim());
  }

  if (activity.kind === 'status') {
    return Boolean(activity.label.trim());
  }

  if (activity.kind === 'file_read') {
    const target = activity.filePath?.trim() ?? '';

    if (!target) {
      return false;
    }

    if (!running) {
      return false;
    }

    return isValidReadFileTarget(target);
  }

  if (activity.kind === 'file_edit') {
    return Boolean(activity.filePath?.trim());
  }

  if (activity.kind === 'response') {
    return Boolean(getSanitizedResponseLabel(activity.label).trim());
  }

  if (activity.kind === 'question') {
    return Boolean(activity.questions && activity.questions.length > 0);
  }

  if (activity.kind === 'plan') {
    return activity.planStatus !== 'pending';
  }

  return true;
}

function findAgentResponseInlineCode(element: EventTarget | null): HTMLElement | null {
  if (!(element instanceof HTMLElement)) {
    return null;
  }

  const code = element.closest('code');

  if (!code || code.classList.contains('hljs') || code.closest('pre')) {
    return null;
  }

  return code;
}

const AgentResponseBody = memo(function AgentResponseBody({ content }: { content: string }) {
  const html = useMemo(() => renderMarkdownPreview(content), [content]);
  const bodyRef = useMarkdownCodeHighlight<HTMLDivElement>(html);
  const copiedTimeoutRef = useRef<number | null>(null);

  const handleClick = useCallback(async (event: MouseEvent<HTMLDivElement>) => {
    const code = findAgentResponseInlineCode(event.target);

    if (!code) {
      return;
    }

    const value = code.textContent?.trim() ?? '';

    if (!value) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(value);

      if (copiedTimeoutRef.current !== null) {
        window.clearTimeout(copiedTimeoutRef.current);
      }

      code.classList.add('markdown-preview__inline-code--copied');
      code.setAttribute('title', 'Copiado');

      copiedTimeoutRef.current = window.setTimeout(() => {
        code.classList.remove('markdown-preview__inline-code--copied');
        code.removeAttribute('title');
        copiedTimeoutRef.current = null;
      }, 1600);
    } catch {
      code.classList.remove('markdown-preview__inline-code--copied');
      code.removeAttribute('title');
    }
  }, []);

  return (
    <div
      ref={bodyRef}
      className='agent-view__response-body markdown-preview markdown-preview--monokai'
      onClick={(event) => void handleClick(event)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

function renderResponseBlock(
  activity: AgentActivity,
  content: string,
  running: boolean,
  className = '',
): ReactNode {
  return (
    <div
      className={`agent-view__response${running && activity.streaming ? ' agent-view__response--streaming' : ' agent-view__response--settled'}${className ? ` ${className}` : ''}`}
    >
      <AgentResponseBody content={content} />
    </div>
  );
}

function renderResponseToolActivities(
  tools: AgentActivity[],
  running: boolean,
  projectPath: string,
): ReactNode {
  if (tools.length === 0) {
    return null;
  }

  return (
    <AgentFileActivityScrollList
      activities={tools}
      projectPath={projectPath}
      live={running}
      stickToBottom={running}
    />
  );
}

function AgentActivityListComponent({
  activities,
  running,
  summary,
  projectId,
  projectPath,
  paneId,
  isLatestTurn = false,
  onSubmitQuestion,
}: AgentActivityListProps) {
  const visibleActivities = useMemo(
    () => activities.filter((activity) => isRenderableActivity(activity, running)),
    [activities, running],
  );

  const { activities: displayActivities, responseTools } = useMemo(
    () => partitionAgentToolActivitiesForResponse(visibleActivities),
    [visibleActivities],
  );

  const showSummary = !running && isAgentTurnSummaryVisible(summary);

  const hasVisibleResponse = useMemo(
    () => displayActivities.some((activity) => activity.kind === 'response'),
    [displayActivities],
  );

  const finalResponseText = useMemo(
    () => extractAgentFinalResponseText(activities),
    [activities],
  );

  const showCopyPill = !running && finalResponseText.length > 0;
  const showChangesPill = !running && Boolean(summary && (summary.additions > 0 || summary.deletions > 0));
  const showResponseActions = showCopyPill || showChangesPill;
  const showInlineSummary = showSummary && responseTools.length === 0;

  return (
    <div className='agent-view__activities'>
      {displayActivities.map((activity, activityIndex) => {
        if (activity.kind === 'thought') {
          const sourceIndex = activities.findIndex((entry) => entry.id === activity.id);

          return (
            <AgentThoughtBlock
              key={activity.id}
              activity={activity}
              defaultExpanded={!activity.collapsed}
              liveStatus={resolveThoughtLiveStatus(
                activities,
                sourceIndex === -1 ? activityIndex : sourceIndex,
                running,
              )}
            />
          );
        }

        if (activity.kind === 'section') {
          return (
            <div key={activity.id} className='agent-view__section app-button--enter'>
              {activity.label}
            </div>
          );
        }

        if (activity.kind === 'file_edit' || activity.kind === 'file_read') {
          return <AgentFileActivityRow key={activity.id} activity={activity} projectPath={projectPath} />;
        }

        if (activity.kind === 'response') {
          const label = getSanitizedResponseLabel(activity.label);

          if (!label) {
            return null;
          }

          const split =
            showSummary && summary
              ? splitAgentResponseForSummary(label, summary.responseLead)
              : null;

          if (split) {
            return (
              <Fragment key={activity.id}>
                {renderResponseBlock(activity, split.lead, running, 'agent-view__response--lead')}
                {renderResponseToolActivities(responseTools, running, projectPath)}
                {showInlineSummary ? <AgentTurnSummaryLine summary={summary!} projectPath={projectPath} /> : null}
                {renderResponseBlock(activity, split.rest, running, 'agent-view__response--tail')}
              </Fragment>
            );
          }

          return (
            <Fragment key={activity.id}>
              {renderResponseToolActivities(responseTools, running, projectPath)}
              {showInlineSummary && summary ? <AgentTurnSummaryLine summary={summary} projectPath={projectPath} /> : null}
              {renderResponseBlock(activity, label, running)}
            </Fragment>
          );
        }

        if (activity.kind === 'question') {
          return (
            <AgentQuestionCard
              key={activity.id}
              activity={activity}
              interactive={
                Boolean(onSubmitQuestion) &&
                isLatestTurn &&
                !running &&
                activity.questionStatus === 'pending'
              }
              onSubmit={onSubmitQuestion ?? (async () => false)}
            />
          );
        }

        if (activity.kind === 'plan') {
          return <AgentPlanReviewDock key={activity.id} activity={activity} mode='archive' />;
        }

        if (activity.kind === 'status') {
          return (
            <div key={activity.id} className='agent-view__status-line app-button--enter'>
              {activity.label}
            </div>
          );
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

        return null;
      })}
      {running && displayActivities.length === 0 && responseTools.length === 0 ? (
        <div className='agent-view__status-line agent-view__status-line--live app-button--enter'>
          Executando agent…
        </div>
      ) : null}
      {showInlineSummary && summary && !hasVisibleResponse ? (
        <AgentTurnSummaryLine summary={summary} projectPath={projectPath} />
      ) : null}
      {showResponseActions ? (
        <AgentResponseActions
          projectId={projectId}
          projectPath={projectPath}
          paneId={paneId}
          content={finalResponseText}
          summary={summary}
          showSkillPills={isLatestTurn}
          showCopyPill={showCopyPill}
        />
      ) : null}
    </div>
  );
}

export const AgentActivityList = memo(AgentActivityListComponent);

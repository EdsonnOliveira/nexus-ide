import { Fragment, memo, useMemo, type ReactNode } from 'react';
import type { AgentActivity, AgentTurnSummary } from '@/types';
import { AgentFileActivityRow } from '@/components/agent/AgentFileActivityRow';
import { AgentThoughtBlock } from '@/components/agent/AgentThoughtBlock';
import { AgentResponseActions } from '@/components/agent/AgentResponseActions';
import { AgentTurnSummaryLine } from '@/components/agent/AgentTurnSummaryLine';
import {
  extractAgentFinalResponseText,
  isAgentTurnSummaryVisible,
  splitAgentResponseForSummary,
} from '@/utils/agentTurnSummary';
import { sanitizeResponseText, isValidReadFileTarget } from '@/utils/agentTranscriptParser';
import { normalizeMarkdownSource, renderMarkdownPreview } from '@/utils/markdownPreview';

interface AgentActivityListProps {
  activities: AgentActivity[];
  running: boolean;
  summary?: AgentTurnSummary;
  projectId: string;
  projectPath: string;
  paneId: string;
  isLatestTurn?: boolean;
}

function getSanitizedResponseLabel(label: string): string {
  return sanitizeResponseText(normalizeMarkdownSource(label));
}

function isRenderableActivity(activity: AgentActivity, running: boolean): boolean {
  if (activity.kind === 'live_status' || activity.kind === 'section' || activity.kind === 'status') {
    return false;
  }

  if (activity.kind === 'file_read' || activity.kind === 'file_edit') {
    if (!running) {
      return false;
    }

    if (activity.kind === 'file_read') {
      const target = activity.filePath?.trim() ?? '';

      if (!isValidReadFileTarget(target)) {
        return false;
      }

      return true;
    }

    return false;
  }

  if (activity.kind === 'response') {
    return Boolean(getSanitizedResponseLabel(activity.label).trim());
  }

  return true;
}

const AgentResponseBody = memo(function AgentResponseBody({ content }: { content: string }) {
  const html = useMemo(() => renderMarkdownPreview(content), [content]);

  return (
    <div className='agent-view__response-body markdown-preview' dangerouslySetInnerHTML={{ __html: html }} />
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

function AgentActivityListComponent({
  activities,
  running,
  summary,
  projectId,
  projectPath,
  paneId,
  isLatestTurn = false,
}: AgentActivityListProps) {
  const visibleActivities = useMemo(
    () => activities.filter((activity) => isRenderableActivity(activity, running)),
    [activities, running],
  );

  const showSummary = !running && isAgentTurnSummaryVisible(summary);

  const finalResponseText = useMemo(
    () => extractAgentFinalResponseText(activities),
    [activities],
  );

  const showCopyPill = !running && finalResponseText.length > 0;

  return (
    <div className='agent-view__activities'>
      {visibleActivities.map((activity) => {
        if (activity.kind === 'thought') {
          return (
            <AgentThoughtBlock
              key={activity.id}
              activity={activity}
              defaultExpanded={!activity.collapsed && !activity.streaming}
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
          return <AgentFileActivityRow key={activity.id} activity={activity} />;
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
                <AgentTurnSummaryLine summary={summary!} />
                {renderResponseBlock(activity, split.rest, running, 'agent-view__response--tail')}
              </Fragment>
            );
          }

          return (
            <Fragment key={activity.id}>
              {renderResponseBlock(activity, label, running)}
              {showSummary && summary ? <AgentTurnSummaryLine summary={summary} /> : null}
            </Fragment>
          );
        }

        if (activity.kind === 'status') {
          return (
            <div key={activity.id} className='agent-view__status-line app-button--enter'>
              {activity.label}
            </div>
          );
        }

        return null;
      })}
      {showCopyPill ? (
        <AgentResponseActions
          projectId={projectId}
          projectPath={projectPath}
          paneId={paneId}
          content={finalResponseText}
          showSkillPills={isLatestTurn}
        />
      ) : null}
    </div>
  );
}

export const AgentActivityList = memo(AgentActivityListComponent);

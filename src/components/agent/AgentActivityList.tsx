import { Fragment, memo, useCallback, useMemo, useRef, type MouseEvent, type ReactNode } from 'react';
import type { AgentActivity, AgentQuestionAnswers, AgentTurnSummary } from '@/types';
import { useMarkdownCodeHighlight, useDeferredMarkdownHtml } from '@/hooks/useMarkdownCodeHighlight';
import { AgentToolActivityScrollList } from '@/components/agent/AgentFileActivityRow';
import { AgentThoughtBlock } from '@/components/agent/AgentThoughtBlock';
import { AgentQuestionCard } from '@/components/agent/AgentQuestionCard';
import { AgentPlanReviewDock } from '@/components/agent/AgentPlanReviewDock';
import { AgentResponseActions } from '@/components/agent/AgentResponseActions';
import { AgentTurnSummaryLine } from '@/components/agent/AgentTurnSummaryLine';
import {
  buildAgentActivityRenderChunks,
  extractAgentFinalResponseText,
  isAgentTurnSummaryVisible,
  splitAgentResponseForSummary,
} from '@/utils/agentTurnSummary';
import {
  resolveAgentActivityFilePath,
  sanitizeResponseText,
  isValidReadFileTarget,
} from '@/utils/agentTranscriptParser';
import { normalizeMarkdownSource } from '@/utils/markdownPreview';
import { useTabActions } from '@/stores/useTabStore';

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
  const normalized = normalizeMarkdownSource(label);
  const sanitized = sanitizeResponseText(normalized).trim();
  return sanitized || normalized.trim();
}

function isRenderableActivity(activity: AgentActivity, running: boolean): boolean {
  if (activity.kind === 'section') {
    return false;
  }

  if (activity.kind === 'live_status') {
    return running && Boolean(activity.label.trim());
  }

  if (activity.kind === 'tool_run') {
    return running && Boolean(activity.label.trim() || activity.toolCommand?.trim());
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

const AgentResponseBody = memo(function AgentResponseBody({
  content,
  projectPath,
}: {
  content: string;
  projectPath: string;
}) {
  const html = useDeferredMarkdownHtml(content);
  const bodyRef = useMarkdownCodeHighlight<HTMLDivElement>(html);
  const copiedTimeoutRef = useRef<number | null>(null);
  const { openFileTab } = useTabActions();

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

      if (code.classList.contains('markdown-preview__inline-code--path')) {
        const absolutePath = resolveAgentActivityFilePath(projectPath, value);

        if (absolutePath) {
          const fileName = absolutePath.split(/[/\\]/).pop() ?? value;
          void openFileTab(absolutePath, fileName);
        }
      }
    } catch {
      code.classList.remove('markdown-preview__inline-code--copied');
      code.removeAttribute('title');
    }
  }, [openFileTab, projectPath]);

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
  projectPath: string,
  className = '',
): ReactNode {
  return (
    <div
      className={`agent-view__response${running && activity.streaming ? ' agent-view__response--streaming' : ' agent-view__response--settled'}${className ? ` ${className}` : ''}`}
    >
      <AgentResponseBody content={content} projectPath={projectPath} />
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
  onSubmitQuestion,
}: AgentActivityListProps) {
  const visibleActivities = useMemo(
    () => activities.filter((activity) => isRenderableActivity(activity, running)),
    [activities, running],
  );

  const showSummary = !running && isAgentTurnSummaryVisible(summary);

  const lastResponseId = useMemo(() => {
    for (let index = visibleActivities.length - 1; index >= 0; index -= 1) {
      const entry = visibleActivities[index];

      if (entry?.kind === 'response') {
        return entry.id;
      }
    }

    return null;
  }, [visibleActivities]);

  const hasVisibleResponse = useMemo(
    () => visibleActivities.some((activity) => activity.kind === 'response'),
    [visibleActivities],
  );

  const finalResponseText = useMemo(
    () => extractAgentFinalResponseText(activities),
    [activities],
  );

  const showCopyPill = !running && finalResponseText.length > 0;
  const showChangesPill = !running && Boolean(summary && (summary.additions > 0 || summary.deletions > 0));
  const showResponseActions = showCopyPill || showChangesPill;
  const activityChunks = useMemo(
    () => buildAgentActivityRenderChunks(visibleActivities, running),
    [visibleActivities, running],
  );

  const hasResponseAfterThought = useMemo(() => {
    const thoughtIndex = visibleActivities.findIndex((entry) => entry.kind === 'thought');

    if (thoughtIndex === -1) {
      return false;
    }

    return visibleActivities
      .slice(thoughtIndex + 1)
      .some((entry) => entry.kind === 'response');
  }, [visibleActivities]);

  const hasProgressAfterThought = useMemo(() => {
    const thoughtIndex = visibleActivities.findIndex((entry) => entry.kind === 'thought');

    if (thoughtIndex === -1) {
      return false;
    }

    return visibleActivities.slice(thoughtIndex + 1).some((entry) => {
      if (entry.kind === 'response') {
        return true;
      }

      if (entry.kind === 'file_read' || entry.kind === 'file_edit') {
        return Boolean(entry.filePath?.trim());
      }

      if (entry.kind === 'tool_run') {
        return Boolean(entry.label.trim() || entry.toolCommand?.trim());
      }

      if (entry.kind === 'live_status') {
        return Boolean(entry.label.trim());
      }

      return false;
    });
  }, [visibleActivities]);

  const renderSingleActivity = (activity: AgentActivity): ReactNode => {
        if (activity.kind === 'thought') {
          const collapseThought =
            hasResponseAfterThought ||
            (hasProgressAfterThought && !activity.label.trim());

          return (
            <AgentThoughtBlock
              key={activity.id}
              activity={activity}
              defaultExpanded={!collapseThought && !activity.collapsed}
              forceCollapsed={collapseThought}
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

        if (activity.kind === 'status') {
          if (/^Ran\b/i.test(activity.label.trim())) {
            return null;
          }

          return (
            <div key={activity.id} className='agent-view__status-line app-button--enter'>
              {activity.label}
            </div>
          );
        }

        if (activity.kind === 'tool_run' || activity.kind === 'live_status') {
          return null;
        }

        if (activity.kind === 'file_edit' || activity.kind === 'file_read') {
          return null;
        }

        if (activity.kind === 'response') {
          const label = getSanitizedResponseLabel(activity.label);

          if (!label) {
            return null;
          }

          const isLastResponse = activity.id === lastResponseId;
          const split =
            isLastResponse && showSummary && summary
              ? splitAgentResponseForSummary(label, summary.responseLead)
              : null;

          if (split) {
            return (
              <Fragment key={activity.id}>
                {renderResponseBlock(activity, split.lead, running, projectPath, 'agent-view__response--lead')}
                <AgentTurnSummaryLine summary={summary!} projectPath={projectPath} />
                {renderResponseBlock(activity, split.rest, running, projectPath, 'agent-view__response--tail')}
              </Fragment>
            );
          }

          return renderResponseBlock(activity, label, running, projectPath);
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

        return null;
  };

  return (
    <div className='agent-view__activities'>
      {activityChunks.map((chunk) => {
        if (chunk.type === 'tool-group' && chunk.activities) {
          return (
            <AgentToolActivityScrollList
              key={chunk.key}
              activities={chunk.activities}
              projectPath={projectPath}
              running={running}
            />
          );
        }

        if (chunk.type !== 'single' || !chunk.activity) {
          return null;
        }

        const activity = chunk.activity;

        return <Fragment key={activity.id}>{renderSingleActivity(activity)}</Fragment>;
      })}
      {showSummary && summary && !hasVisibleResponse ? (
        <AgentTurnSummaryLine summary={summary} projectPath={projectPath} />
      ) : null}
      {running && visibleActivities.length === 0 ? (
        <div className='agent-view__status-line agent-view__status-line--live app-button--enter'>
          Executando agent…
        </div>
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

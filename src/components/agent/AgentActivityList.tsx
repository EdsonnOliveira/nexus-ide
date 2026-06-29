import { Fragment, memo, useCallback, useMemo, useRef, type MouseEvent, type ReactNode } from 'react';
import type { AgentActivity, AgentQuestionAnswers, AgentTurnSummary } from '@/types';
import { AgentFileActivityRow } from '@/components/agent/AgentFileActivityRow';
import { AgentThoughtBlock } from '@/components/agent/AgentThoughtBlock';
import { AgentQuestionCard } from '@/components/agent/AgentQuestionCard';
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
  onSubmitQuestion?: (activityId: string, answers: AgentQuestionAnswers) => boolean | Promise<boolean>;
}

function getSanitizedResponseLabel(label: string): string {
  return sanitizeResponseText(normalizeMarkdownSource(label));
}

function isRenderableActivity(activity: AgentActivity, running: boolean): boolean {
  if (activity.kind === 'section') {
    return false;
  }

  if (activity.kind === 'live_status') {
    return running;
  }

  if (activity.kind === 'status') {
    return Boolean(activity.label.trim());
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
      className='agent-view__response-body markdown-preview'
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

  const hasVisibleResponse = useMemo(
    () => visibleActivities.some((activity) => activity.kind === 'response'),
    [visibleActivities],
  );

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
          const statusLabel =
            activity.planStatus === 'building'
              ? 'Executando plano…'
              : activity.planStatus === 'accepted'
                ? 'Plano aceito'
                : activity.planStatus === 'rejected'
                  ? 'Plano descartado'
                  : activity.planName ?? 'Plano';

          return (
            <div key={activity.id} className='agent-view__plan-summary app-button--enter'>
              {statusLabel}
            </div>
          );
        }

        if (activity.kind === 'status') {
          return (
            <div key={activity.id} className='agent-view__status-line app-button--enter'>
              {activity.label}
            </div>
          );
        }

        if (activity.kind === 'live_status') {
          return (
            <div
              key={activity.id}
              className='agent-view__status-line agent-view__status-line--live app-button--enter'
            >
              {activity.label}
            </div>
          );
        }

        return null;
      })}
      {running && visibleActivities.length === 0 ? (
        <div className='agent-view__status-line agent-view__status-line--live app-button--enter'>
          Executando agent…
        </div>
      ) : null}
      {showSummary && summary && !hasVisibleResponse ? (
        <AgentTurnSummaryLine summary={summary} />
      ) : null}
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

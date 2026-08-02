import { Fragment, memo, useCallback, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type {
  AgentActivity,
  AgentQuestionAnswers,
  AgentTurnSummary,
  AgentTurnUsage,
} from '@/types';
import { useMarkdownCodeHighlight, useDeferredMarkdownHtml } from '@/hooks/useMarkdownCodeHighlight';
import {
  AgentActivityIcon,
  resolveAgentActivityIconFromLabel,
} from '@/components/agent/AgentActivityIcon';
import { AgentToolActivityScrollList } from '@/components/agent/AgentFileActivityRow';
import { AgentThoughtBlock } from '@/components/agent/AgentThoughtBlock';
import { AgentQuestionCard } from '@/components/agent/AgentQuestionCard';
import { AgentPlanReviewDock } from '@/components/agent/AgentPlanReviewDock';
import { AgentResponseActions } from '@/components/agent/AgentResponseActions';
import { AgentActionBlockSummary } from '@/components/agent/AgentActionBlockSummary';
import { AgentTaskActivityCard } from '@/components/agent/AgentTaskActivityCard';
import { AgentTurnSummaryLine } from '@/components/agent/AgentTurnSummaryLine';
import { MarkdownImageLightbox } from '@/components/overlay/MarkdownImageLightbox';
import {
  buildActionBlockSummary,
  buildAgentActivityRenderChunks,
  buildEditedFilesFromActivities,
  extractAgentFinalResponseText,
  isActionBlockChunkLive,
  isAgentTurnSummaryVisible,
  partitionLiveActionBlockActivities,
  splitAgentResponseForSummary,
} from '@/utils/agentTurnSummary';
import {
  resolveAgentActivityFilePath,
  sanitizeResponseText,
  isValidReadFileTarget,
} from '@/utils/agentTranscriptParser';
import { looksLikeTruncatedAgentResponse } from '@/utils/agentStreamJsonParser';
import { findMarkdownPreviewImage } from '@/utils/downloadImageSrc';
import { normalizeMarkdownSource } from '@/utils/markdownText';
import { useTabActions } from '@/stores/useTabStore';

interface AgentActivityListProps {
  activities: AgentActivity[];
  running: boolean;
  summary?: AgentTurnSummary;
  startedAt?: number;
  completedAt?: number;
  usage?: AgentTurnUsage;
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

const INCOMPLETE_THOUGHT_CLOSING_MESSAGE =
  'O agente parou durante o raciocínio sem concluir a resposta. Envie novamente para continuar.';

function isRenderableActivity(activity: AgentActivity, running: boolean): boolean {
  if (activity.kind === 'section') {
    return false;
  }

  if (activity.kind === 'live_status') {
    return running && Boolean(activity.label.trim());
  }

  if (activity.kind === 'tool_run') {
    return Boolean(activity.label.trim() || activity.toolCommand?.trim());
  }

  if (activity.kind === 'status') {
    return Boolean(activity.label.trim());
  }

  if (activity.kind === 'file_read') {
    const target = activity.filePath?.trim() ?? '';

    if (!target) {
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

  if (activity.kind === 'task') {
    return Boolean(activity.label.trim());
  }

  return true;
}

function collectRelatedFilesForTask(
  activities: AgentActivity[],
  taskId: string,
): string[] {
  const taskIndex = activities.findIndex((entry) => entry.id === taskId);

  if (taskIndex < 0) {
    return [];
  }

  const files: string[] = [];

  for (let index = taskIndex + 1; index < activities.length; index += 1) {
    const entry = activities[index];

    if (!entry) {
      continue;
    }

    if (entry.kind === 'task' || entry.kind === 'response' || entry.kind === 'question' || entry.kind === 'plan') {
      break;
    }

    if ((entry.kind === 'file_read' || entry.kind === 'file_edit') && entry.filePath?.trim()) {
      files.push(entry.filePath.trim());
    }
  }

  return files;
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
  const html = useDeferredMarkdownHtml(content, projectPath);
  const bodyRef = useMarkdownCodeHighlight<HTMLDivElement>(html);
  const copiedTimeoutRef = useRef<number | null>(null);
  const { openFileTab } = useTabActions();
  const [preview, setPreview] = useState<{ src: string; fileName: string | null } | null>(null);

  const handleClick = useCallback(async (event: MouseEvent<HTMLDivElement>) => {
    const image = findMarkdownPreviewImage(event.target);

    if (image) {
      event.preventDefault();
      event.stopPropagation();
      setPreview({
        src: image.currentSrc || image.src,
        fileName:
          image.getAttribute('data-image-ref') ||
          image.getAttribute('data-image-path') ||
          image.getAttribute('alt') ||
          null,
      });
      return;
    }

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

      if (
        code.classList.contains('markdown-preview__inline-code--path') &&
        (/[/\\]/.test(value) ||
          /\.\w{1,10}$/.test(value) ||
          value.startsWith('~/') ||
          value.startsWith('./') ||
          value.startsWith('../'))
      ) {
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
    <>
      <div
        ref={bodyRef}
        className='agent-view__response-body markdown-preview markdown-preview--monokai'
        onClick={(event) => void handleClick(event)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {preview ? (
        <MarkdownImageLightbox
          src={preview.src}
          fileName={preview.fileName}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </>
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
  startedAt,
  completedAt,
  usage,
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

  const endedDuringThought = useMemo(() => {
    if (running) {
      return false;
    }

    let lastResponseIndex = -1;
    let lastThoughtIndex = -1;
    let lastProgressIndex = -1;

    for (let index = 0; index < visibleActivities.length; index += 1) {
      const entry = visibleActivities[index];

      if (!entry) {
        continue;
      }

      if (entry.kind === 'response' && getSanitizedResponseLabel(entry.label)) {
        lastResponseIndex = index;
        lastProgressIndex = index;
        continue;
      }

      if (entry.kind === 'question' || entry.kind === 'plan') {
        lastResponseIndex = index;
        lastProgressIndex = index;
        continue;
      }

      if (
        entry.kind === 'tool_run' ||
        entry.kind === 'file_edit' ||
        entry.kind === 'file_read' ||
        entry.kind === 'task'
      ) {
        lastProgressIndex = index;
        continue;
      }

      if (entry.kind === 'thought') {
        lastThoughtIndex = index;
      }
    }

    return lastThoughtIndex > lastResponseIndex && lastThoughtIndex >= lastProgressIndex;
  }, [running, visibleActivities]);

  const incompleteClosingMessage = INCOMPLETE_THOUGHT_CLOSING_MESSAGE;

  const finalResponseText = useMemo(
    () => extractAgentFinalResponseText(activities),
    [activities],
  );

  const showCopyPill = !running && finalResponseText.length > 0;
  const editedFilesForCard = useMemo(
    () => (!running ? buildEditedFilesFromActivities(activities) : []),
    [activities, running],
  );
  const showChangesPill =
    !running &&
    Boolean(
      editedFilesForCard.length > 0 ||
        (summary &&
          ((summary.editedFiles?.length ?? 0) > 0 ||
            summary.editedFileCount > 0 ||
            summary.additions > 0 ||
            summary.deletions > 0)),
    );
  const showResponseActions = showCopyPill || showChangesPill;
  const activityChunks = useMemo(
    () => buildAgentActivityRenderChunks(visibleActivities),
    [visibleActivities],
  );
  const hasSettledActionSummaries = useMemo(
    () =>
      activityChunks.some((chunk, index) => {
        if (chunk.type !== 'action-group' || !chunk.activities) {
          return false;
        }

        if (isActionBlockChunkLive(index, activityChunks, running)) {
          return false;
        }

        return buildActionBlockSummary(chunk.activities).hasToolProgress;
      }),
    [activityChunks, running],
  );

  const renderSingleActivity = (activity: AgentActivity): ReactNode => {
        if (activity.kind === 'thought') {
          const thoughtIndex = visibleActivities.findIndex((entry) => entry.id === activity.id);
          const following = thoughtIndex >= 0 ? visibleActivities.slice(thoughtIndex + 1) : [];
          const hasProgressAfter = following.some((entry) => {
            if (entry.kind === 'response') {
              return true;
            }

            if (entry.kind === 'file_read' || entry.kind === 'file_edit') {
              return Boolean(entry.filePath?.trim());
            }

            if (entry.kind === 'tool_run') {
              return Boolean(entry.label.trim() || entry.toolCommand?.trim());
            }

            if (entry.kind === 'task') {
              return Boolean(entry.label.trim());
            }

            return false;
          });
          const collapseEmptyPlaceholder =
            !activity.streaming && !activity.label.trim() && hasProgressAfter;

          return (
            <AgentThoughtBlock
              key={activity.id}
              activity={activity}
              defaultExpanded={Boolean(activity.streaming)}
              forceCollapsed={collapseEmptyPlaceholder}
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
              <AgentActivityIcon kind={resolveAgentActivityIconFromLabel(activity.label)} />
              <span>{activity.label}</span>
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
            isLastResponse && showSummary && summary && !hasSettledActionSummaries
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

        if (activity.kind === 'task') {
          const taskIndex = visibleActivities.findIndex((entry) => entry.id === activity.id);
          const previous = taskIndex > 0 ? visibleActivities[taskIndex - 1] : null;
          const showToolsHeader = previous?.kind !== 'task';

          return (
            <AgentTaskActivityCard
              key={activity.id}
              activity={activity}
              projectPath={projectPath}
              relatedFiles={collectRelatedFilesForTask(visibleActivities, activity.id)}
              showToolsHeader={showToolsHeader}
            />
          );
        }

        return null;
  };

  const emptyResponseFallback = useMemo(() => {
    if (endedDuringThought) {
      return incompleteClosingMessage;
    }

    if (!summary) {
      return 'O agente encerrou sem uma resposta em texto.';
    }

    if (summary.editedFileCount > 0 || summary.commandCount > 0) {
      return 'Alterações aplicadas.';
    }

    return 'O agente encerrou sem uma resposta em texto.';
  }, [endedDuringThought, incompleteClosingMessage, summary]);

  const lastVisibleResponseLabel = useMemo(() => {
    for (let index = visibleActivities.length - 1; index >= 0; index -= 1) {
      const entry = visibleActivities[index];

      if (entry?.kind === 'response') {
        return getSanitizedResponseLabel(entry.label).trim();
      }
    }

    return '';
  }, [visibleActivities]);

  const showIncompleteClosing =
    !running &&
    lastVisibleResponseLabel !== incompleteClosingMessage &&
    (endedDuringThought || looksLikeTruncatedAgentResponse(lastVisibleResponseLabel));

  const renderLiveActionGroup = (activities: AgentActivity[]): ReactNode => {
    const nodes: ReactNode[] = [];
    let toolGroup: AgentActivity[] = [];

    const flushTools = (keySuffix: string) => {
      if (toolGroup.length === 0) {
        return;
      }

      nodes.push(
        <AgentToolActivityScrollList
          key={`live-tools-${keySuffix}`}
          activities={toolGroup}
          projectPath={projectPath}
          running
        />,
      );
      toolGroup = [];
    };

    for (const activity of activities) {
      if (activity.kind === 'thought') {
        flushTools(activity.id);
        nodes.push(
          <AgentThoughtBlock
            key={activity.id}
            activity={activity}
            defaultExpanded={Boolean(activity.streaming || activity.label.trim())}
            forceCollapsed={!activity.streaming && !activity.label.trim()}
          />,
        );
        continue;
      }

      toolGroup.push(activity);
    }

    flushTools('tail');
    return nodes;
  };

  const renderTrailingActionGroup = (activities: AgentActivity[], chunkKey: string): ReactNode => {
    const { settled, live } = partitionLiveActionBlockActivities(activities);
    const settledSummary = settled.length > 0 ? buildActionBlockSummary(settled) : null;

    return (
      <Fragment key={chunkKey}>
        {settledSummary?.hasToolProgress ? (
          <AgentActionBlockSummary activities={settled} projectPath={projectPath} />
        ) : (
          settled
            .filter((entry) => entry.kind === 'thought' && entry.label.trim())
            .map((activity) => (
              <AgentThoughtBlock
                key={activity.id}
                activity={activity}
                defaultExpanded
                forceCollapsed={false}
              />
            ))
        )}
        {live.length > 0 ? renderLiveActionGroup(live) : null}
      </Fragment>
    );
  };

  return (
    <div className='agent-view__activities'>
      {activityChunks.map((chunk, chunkIndex) => {
        if (chunk.type === 'action-group' && chunk.activities) {
          const live = isActionBlockChunkLive(chunkIndex, activityChunks, running);

          if (live) {
            return renderTrailingActionGroup(chunk.activities, chunk.key);
          }

          return (
            <AgentActionBlockSummary
              key={chunk.key}
              activities={chunk.activities}
              projectPath={projectPath}
            />
          );
        }

        if (chunk.type !== 'single' || !chunk.activity) {
          return null;
        }

        const activity = chunk.activity;

        return <Fragment key={activity.id}>{renderSingleActivity(activity)}</Fragment>;
      })}
      {showIncompleteClosing ? (
        <div className='agent-view__response agent-view__response--settled app-button--enter'>
          {incompleteClosingMessage}
        </div>
      ) : null}
      {showSummary && summary && !hasVisibleResponse && !hasSettledActionSummaries ? (
        <>
          <div className='agent-view__response agent-view__response--settled app-button--enter'>
            {emptyResponseFallback}
          </div>
          <AgentTurnSummaryLine summary={summary} projectPath={projectPath} />
        </>
      ) : null}
      {running && visibleActivities.length === 0 ? (
        <div className='agent-view__status-line agent-view__status-line--pending'>
          <AgentActivityIcon kind='tools' />
          <span>Executando agent…</span>
        </div>
      ) : null}
      {showResponseActions ? (
        <AgentResponseActions
          projectId={projectId}
          projectPath={projectPath}
          paneId={paneId}
          content={finalResponseText}
          summary={summary}
          editedFiles={editedFilesForCard}
          startedAt={startedAt}
          completedAt={completedAt}
          usage={usage}
          showSkillPills={isLatestTurn}
          showCopyPill={showCopyPill}
        />
      ) : null}
    </div>
  );
}

export const AgentActivityList = memo(AgentActivityListComponent);

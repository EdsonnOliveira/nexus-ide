import { memo, useCallback, useMemo, useState } from 'react';
import {
  AgentCommandActivityScrollList,
  AgentFileActivityScrollList,
} from '@/components/agent/AgentFileActivityRow';
import type { AgentActivity, AgentTurnSummary, AgentTurnSummaryFileRef } from '@/types';
import {
  buildAgentTurnSummarySegments,
  isAgentTurnSummaryVisible,
  type AgentTurnSummarySegmentKind,
} from '@/utils/agentTurnSummary';

interface AgentTurnSummaryLineProps {
  summary: AgentTurnSummary;
  projectPath: string;
}

function summaryFilesToActivities(
  files: AgentTurnSummaryFileRef[],
  verb: 'Read' | 'Edited',
): AgentActivity[] {
  return files.map((file) => ({
    id: file.path,
    kind: verb === 'Edited' ? 'file_edit' : 'file_read',
    label: verb,
    filePath: file.path,
    createdAt: 0,
  }));
}

function AgentTurnSummaryFileList({
  files,
  verb,
  projectPath,
}: {
  files: AgentTurnSummaryFileRef[];
  verb: 'Read' | 'Edited';
  projectPath: string;
}) {
  return (
    <AgentFileActivityScrollList
      activities={summaryFilesToActivities(files, verb)}
      projectPath={projectPath}
    />
  );
}

function AgentTurnSummaryLineComponent({ summary, projectPath }: AgentTurnSummaryLineProps) {
  const segments = useMemo(() => buildAgentTurnSummarySegments(summary), [summary]);
  const [expandedKind, setExpandedKind] = useState<AgentTurnSummarySegmentKind | null>(null);
  const hasDiff = summary.additions > 0 || summary.deletions > 0;

  const handleSegmentToggle = useCallback((kind: AgentTurnSummarySegmentKind) => {
    setExpandedKind((current) => (current === kind ? null : kind));
  }, []);

  if (!isAgentTurnSummaryVisible(summary)) {
    return null;
  }

  const expandedSegment = segments.find((segment) => {
    if (segment.kind !== expandedKind) {
      return false;
    }

    return Boolean(segment.files?.length || segment.commands?.length);
  });

  return (
    <div className='agent-view__turn-summary app-button--enter'>
      <div className='agent-view__turn-summary-row'>
        {segments.length > 0 ? (
          <div className='agent-view__turn-summary-text'>
            {segments.map((segment, index) => {
              const hasDropdown = Boolean(segment.files?.length || segment.commands?.length);
              const isOpen = expandedKind === segment.kind;

              return (
                <span key={segment.kind} className='agent-view__turn-summary-segment-wrap'>
                  {index > 0 ? <span className='agent-view__turn-summary-separator'>, </span> : null}
                  {hasDropdown ? (
                    <button
                      type='button'
                      className={`agent-view__turn-summary-segment app-button${isOpen ? ' agent-view__turn-summary-segment--open' : ''}`}
                      aria-expanded={isOpen}
                      onClick={() => handleSegmentToggle(segment.kind)}
                    >
                      {segment.label}
                    </button>
                  ) : (
                    <span>{segment.label}</span>
                  )}
                </span>
              );
            })}
          </div>
        ) : null}
        {hasDiff ? (
          <span className='agent-view__turn-summary-diff'>
            {summary.additions > 0 ? (
              <span className='agent-view__turn-summary-additions'>+{summary.additions}</span>
            ) : null}
            {summary.deletions > 0 ? (
              <span className='agent-view__turn-summary-deletions'>-{summary.deletions}</span>
            ) : null}
          </span>
        ) : null}
      </div>
      {expandedSegment?.files ? (
        <AgentTurnSummaryFileList
          files={expandedSegment.files}
          verb={expandedSegment.kind === 'edited' ? 'Edited' : 'Read'}
          projectPath={projectPath}
        />
      ) : null}
      {expandedSegment?.commands ? (
        <AgentCommandActivityScrollList commands={expandedSegment.commands} />
      ) : null}
    </div>
  );
}

export const AgentTurnSummaryLine = memo(AgentTurnSummaryLineComponent);

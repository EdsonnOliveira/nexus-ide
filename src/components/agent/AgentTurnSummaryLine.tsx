import { memo, useCallback, useMemo, useState } from 'react';
import type { AgentTurnSummary, AgentTurnSummaryFileRef } from '@/types';
import {
  buildAgentTurnSummarySegments,
  getAgentTurnSummaryFileName,
  isAgentTurnSummaryVisible,
  type AgentTurnSummarySegmentKind,
} from '@/utils/agentTurnSummary';

interface AgentTurnSummaryLineProps {
  summary: AgentTurnSummary;
}

function AgentTurnSummaryFileList({
  files,
  verb,
}: {
  files: AgentTurnSummaryFileRef[];
  verb: 'Read' | 'Edited';
}) {
  return (
    <div className='agent-view__turn-summary-files app-button--enter'>
      {files.map((file) => (
        <div key={file.path} className='agent-view__file-row'>
          <span className='agent-view__file-verb'>{verb}</span>
          <span className='agent-view__file-name' title={file.path}>
            {getAgentTurnSummaryFileName(file.path)}
          </span>
        </div>
      ))}
    </div>
  );
}

function AgentTurnSummaryLineComponent({ summary }: AgentTurnSummaryLineProps) {
  const segments = useMemo(() => buildAgentTurnSummarySegments(summary), [summary]);
  const [expandedKind, setExpandedKind] = useState<AgentTurnSummarySegmentKind | null>(null);
  const hasDiff = summary.additions > 0 || summary.deletions > 0;

  const handleSegmentToggle = useCallback((kind: AgentTurnSummarySegmentKind) => {
    setExpandedKind((current) => (current === kind ? null : kind));
  }, []);

  if (!isAgentTurnSummaryVisible(summary)) {
    return null;
  }

  const expandedSegment = segments.find(
    (segment) => segment.kind === expandedKind && segment.files && segment.files.length > 0,
  );

  return (
    <div className='agent-view__turn-summary app-button--enter'>
      <div className='agent-view__turn-summary-row'>
        {segments.length > 0 ? (
          <div className='agent-view__turn-summary-text'>
            {segments.map((segment, index) => {
              const hasFiles = Boolean(segment.files?.length);
              const isOpen = expandedKind === segment.kind;

              return (
                <span key={segment.kind} className='agent-view__turn-summary-segment-wrap'>
                  {index > 0 ? <span className='agent-view__turn-summary-separator'>, </span> : null}
                  {hasFiles ? (
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
        />
      ) : null}
    </div>
  );
}

export const AgentTurnSummaryLine = memo(AgentTurnSummaryLineComponent);

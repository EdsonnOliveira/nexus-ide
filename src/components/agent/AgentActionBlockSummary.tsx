import { memo, useCallback, useMemo, useState } from 'react';
import {
  AgentActivityIcon,
  resolveAgentActivityIconFromLabel,
} from '@/components/agent/AgentActivityIcon';
import { AgentToolActivityScrollList } from '@/components/agent/AgentFileActivityRow';
import { AgentThoughtBlock } from '@/components/agent/AgentThoughtBlock';
import type { AgentActivity } from '@/types';
import { buildActionBlockSummary } from '@/utils/agentTurnSummary';

interface AgentActionBlockSummaryProps {
  activities: AgentActivity[];
  projectPath: string;
}

function AgentActionBlockSummaryComponent({
  activities,
  projectPath,
}: AgentActionBlockSummaryProps) {
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(() => buildActionBlockSummary(activities), [activities]);
  const thoughts = useMemo(
    () => activities.filter((entry) => entry.kind === 'thought' && entry.label.trim()),
    [activities],
  );
  const toolActivities = useMemo(
    () =>
      activities.filter((entry) => {
        if (entry.kind === 'file_edit' || entry.kind === 'file_read') {
          return Boolean(entry.filePath?.trim());
        }

        if (entry.kind === 'tool_run') {
          return Boolean(entry.toolCommand?.trim() || entry.label.trim());
        }

        return false;
      }),
    [activities],
  );

  const handleToggle = useCallback(() => {
    setExpanded((current) => !current);
  }, []);

  const iconKind = useMemo(
    () => resolveAgentActivityIconFromLabel(summary.label),
    [summary.label],
  );

  if (!summary.hasToolProgress) {
    return (
      <>
        {thoughts.map((activity) => (
          <AgentThoughtBlock key={activity.id} activity={activity} defaultExpanded={false} />
        ))}
      </>
    );
  }

  const hasDiff = summary.additions > 0 || summary.deletions > 0;

  return (
    <div className='agent-view__turn-summary app-button--enter'>
      <div className='agent-view__turn-summary-row'>
        <button
          type='button'
          className={`agent-view__turn-summary-segment app-button${expanded ? ' agent-view__turn-summary-segment--open' : ''}`}
          aria-expanded={expanded}
          onClick={handleToggle}
        >
          <AgentActivityIcon kind={iconKind} />
          <span>{summary.label}</span>
        </button>
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
      {expanded ? (
        <div className='agent-view__turn-summary-files app-button--enter'>
          {thoughts.map((activity) => (
            <AgentThoughtBlock key={activity.id} activity={activity} defaultExpanded={false} />
          ))}
          {toolActivities.length > 0 ? (
            <AgentToolActivityScrollList
              activities={toolActivities}
              projectPath={projectPath}
              running={false}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const AgentActionBlockSummary = memo(AgentActionBlockSummaryComponent);

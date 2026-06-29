import { memo } from 'react';
import type { AgentQuestionAnswers, AgentTurn } from '@/types';
import { AgentActivityList } from '@/components/agent/AgentActivityList';
import { AgentUserPrompt } from '@/components/agent/AgentUserPrompt';
import { isAgentTurnSummaryVisible } from '@/utils/agentTurnSummary';

interface AgentTurnViewProps {
  turn: AgentTurn;
  isEditing?: boolean;
  isLatestTurn?: boolean;
  projectId: string;
  projectPath: string;
  paneId: string;
  onEdit?: (turnId: string) => void;
  onRedo?: (turnId: string) => void;
  onSubmitQuestion?: (activityId: string, answers: AgentQuestionAnswers) => boolean | Promise<boolean>;
}

function AgentTurnViewComponent({
  turn,
  isEditing = false,
  isLatestTurn = false,
  projectId,
  projectPath,
  paneId,
  onEdit,
  onRedo,
  onSubmitQuestion,
}: AgentTurnViewProps) {
  const hasActivities =
    turn.activities.length > 0 ||
    turn.running ||
    isAgentTurnSummaryVisible(turn.summary);

  return (
    <div className='agent-view__turn'>
      <AgentUserPrompt turn={turn} isEditing={isEditing} onEdit={onEdit} onRedo={onRedo} />
      {hasActivities ? (
        <AgentActivityList
          activities={turn.activities}
          running={turn.running}
          summary={turn.summary}
          projectId={projectId}
          projectPath={projectPath}
          paneId={paneId}
          isLatestTurn={isLatestTurn}
          onSubmitQuestion={onSubmitQuestion}
        />
      ) : null}
    </div>
  );
}

export const AgentTurnView = memo(AgentTurnViewComponent);

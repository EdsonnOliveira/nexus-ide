import { memo, useRef, type RefObject } from 'react';
import type { AgentQuestionAnswers, AgentTurn } from '@/types';
import { AgentActivityList } from '@/components/agent/AgentActivityList';
import { AgentUserPrompt } from '@/components/agent/AgentUserPrompt';
import { useStickyPromptState } from '@/hooks/useStickyPromptState';
import { isAgentTurnSummaryVisible } from '@/utils/agentTurnSummary';

interface AgentTurnViewProps {
  turn: AgentTurn;
  turnIndex: number;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
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
  turnIndex,
  scrollContainerRef,
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
  const stickySentinelRef = useRef<HTMLDivElement>(null);
  const { isStuck: isPromptStuck, phase: stickyPhase } = useStickyPromptState(
    stickySentinelRef,
    scrollContainerRef,
    turn.id,
  );

  return (
    <div className='agent-view__turn'>
      <div ref={stickySentinelRef} className='agent-view__user-prompt-sticky-sentinel' aria-hidden='true' />
      <div
        className={`agent-view__user-prompt-sticky${isPromptStuck ? ' agent-view__user-prompt-sticky--stuck' : ''}${stickyPhase === 'in' ? ' agent-view__user-prompt-sticky--enter' : ''}${stickyPhase === 'out' ? ' agent-view__user-prompt-sticky--exit' : ''}`}
        style={{ zIndex: turnIndex + 1 }}
      >
        <AgentUserPrompt
          turn={turn}
          isEditing={isEditing}
          isStickyLayout={isPromptStuck && stickyPhase !== 'out'}
          onEdit={onEdit}
          onRedo={onRedo}
        />
      </div>
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

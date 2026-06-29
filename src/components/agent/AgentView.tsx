import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Bot } from 'lucide-react';
import { AgentComposer } from '@/components/agent/AgentComposer';
import { AgentFollowUpQueue } from '@/components/agent/AgentFollowUpQueue';
import { AgentPlanReviewDock } from '@/components/agent/AgentPlanReviewDock';
import { AgentProjectSkillPills } from '@/components/agent/AgentProjectSkillPills';
import { AgentTranscript } from '@/components/agent/AgentTranscript';
import { EmptyState } from '@/components/overlay/EmptyState';
import { AgentGitChangePill } from '@/components/terminal/AgentGitChangePill';
import { useAgentPaneSession } from '@/hooks/useAgentPaneSession';
import { TERMINAL_AGENTS } from '@/constants/terminalAgents';
import type { AgentTab, AgentTurn } from '@/types';
import { cliAgentToTerminalAgent } from '@/utils/agentTabHelpers';

interface AgentViewProps {
  tab: AgentTab;
  projectId: string;
  projectPath: string;
  isVisible: boolean;
  isRuntimeActive: boolean;
  isFocused: boolean;
  onFocusPane: () => void;
  onPtyCreated: (ptyId: string) => void;
  onPtyLost: () => void;
  onUpdateTab: (patch: Partial<Pick<AgentTab, 'turns' | 'workingDirectory' | 'restoreCommand'>>) => void;
}

function AgentViewComponent({
  tab,
  projectId,
  projectPath,
  isVisible,
  isRuntimeActive,
  isFocused,
  onFocusPane,
  onPtyCreated,
  onPtyLost,
  onUpdateTab,
}: AgentViewProps) {
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<AgentTurn[]>(tab.turns ?? []);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const terminalAgent = cliAgentToTerminalAgent(tab.cliAgent);
  const agentConfig = TERMINAL_AGENTS[terminalAgent];

  useEffect(() => {
    setTurns(tab.turns ?? []);
  }, [tab.id, tab.turns]);

  const appendDraft = useCallback((text: string) => {
    setDraft((prev) => prev + text);
    inputRef.current?.focus();
  }, []);

  const handleTurnsChange = useCallback(
    (nextTurns: AgentTurn[]) => {
      setTurns(nextTurns);
      onUpdateTab({ turns: nextTurns });
    },
    [onUpdateTab],
  );

  const restoreDraft = useCallback((text: string) => {
    setDraft(text);
    inputRef.current?.focus();
  }, []);

  const {
    submitPrompt,
    stopAgent,
    runCommand,
    editAgentTurn,
    cancelAgentTurnEdit,
    editingTurnId,
    redoAgentTurn,
    followUps,
    editFollowUp,
    sendFollowUpNow,
    removeFollowUp,
    submitQuestionAnswers,
    hasPendingQuestion,
    acceptPlan,
    rejectPlan,
    hasPendingPlan,
    pendingPlanActivity,
    isBusy,
    isBootstrapping,
    isSubmitting,
    contextUsage,
    contextUsageLoading,
    requestContextUsageReport,
  } = useAgentPaneSession({
    tab,
    projectPath,
    isRuntimeActive,
    isVisible,
    onPtyCreated,
    onPtyLost,
    onTurnsChange: handleTurnsChange,
    onAppendDraft: appendDraft,
    onRestoreDraft: restoreDraft,
  });

  useEffect(() => {
    if (!isFocused || !isVisible) {
      return;
    }

    inputRef.current?.focus();
  }, [isFocused, isVisible]);

  const handleMouseDown = useCallback(() => {
    onFocusPane();
  }, [onFocusPane]);

  const handleSubmit = useCallback(
    (value: string) => {
      return submitPrompt(value);
    },
    [submitPrompt],
  );

  const handleRejectPlan = useCallback(
    (activityId: string) => {
      const accepted = rejectPlan(activityId);

      if (accepted) {
        inputRef.current?.focus();
      }

      return accepted;
    },
    [rejectPlan],
  );

  const emptyState = useMemo(
    () => (
      <EmptyState
        icon={Bot}
        title='Agent pronto'
        message='Descreva o que você quer fazer neste projeto'
        compact
      />
    ),
    [],
  );

  return (
    <div
      className={`agent-view workspace-pane workspace-pane--agent agent-view--${terminalAgent}`}
      style={{ '--agent-accent': agentConfig.promptColor } as CSSProperties}
      onMouseDown={handleMouseDown}
    >
      <div className='agent-view__transcript' ref={transcriptRef}>
        {turns.length === 0 ? (
          <div className='agent-view__empty'>{emptyState}</div>
        ) : (
          <AgentTranscript
            turns={turns}
            scrollContainerRef={transcriptRef}
            scrollKey={tab.id}
            editingTurnId={editingTurnId}
            projectId={projectId}
            projectPath={projectPath}
            paneId={tab.id}
            onEdit={editAgentTurn}
            onRedo={redoAgentTurn}
            onSubmitQuestion={submitQuestionAnswers}
          />
        )}
      </div>

      <div
        className={`agent-view__footer${turns.length === 0 ? ' agent-view__footer--idle' : ''}${hasPendingPlan ? ' agent-view__footer--plan-pending' : ''}${editingTurnId ? ' agent-view__footer--editing' : ''}`}
      >
        <div className='agent-git-change-pill-slot'>
          <AgentGitChangePill projectId={projectId} paneId={tab.id} />
        </div>

        <AgentFollowUpQueue
          items={followUps}
          onEdit={editFollowUp}
          onSendNow={sendFollowUpNow}
          onRemove={removeFollowUp}
        />

        {turns.length === 0 ? (
          <div className='agent-view__idle-skills'>
            <AgentProjectSkillPills
              projectId={projectId}
              projectPath={projectPath}
              paneId={tab.id}
              alwaysVisible
            />
          </div>
        ) : null}

        {pendingPlanActivity && hasPendingPlan ? (
          <AgentPlanReviewDock
            activity={pendingPlanActivity}
            isBusy={isBusy}
            onAccept={acceptPlan}
            onReject={handleRejectPlan}
          />
        ) : null}

        <AgentComposer
          paneId={tab.id}
          projectPath={projectPath}
          terminalAgent={terminalAgent}
          isVisible={isVisible}
          isFocused={isFocused}
          isBusy={isBusy}
          isBootstrapping={isBootstrapping}
          isSubmitting={isSubmitting}
          inputRef={inputRef}
          draft={draft}
          contextUsage={contextUsage}
          contextUsageLoading={contextUsageLoading}
          onDraftChange={setDraft}
          onSubmit={handleSubmit}
          onStop={stopAgent}
          onRunCommand={runCommand}
          onRequestContextUsageReport={requestContextUsageReport}
          questionPending={hasPendingQuestion}
          planPending={hasPendingPlan}
          isEditing={Boolean(editingTurnId)}
          onCancelEdit={cancelAgentTurnEdit}
        />
      </div>
    </div>
  );
}

export const AgentView = memo(AgentViewComponent);

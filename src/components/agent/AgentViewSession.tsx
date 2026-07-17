import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { ArrowDown, Bot } from 'lucide-react';
import { AgentComposer } from '@/components/agent/AgentComposer';
import { AgentFollowUpQueue } from '@/components/agent/AgentFollowUpQueue';
import { AgentShellTerminalDock } from '@/components/agent/AgentShellTerminalDock';
import { AgentPlanReviewDock } from '@/components/agent/AgentPlanReviewDock';
import { AgentProjectSkillPills } from '@/components/agent/AgentProjectSkillPills';
import {
  AgentTranscript,
  type AgentTranscriptScrollControl,
} from '@/components/agent/AgentTranscript';
import { EmptyState } from '@/components/overlay/EmptyState';
import { useAgentPaneSession } from '@/hooks/useAgentPaneSession';
import { useAgentComposerDraftStore } from '@/stores/useAgentComposerDraftStore';
import { useProjectNotificationStore } from '@/stores/useProjectNotificationStore';
import { TERMINAL_AGENTS } from '@/constants/terminalAgents';
import type { AgentTurn } from '@/types';
import { cliAgentToTerminalAgent } from '@/utils/agentTabHelpers';
import { buildAgentPromptHistory } from '@/utils/agentPromptAttachments';
import { isHomeBoundAgentPane } from '@/utils/homeDashboardAgents';
import { isPaneAgentSessionLive, readPaneAgentSessionSnapshot, shouldPreferLocalAgentTurnHistory } from '@/utils/paneAgentSession';
import {
  resolveSanitizedAgentTab,
} from '@/utils/trimAgentTurnHistory';
import type { AgentViewProps } from '@/components/agent/AgentView';
function AgentViewSessionComponent({
  tab,
  projectId,
  projectPath,
  isVisible,
  isRuntimeActive,
  isFocused,
  disableStickyPrompt = false,
  onFocusPane,
  onPtyCreated,
  onPtyLost,
  onUpdateTab,
}: AgentViewProps) {
  const sessionTab = useMemo(() => resolveSanitizedAgentTab(tab), [tab]);

  const setPaneDraft = useAgentComposerDraftStore((state) => state.setDraft);
  const clearPaneDraft = useAgentComposerDraftStore((state) => state.clearDraft);
  const [draft, setDraft] = useState(
    () => useAgentComposerDraftStore.getState().getDraft(tab.id),
  );
  const [turns, setTurns] = useState<AgentTurn[]>(() => sessionTab.turns ?? []);
  const [isTranscriptAtBottom, setIsTranscriptAtBottom] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const transcriptScrollRef = useRef<AgentTranscriptScrollControl | null>(null);
  const previousTurnCountRef = useRef(sessionTab.turns?.length ?? 0);
  const terminalAgent = cliAgentToTerminalAgent(tab.cliAgent);
  const agentConfig = TERMINAL_AGENTS[terminalAgent];
  const promptHistory = useMemo(() => buildAgentPromptHistory(turns), [turns]);

  useEffect(() => {
    const incomingTurns = sessionTab.turns ?? [];
    const incomingTurnCount = incomingTurns.length;
    const hadTurnsBefore = previousTurnCountRef.current > 0;
    const sessionLive = isPaneAgentSessionLive(tab.id, readPaneAgentSessionSnapshot());
    const localRunning = turns.some((turn) => turn.running);

    if (incomingTurnCount === 0) {
      if (localRunning || sessionLive) {
        return;
      }

      previousTurnCountRef.current = 0;

      if (turns.length > 0) {
        setTurns([]);
      }

      if (hadTurnsBefore) {
        setDraft('');
        clearPaneDraft(tab.id);
      }

      return;
    }

    previousTurnCountRef.current = incomingTurnCount;

    if (localRunning) {
      return;
    }

    if (sessionLive) {
      return;
    }

    if (shouldPreferLocalAgentTurnHistory(turns, incomingTurns)) {
      return;
    }

    setTurns(incomingTurns);
  }, [clearPaneDraft, sessionTab.turns, tab.id, turns]);

  useEffect(() => {
    setIsTranscriptAtBottom(true);

    if (!isVisible || turns.length === 0) {
      return;
    }

    const pin = () => {
      transcriptScrollRef.current?.scrollToBottom({ smooth: false });
    };

    window.requestAnimationFrame(() => {
      pin();
      window.requestAnimationFrame(pin);
    });

    const timeoutIds = [0, 50, 150, 400].map((delay) => window.setTimeout(pin, delay));

    return () => {
      for (const timeoutId of timeoutIds) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isVisible, projectId, tab.id, turns.length]);

  const handleTranscriptAtBottomChange = useCallback((atBottom: boolean) => {
    setIsTranscriptAtBottom(atBottom);
  }, []);

  const handleScrollTranscriptToBottom = useCallback(() => {
    transcriptScrollRef.current?.scrollToBottom();
  }, []);

  const handleDraftChange = useCallback(
    (value: string) => {
      setDraft(value);

      if (value.trim()) {
        setPaneDraft(tab.id, projectId, value);
        return;
      }

      clearPaneDraft(tab.id);
    },
    [clearPaneDraft, projectId, setPaneDraft, tab.id],
  );

  const appendDraft = useCallback(
    (text: string) => {
      setDraft((prev) => {
        const next = prev + text;

        if (next.trim()) {
          setPaneDraft(tab.id, projectId, next);
        } else {
          clearPaneDraft(tab.id);
        }

        return next;
      });
      inputRef.current?.focus({ preventScroll: true });
    },
    [clearPaneDraft, projectId, setPaneDraft, tab.id],
  );

  const handleTurnsChange = useCallback(
    (nextTurns: AgentTurn[], options?: { persist?: boolean }) => {
      setTurns(nextTurns);

      if (options?.persist === false) {
        return;
      }

      onUpdateTab({ turns: nextTurns });
    },
    [onUpdateTab],
  );

  const restoreDraft = useCallback(
    (text: string) => {
      handleDraftChange(text);
      inputRef.current?.focus({ preventScroll: true });
    },
    [handleDraftChange],
  );

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
    tab: sessionTab,
    projectPath,
    isRuntimeActive,
    isVisible,
    onPtyCreated,
    onPtyLost,
    onTurnsChange: handleTurnsChange,
    onAppendDraft: appendDraft,
    onRestoreDraft: restoreDraft,
  });

  const clearNotificationForPane = useProjectNotificationStore(
    (state) => state.clearNotificationForPane,
  );
  const restoreProjectNotification = useProjectNotificationStore(
    (state) => state.restoreProjectNotification,
  );

  useEffect(() => {
    if (isHomeBoundAgentPane(projectId, tab.id)) {
      if (isFocused && isVisible) {
        clearNotificationForPane(tab.id);
      }

      return;
    }

    if (isVisible) {
      clearNotificationForPane(tab.id);
      return;
    }

    if (hasPendingQuestion || hasPendingPlan) {
      restoreProjectNotification(projectId, tab.id);
      return;
    }

    clearNotificationForPane(tab.id);
  }, [
    clearNotificationForPane,
    hasPendingPlan,
    hasPendingQuestion,
    isFocused,
    isVisible,
    projectId,
    restoreProjectNotification,
    tab.id,
  ]);

  const focusComposer = useCallback(() => {
    if (!isFocused || !isVisible || hasPendingQuestion || hasPendingPlan) {
      return;
    }

    inputRef.current?.focus({ preventScroll: true });
  }, [hasPendingPlan, hasPendingQuestion, isFocused, isVisible]);

  useEffect(() => {
    focusComposer();
  }, [focusComposer]);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target;

      if (!(target instanceof Element)) {
        onFocusPane();
        window.requestAnimationFrame(() => {
          if (!hasPendingQuestion && !hasPendingPlan) {
            inputRef.current?.focus({ preventScroll: true });
          }
        });
        return;
      }

      if (
        target.closest(
          'button, a, input, textarea, label, [role="menu"], [role="menuitem"], .context-menu',
        )
      ) {
        return;
      }

      onFocusPane();
      window.requestAnimationFrame(() => {
        if (!hasPendingQuestion && !hasPendingPlan) {
          inputRef.current?.focus({ preventScroll: true });
        }
      });
    },
    [hasPendingPlan, hasPendingQuestion, onFocusPane],
  );

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
        inputRef.current?.focus({ preventScroll: true });
      }

      return accepted;
    },
    [rejectPlan],
  );

  const showScrollToBottom = turns.length > 0 && !isTranscriptAtBottom;

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
      <div className='agent-view__transcript-shell'>
        <div className='agent-view__transcript' ref={transcriptRef}>
          {turns.length === 0 ? (
            <div className='agent-view__empty'>{emptyState}</div>
          ) : (
            <AgentTranscript
              turns={turns}
              scrollContainerRef={transcriptRef}
              scrollControlRef={transcriptScrollRef}
              scrollKey={`${projectId}:${tab.id}`}
              editingTurnId={editingTurnId}
              projectId={projectId}
              projectPath={projectPath}
              paneId={tab.id}
              disableStickyPrompt={disableStickyPrompt}
              onAtBottomChange={handleTranscriptAtBottomChange}
              onEdit={editAgentTurn}
              onRedo={redoAgentTurn}
              onSubmitQuestion={submitQuestionAnswers}
            />
          )}
        </div>
        {showScrollToBottom ? (
          <button
            type='button'
            className='agent-view__scroll-to-bottom app-button app-button--enter'
            aria-label='Descer até o fim'
            onClick={handleScrollTranscriptToBottom}
          >
            <ArrowDown size={16} strokeWidth={2.25} aria-hidden='true' />
          </button>
        ) : null}
      </div>

      <div
        className={`agent-view__footer${turns.length === 0 ? ' agent-view__footer--idle' : ''}${hasPendingPlan ? ' agent-view__footer--plan-pending' : ''}${editingTurnId ? ' agent-view__footer--editing' : ''}`}
      >
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
            onAccept={acceptPlan}
            onReject={handleRejectPlan}
          />
        ) : null}

        <AgentShellTerminalDock
          agentPaneId={tab.id}
          projectPath={projectPath}
          onComposerFocus={focusComposer}
        />

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
          promptHistory={promptHistory}
          onDraftChange={handleDraftChange}
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

export const AgentViewSession = memo(AgentViewSessionComponent);

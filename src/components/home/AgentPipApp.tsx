import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowDown, Bot, Maximize2, Pin } from 'lucide-react';
import { AgentComposer } from '@/components/agent/AgentComposer';
import { AgentFollowUpQueue } from '@/components/agent/AgentFollowUpQueue';
import { AgentPlanReviewDock } from '@/components/agent/AgentPlanReviewDock';
import { AgentProjectSkillPills } from '@/components/agent/AgentProjectSkillPills';
import { AgentPromptRail } from '@/components/agent/AgentPromptRail';
import {
  AgentTranscript,
  type AgentTranscriptScrollControl,
} from '@/components/agent/AgentTranscript';
import { CloudAgentTurnView } from '@/components/home/HomeDashboardCloudAgentCard';
import { EmptyState } from '@/components/overlay/EmptyState';
import { TERMINAL_AGENTS } from '@/constants/terminalAgents';
import { useMarkdownPreviewCmdLinks } from '@/hooks/useMarkdownPreviewCmdLinks';
import { useAgentComposerDraftStore } from '@/stores/useAgentComposerDraftStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTerminalPasteImageStore } from '@/stores/useTerminalPasteImageStore';
import type { AgentPipSnapshot } from '@/types/agentPip';
import type {
  AgentFollowUp,
  AgentPromptAttachment,
  AgentQuestionAnswers,
  AgentTurn,
  Project,
} from '@/types';
import { registerAgentPaneHandlers } from '@/utils/agentPaneRegistry';
import { findPendingAgentPlanActivity } from '@/utils/agentPlanPrompt';
import { hasPendingAgentQuestion } from '@/utils/agentQuestionPrompt';
import { buildAgentPromptHistory } from '@/utils/agentPromptAttachments';
import { resolveFollowUpAgentPrompt } from '@/utils/agentSkillDisplay';
import { cliAgentToTerminalAgent } from '@/utils/agentTabHelpers';
import { createInitialTurnActivities } from '@/utils/agentTranscriptParser';

function snapshotPipAttachments(paneId: string): AgentPromptAttachment[] {
  const images = useTerminalPasteImageStore.getState().imagesByPane[paneId] ?? [];

  return images.map((image) => ({
    id: String(image.id),
    label: image.label,
    dataUrl: image.dataUrl,
    relativePath: image.relativePath,
  }));
}

function followUpMatchKey(item: AgentFollowUp): string {
  return `${item.content}\0${item.attachments.length}\0${item.skillLabel ?? ''}`;
}

function mergePipFollowUps(
  snapshotItems: AgentFollowUp[],
  optimisticItems: AgentFollowUp[],
): AgentFollowUp[] {
  const keys = new Set(snapshotItems.map(followUpMatchKey));
  return [...snapshotItems, ...optimisticItems.filter((item) => !keys.has(followUpMatchKey(item)))];
}

function createOptimisticPipTurn(content: string, attachments: AgentPromptAttachment[]): AgentTurn {
  return {
    id: `pip-${crypto.randomUUID()}`,
    user: {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt: Date.now(),
      ...(attachments.length > 0 ? { attachments } : {}),
    },
    activities: createInitialTurnActivities(),
    running: true,
    startedAt: Date.now(),
  };
}

function mergePipTurns(snapshotTurns: AgentTurn[], optimisticTurn: AgentTurn | null): AgentTurn[] {
  if (!optimisticTurn) {
    return snapshotTurns;
  }

  if (
    snapshotTurns.some((turn) => turn.running || turn.user.content === optimisticTurn.user.content)
  ) {
    return snapshotTurns;
  }

  return [...snapshotTurns, optimisticTurn];
}

function hydratePipProject(slice: AgentPipSnapshot['project']): void {
  if (!slice) {
    return;
  }

  const store = useProjectStore.getState();
  const existing = store.projects.find((project) => project.id === slice.id);

  if (existing) {
    if (existing.agentResponseSkills === slice.agentResponseSkills) {
      return;
    }

    useProjectStore.setState({
      projects: store.projects.map((project) =>
        project.id === slice.id
          ? { ...project, agentResponseSkills: slice.agentResponseSkills }
          : project,
      ),
    });
    return;
  }

  const stub: Project = {
    id: slice.id,
    name: slice.name,
    path: slice.path,
    workspaceId: '',
    color: slice.color,
    icon: slice.icon,
    iconCustomized: false,
    logo: slice.logo,
    tabs: [],
    activeTabId: null,
    activePaneId: null,
    sidebarCollapsed: false,
    agentResponseSkills: slice.agentResponseSkills,
  };

  useProjectStore.setState({
    projects: [...store.projects, stub],
  });
}

function AgentPipAppComponent() {
  useMarkdownPreviewCmdLinks();
  const [snapshot, setSnapshot] = useState<AgentPipSnapshot | null>(null);
  const [draft, setDraft] = useState('');
  const [optimisticFollowUps, setOptimisticFollowUps] = useState<AgentFollowUp[]>([]);
  const [optimisticTurn, setOptimisticTurn] = useState<AgentTurn | null>(null);
  const [isTranscriptAtBottom, setIsTranscriptAtBottom] = useState(true);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const transcriptScrollRef = useRef<AgentTranscriptScrollControl | null>(null);
  const seededPaneIdRef = useRef<string | null>(null);
  const snapshotRevisionRef = useRef(0);
  const setPaneDraft = useAgentComposerDraftStore((state) => state.setDraft);
  const clearPaneDraft = useAgentComposerDraftStore((state) => state.clearDraft);

  useEffect(() => {
    document.documentElement.classList.add('agent-pip');
    document.body.classList.add('agent-pip');

    void window.nexus.agentPip.getSnapshot().then((next) => {
      if (next) {
        snapshotRevisionRef.current = next.revision ?? 0;
        setSnapshot(next);
      }
    });

    return window.nexus.agentPip.onSnapshot((next) => {
      const revision = next.revision ?? 0;
      if (revision > 0 && revision < snapshotRevisionRef.current) {
        return;
      }

      snapshotRevisionRef.current = revision;
      setSnapshot(next);
    });
  }, []);

  useEffect(() => {
    hydratePipProject(snapshot?.project ?? null);
  }, [snapshot?.project]);

  useEffect(() => {
    if (!snapshot || snapshot.kind !== 'desktop' || !snapshot.tab) {
      return;
    }

    return registerAgentPaneHandlers(snapshot.tab.id, {
      submit: (prompt, options) =>
        window.nexus.agentPip.command({
          type: 'submit',
          paneId: snapshot.tab!.id,
          prompt,
          options,
        }),
      stop: () => {
        void window.nexus.agentPip.command({
          type: 'stop',
          paneId: snapshot.tab!.id,
        });
        return true;
      },
      write: (text) => {
        void window.nexus.agentPip.command({
          type: 'write',
          paneId: snapshot.tab!.id,
          text,
        });
        return true;
      },
      runCommand: (command) => {
        void window.nexus.agentPip.command({
          type: 'runCommand',
          paneId: snapshot.tab!.id,
          command,
        });
        return true;
      },
      redo: (turnId) =>
        window.nexus.agentPip.command({
          type: 'redo',
          paneId: snapshot.tab!.id,
          turnId,
        }),
    });
  }, [snapshot]);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    if (seededPaneIdRef.current === snapshot.paneId) {
      return;
    }

    seededPaneIdRef.current = snapshot.paneId;
    setDraft(snapshot.draft);
    setOptimisticFollowUps([]);
    setOptimisticTurn(null);
  }, [snapshot]);

  const tab = snapshot?.tab ?? null;
  const snapshotTurns = useMemo<AgentTurn[]>(() => tab?.turns ?? [], [tab]);
  const turns = useMemo<AgentTurn[]>(
    () => mergePipTurns(snapshotTurns, optimisticTurn),
    [optimisticTurn, snapshotTurns],
  );
  const snapshotFollowUps = useMemo<AgentFollowUp[]>(() => {
    const fromSnapshot = snapshot?.followUps ?? [];
    const fromTab = snapshot?.tab?.followUps ?? [];
    return fromSnapshot.length >= fromTab.length ? fromSnapshot : fromTab;
  }, [snapshot]);
  const followUps = useMemo<AgentFollowUp[]>(
    () => mergePipFollowUps(snapshotFollowUps, optimisticFollowUps),
    [optimisticFollowUps, snapshotFollowUps],
  );
  const isBusy =
    Boolean(snapshot?.busy) || turns.some((turn) => turn.running) || Boolean(optimisticTurn);

  useEffect(() => {
    if (!optimisticTurn) {
      return;
    }

    if (
      snapshotTurns.some(
        (turn) => turn.running || turn.user.content === optimisticTurn.user.content,
      )
    ) {
      setOptimisticTurn(null);
      return;
    }

    if (
      snapshot &&
      !snapshot.busy &&
      !snapshotTurns.some((turn) => turn.running) &&
      snapshotTurns.some((turn) => turn.startedAt >= optimisticTurn.startedAt)
    ) {
      setOptimisticTurn(null);
    }
  }, [optimisticTurn, snapshot, snapshotTurns]);

  useEffect(() => {
    if (optimisticFollowUps.length === 0) {
      return;
    }

    const keys = new Set(snapshotFollowUps.map(followUpMatchKey));
    setOptimisticFollowUps((current) => {
      const next = current.filter((item) => !keys.has(followUpMatchKey(item)));
      return next.length === current.length ? current : next;
    });
  }, [optimisticFollowUps.length, snapshotFollowUps]);

  const cloudTurns = snapshot?.cloudTurns ?? [];
  const projectId = snapshot?.projectId ?? '';
  const projectPath = snapshot?.projectPath ?? '';
  const title = snapshot?.projectName ?? 'Agent';
  const terminalAgent = cliAgentToTerminalAgent(tab?.cliAgent ?? 'cursor-agent');
  const agentConfig = TERMINAL_AGENTS[terminalAgent];
  const promptHistory = useMemo(() => buildAgentPromptHistory(turns), [turns]);
  const pendingPlanActivity = useMemo(() => {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const found = findPendingAgentPlanActivity(turns[index]!.activities);
      if (found) {
        return found;
      }
    }

    return undefined;
  }, [turns]);
  const hasPendingPlan = Boolean(pendingPlanActivity);
  const hasPendingQuestion = turns.some((turn) => hasPendingAgentQuestion(turn.activities));
  const showScrollToBottom = turns.length > 0 && !isTranscriptAtBottom;

  const runCommand = useCallback(
    async (type: Parameters<typeof window.nexus.agentPip.command>[0]['type'], extra?: object) => {
      if (!tab) {
        return false;
      }

      return window.nexus.agentPip.command({ type, paneId: tab.id, ...extra } as never);
    },
    [tab],
  );

  const handleDraftChange = useCallback(
    (value: string) => {
      setDraft(value);

      if (!tab || !projectId) {
        return;
      }

      if (value.trim()) {
        setPaneDraft(tab.id, projectId, value);
        return;
      }

      clearPaneDraft(tab.id);
    },
    [clearPaneDraft, projectId, setPaneDraft, tab],
  );

  const handleSubmit = useCallback(
    async (value: string) => {
      if (!tab) {
        return false;
      }

      const attachments = snapshotPipAttachments(tab.id);
      const queued = isBusy;
      const optimistic: AgentFollowUp | null = queued
        ? {
            id: crypto.randomUUID(),
            content: value,
            attachments,
            createdAt: Date.now(),
          }
        : null;

      if (optimistic) {
        setOptimisticFollowUps((current) => [...current, optimistic]);
        useTerminalPasteImageStore.getState().clearPaneImages(tab.id);
      } else {
        setOptimisticTurn(createOptimisticPipTurn(value, attachments));
        useTerminalPasteImageStore.getState().clearPaneImages(tab.id);
      }

      setIsTranscriptAtBottom(true);
      transcriptScrollRef.current?.scrollToBottom({ smooth: false });

      const ok = await window.nexus.agentPip.command({
        type: 'submit',
        paneId: tab.id,
        prompt: value,
        ...(attachments.length > 0 ? { options: { attachments } } : {}),
      });

      if (!ok && optimistic) {
        setOptimisticFollowUps((current) => current.filter((item) => item.id !== optimistic.id));
      }

      if (!ok && !optimistic) {
        setOptimisticTurn(null);
      }

      return ok;
    },
    [isBusy, tab],
  );

  const handleTranscriptAtBottomChange = useCallback((atBottom: boolean) => {
    setIsTranscriptAtBottom(atBottom);
  }, []);

  const handleActiveTurnChange = useCallback((turnId: string | null) => {
    setActiveTurnId(turnId);
  }, []);

  const handleScrollTranscriptToBottom = useCallback(() => {
    transcriptScrollRef.current?.scrollToBottom();
  }, []);

  const handleSelectPromptTurn = useCallback((turnId: string) => {
    transcriptScrollRef.current?.scrollToTurn(turnId);
  }, []);

  const handleSubmitQuestion = useCallback(
    (activityId: string, answers: AgentQuestionAnswers) => {
      if (!tab) {
        return false;
      }

      return window.nexus.agentPip.command({
        type: 'question',
        paneId: tab.id,
        activityId,
        answers,
      });
    },
    [tab],
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

  const ackViewed = useCallback(() => {
    if (!snapshot?.paneId) {
      return;
    }

    void window.nexus.agentPip.command({
      type: 'ackViewed',
      paneId: snapshot.paneId,
    });
  }, [snapshot?.paneId]);

  useEffect(() => {
    const onFocus = () => {
      ackViewed();
    };

    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [ackViewed]);

  return (
    <section
      className={`agent-pip-window home-dashboard--maestro home-dashboard--maestro-dense${snapshot?.pinging ? ' agent-pip-window--ping' : ''}`}
      aria-label={`PiP ${title}`}
      style={{ ['--agent-accent' as string]: snapshot?.projectColor ?? agentConfig.promptColor }}
      onPointerDown={ackViewed}
    >
      <header className='agent-pip-window__header'>
        <span className='agent-pip-window__thumb'>
          {snapshot?.logoDataUrl ? (
            <img
              src={snapshot.logoDataUrl}
              alt=''
              className='agent-pip-window__logo'
              draggable={false}
            />
          ) : (
            <span
              className='agent-pip-window__mark'
              style={{ background: snapshot?.projectColor ?? '#2563eb' }}
            />
          )}
          {snapshot?.pinging ? (
            <span
              className='project-item__ping project-item__ping--red agent-pip-window__ping'
              aria-hidden='true'
            />
          ) : null}
        </span>
        <span className='agent-pip-window__title'>{title}</span>
        <div className='agent-pip-window__actions'>
          <button
            type='button'
            className='agent-pip-window__focus app-button app-button--enter'
            aria-label='Voltar ao Nexus'
            title='Voltar ao Nexus'
            onClick={() => {
              void window.nexus.agentPip.focusMain();
            }}
          >
            <Maximize2 size={14} strokeWidth={2.25} aria-hidden='true' />
          </button>
          <button
            type='button'
            className='agent-pip-window__unpin app-button app-button--enter'
            aria-label='Desafixar agent'
            onClick={() => {
              void window.nexus.agentPip.unpin();
            }}
          >
            <Pin size={14} strokeWidth={2.25} fill='currentColor' />
          </button>
        </div>
      </header>
      <div className='agent-pip-window__body home-dashboard__agent-card-body'>
        {snapshot?.kind === 'cloud' ? (
          <div
            className='agent-view'
            style={{ ['--agent-accent' as string]: snapshot.projectColor }}
          >
            <div className='agent-view__transcript-shell'>
              <div className='agent-view__transcript' ref={transcriptRef}>
                {cloudTurns.length === 0 ? (
                  <div className='agent-view__empty'>{emptyState}</div>
                ) : (
                  cloudTurns.map((turn) => (
                    <CloudAgentTurnView
                      key={turn.id}
                      turn={turn}
                      projectPath={snapshot.projectPath}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        ) : tab ? (
          <div
            className={`agent-view workspace-pane workspace-pane--agent agent-view--${terminalAgent}`}
            style={{ '--agent-accent': agentConfig.promptColor } as CSSProperties}
          >
            <div className='agent-view__transcript-shell'>
              {turns.length > 1 ? (
                <AgentPromptRail
                  turns={turns}
                  activeTurnId={activeTurnId}
                  projectPath={projectPath}
                  onSelectTurn={handleSelectPromptTurn}
                />
              ) : null}
              <div className='agent-view__transcript' ref={transcriptRef}>
                {turns.length === 0 ? (
                  <div className='agent-view__empty'>{emptyState}</div>
                ) : (
                  <AgentTranscript
                    turns={turns}
                    scrollContainerRef={transcriptRef}
                    scrollControlRef={transcriptScrollRef}
                    scrollKey={`${projectId}:${tab.id}`}
                    projectId={projectId}
                    projectPath={projectPath}
                    paneId={tab.id}
                    disableStickyPrompt
                    onAtBottomChange={handleTranscriptAtBottomChange}
                    onActiveTurnChange={handleActiveTurnChange}
                    onEdit={(turnId) => {
                      void runCommand('editTurn', { turnId });
                    }}
                    onRedo={(turnId) => runCommand('redo', { turnId })}
                    onSubmitQuestion={handleSubmitQuestion}
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
                  <ArrowDown size={16} strokeWidth={2.25} />
                </button>
              ) : null}
            </div>
            <div
              className={`agent-view__footer${turns.length === 0 ? ' agent-view__footer--idle' : ''}${hasPendingPlan ? ' agent-view__footer--plan-pending' : ''}`}
            >
              <AgentFollowUpQueue
                items={followUps}
                onEdit={(id) => {
                  const item = followUps.find((entry) => entry.id === id);
                  if (item) {
                    handleDraftChange(resolveFollowUpAgentPrompt(item));
                  }
                  const inSnapshot = snapshotFollowUps.some((entry) => entry.id === id);
                  setOptimisticFollowUps((current) => current.filter((entry) => entry.id !== id));
                  if (inSnapshot) {
                    void runCommand('editFollowUp', { id });
                  }
                }}
                onSendNow={(id) => {
                  void runCommand('sendFollowUpNow', { id });
                }}
                onRemove={(id) => {
                  const inSnapshot = snapshotFollowUps.some((entry) => entry.id === id);
                  setOptimisticFollowUps((current) => current.filter((entry) => entry.id !== id));
                  if (inSnapshot) {
                    void runCommand('removeFollowUp', { id });
                  }
                }}
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
                  onAccept={(activityId) => runCommand('acceptPlan', { activityId })}
                  onReject={(activityId) => {
                    void runCommand('rejectPlan', { activityId });
                    return true;
                  }}
                />
              ) : null}
              <AgentComposer
                paneId={tab.id}
                projectPath={projectPath}
                terminalAgent={terminalAgent}
                isVisible
                isFocused
                isBusy={isBusy}
                isBootstrapping={false}
                isSubmitting={false}
                inputRef={inputRef}
                draft={draft}
                contextUsage={snapshot?.contextUsage ?? null}
                contextUsageLoading={false}
                promptHistory={promptHistory}
                followUpCount={followUps.length}
                onDraftChange={handleDraftChange}
                onSubmit={handleSubmit}
                onFlushNextFollowUp={() => {
                  void runCommand('flushFollowUp');
                  return true;
                }}
                onStop={() => {
                  void runCommand('stop');
                  return true;
                }}
                onRunCommand={(command) => {
                  void runCommand('runCommand', { command });
                  return true;
                }}
                onRequestContextUsageReport={() => undefined}
                questionPending={hasPendingQuestion}
                planPending={hasPendingPlan}
              />
            </div>
          </div>
        ) : (
          <EmptyState icon={Pin} message='Saiu do Nexus, o agent fica neste canto.' compact />
        )}
      </div>
    </section>
  );
}

export const AgentPipApp = memo(AgentPipAppComponent);

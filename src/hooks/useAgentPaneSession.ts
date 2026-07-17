import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractCliAgentCommand } from '@/constants/cliAgentCommands';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { useTerminalPasteImageStore } from '@/stores/useTerminalPasteImageStore';
import {
  isAgentSkillSlashCommand,
  resolveFollowUpAgentPrompt,
  resolveFollowUpEnqueueFields,
} from '@/utils/agentSkillDisplay';
import type { AutomationAgentMode } from '@/constants/agentModes';
import type { AgentActivity, AgentFollowUp, AgentPromptAttachment, AgentPromptSubmitOptions, AgentQuestionAnswers, AgentTab, AgentTurn, AgentUserMessage } from '@/types';
import { registerAgentPaneHandlers } from '@/utils/agentPaneRegistry';
import { registerAgentPrintPaneHandlers } from '@/utils/agentPrintBridge';
import { recordHomeDashboardActivity } from '@/utils/recordHomeDashboardActivity';
import { cliAgentToTerminalAgent, resolveAgentTabCli } from '@/utils/agentTabHelpers';
import { revertAgentGitChangesForTurn, trackAgentGitPrompt } from '@/utils/agentGitTurn';
import {
  feedMobileReleaseOutput,
  finalizeMobileReleasesForPane,
  handleMobileReleaseShellToolEvents,
  startMobileReleaseFromCommand,
} from '@/utils/mobileReleaseTracker';
import {
  handleAgentShellToolTerminalEvents,
  shouldOpenAgentShellToolTerminal,
} from '@/utils/agentShellToolTerminal';
import { isAgentSetupCommand } from '@/utils/parseAgentModeCommand';
import { shouldMarkAgentAwaiting } from '@/utils/projectAgentStatus';
import { cleanAgentPtyChunk } from '@/utils/stripAnsi';
import {
  createAgentTranscriptParserState,
  createInitialTurnActivities,
  detectSlashAutocompleteInTail,
  feedAgentTranscriptChunk,
  finalizeAgentTurn,
  rebuildTurnFromAgentOutput,
} from '@/utils/agentTranscriptParser';
import {
  createAgentReadyStreamDetector,
  detectAgentFollowUpReadyInChunk,
  detectAgentReadyInChunk,
  isPaneTrackingAgentCompletion,
  resetAgentReadyDetectors,
  syncAgentBusyFromTail,
} from '@/utils/terminalTaskCompletion';
import { attachAgentPromptImageToPane } from '@/utils/attachAgentPromptImage';
import { buildImagePathReference } from '@/utils/terminalPasteImageTokens';
import {
  buildAgentPaneLaunchCommand,
  detectAgentLaunchErrorInTail,
  detectSmartModeApprovalInTail,
  isCursorAgentStreamJsonCli,
  resolveCursorAgentPrintMode,
  sendAgentInterruptSequence,
} from '@/utils/agentCliSession';
import {
  createAgentStreamJsonParserState,
  clearStreamJsonLiveStatus,
  feedAgentStreamJsonChunk,
  finalizeStreamJsonTurn,
  forceSettleStreamJsonInFlightWork,
  hasMeaningfulStreamJsonTurnOutput,
  hasPendingStreamJsonInteraction,
  isAgentStreamJsonStateAwaitingCompletion,
  resolveStreamJsonStallLiveStatus,
  tryMarkStreamJsonReadyToFinalize,
  upsertStreamJsonLiveStatus,
} from '@/utils/agentStreamJsonParser';
import {
  buildAgentPlanImplementPrompt,
  finalizeBuildingAgentPlans,
  findPendingAgentPlanActivity,
  hasBuildingAgentPlans,
  hasPendingAgentPlan,
  parsePlanTodosFromMarkdown,
  repairStaleBuildingAgentPlans,
  resolvePlanBodyFromUri,
} from '@/utils/agentPlanPrompt';
import {
  buildAgentQuestionAnswerPrompt,
  hasPendingAgentQuestion,
  isAgentQuestionAnswerComplete,
} from '@/utils/agentQuestionPrompt';
import { waitForActiveAgent, waitForAgentPaneReady } from '@/utils/waitForAgentPaneReady';
import { resolveAgentPaneRootPath } from '@/utils/agentTabHelpers';
import { resolvePromptDisplayContent, resolveSubmitAgentUserMessage } from '@/utils/agentPromptAttachments';
import { createNexusCwdStreamParser } from '@/utils/terminalCwd';
import {
  buildAgentContextUsageFromStreamJsonUsage,
  mergeAgentContextUsageSnapshots,
  parseAgentContextUsageFromTail,
  type AgentContextUsageSnapshot,
  type AgentStreamJsonTokenUsage,
} from '@/utils/agentContextUsageParser';
import { trimAgentTurnHistory, sanitizeAgentTurnHistory } from '@/utils/trimAgentTurnHistory';
import { shouldPreferLocalAgentTurnHistory } from '@/utils/paneAgentSession';
import { writeDebugSessionLog } from '@/utils/debugSessionLog';
import { useToastStore } from '@/stores/useToastStore';
import { isAgentTurnSummaryVisible } from '@/utils/agentTurnSummary';

const LAUNCH_COMMAND_DELAY_MS = 350;
const PLAN_BODY_RESOLVE_MAX_ATTEMPTS = 8;
const PLAN_BODY_RESOLVE_BASE_DELAY_MS = 250;
const PROMPT_CLEAR_DELAY_MS = 50;
const PTY_CLEAR_INPUT = '\x15';
const STUCK_TURN_TIMEOUT_MS = 45_000;
const STUCK_TURN_CHECK_MS = 5_000;
const STREAM_JSON_ORPHAN_FINALIZE_MS = 2_000;
const STREAM_JSON_INCOMPLETE_ORPHAN_FINALIZE_MS = 120_000;
const STREAM_JSON_ABSOLUTE_MAX_MS = 600_000;
const STREAM_JSON_DEAD_PROCESS_FINALIZE_MS = 2_000;
const STREAM_JSON_IDLE_CHECK_MS = 500;
const STREAM_JSON_RESPONSE_IDLE_FINALIZE_MS = 700;
const STREAM_JSON_STALL_UI_MS = 4_000;
const STREAM_JSON_LONG_SHELL_HANDOFF_MS = 45_000;
const STREAM_JSON_STARTUP_GRACE_MS = 45_000;
const APPROVAL_CONFIRM_DELAY_MS = 450;
const SUBMIT_GATE_TIMEOUT_MS = 20_000;
const SUBMIT_SETUP_TIMEOUT_MS = 8_000;
const COMPOSER_READY_POLL_MS = 250;
const COMPOSER_READY_MAX_MS = 12_000;
const STREAM_JSON_AUTO_RETRY_DELAY_MS = 600;
const STREAMING_TURNS_UI_MS = 200;
const PERSIST_TURNS_DEBOUNCE_MS = 1200;
const CONTEXT_USAGE_REPORT_DELAY_MS = 700;
const AGENT_OUTPUT_TAIL_SIZE = 8192;
const AGENT_TURN_OUTPUT_MAX = 512 * 1024;

function resolveAgentPaneActiveWorkload(paneId: string, hasRunningTurn: boolean): boolean {
  const session = useTerminalSessionStore.getState();

  return (
    hasRunningTurn ||
    Boolean(session.awaitingResponseByPane[paneId]) ||
    Boolean(session.agentPrintRunTokenByPane[paneId])
  );
}

interface UseAgentPaneSessionOptions {
  tab: AgentTab;
  projectPath: string;
  isRuntimeActive: boolean;
  isVisible: boolean;
  onPtyCreated: (ptyId: string) => void;
  onPtyLost: () => void;
  onTurnsChange: (turns: AgentTurn[], options?: { persist?: boolean }) => void;
  onAppendDraft?: (text: string) => void;
  onRestoreDraft?: (text: string) => void;
}

function snapshotAttachments(paneId: string): AgentPromptAttachment[] {
  const images = useTerminalPasteImageStore.getState().imagesByPane[paneId] ?? [];

  return images.map((image) => ({
    id: String(image.id),
    label: image.label,
    dataUrl: image.dataUrl,
    relativePath: image.relativePath,
  }));
}

function resolvePaneAgentMode(paneId: string): AutomationAgentMode {
  return useTerminalSessionStore.getState().activeAgentModeByPane[paneId] ?? 'agent';
}

function createUserMessage(
  content: string,
  attachments: AgentPromptAttachment[],
  mode: AutomationAgentMode,
  options?: { agentPrompt?: string; skillLabel?: string },
): AgentUserMessage {
  const agentPrompt = options?.agentPrompt?.trim();

  return {
    id: crypto.randomUUID(),
    role: 'user',
    content,
    createdAt: Date.now(),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(mode !== 'agent' ? { mode } : {}),
    ...(agentPrompt ? { agentPrompt } : {}),
    ...(options?.skillLabel ? { skillLabel: options.skillLabel } : {}),
  };
}

function createTurn(user: AgentUserMessage): AgentTurn {
  return {
    id: crypto.randomUUID(),
    user,
    activities: createInitialTurnActivities(),
    running: true,
    startedAt: Date.now(),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function createFailedPromptActivity(message?: string): AgentActivity {
  return {
    id: crypto.randomUUID(),
    kind: 'status',
    label: message ?? 'Não foi possível enviar o prompt — tente novamente',
    createdAt: Date.now(),
  };
}

export function useAgentPaneSession({
  tab,
  projectPath,
  isRuntimeActive,
  isVisible,
  onPtyCreated,
  onPtyLost,
  onTurnsChange,
  onAppendDraft,
  onRestoreDraft,
}: UseAgentPaneSessionOptions) {
  const ptyIdRef = useRef<string | null>(tab.ptyId);
  const creatingRef = useRef(false);
  const turnsRef = useRef<AgentTurn[]>(sanitizeAgentTurnHistory(tab.turns ?? []));
  const parserStateRef = useRef(createAgentTranscriptParserState());
  const streamJsonStateRef = useRef(createAgentStreamJsonParserState());
  const cursorAgentContinueRef = useRef(false);
  const agentPrintRunActiveRef = useRef(false);
  const agentPrintRunTokenRef = useRef('');
  const hasStreamJsonChunkRef = useRef(false);
  const lastStreamJsonChunkAtRef = useRef(Date.now());
  const outputTailRef = useRef('');
  const onTurnsChangeRef = useRef(onTurnsChange);
  const onPtyCreatedRef = useRef(onPtyCreated);
  const onPtyLostRef = useRef(onPtyLost);
  const onAppendDraftRef = useRef(onAppendDraft);
  const onRestoreDraftRef = useRef(onRestoreDraft);
  const paneIdRef = useRef(tab.id);
  const deferAutoSpawnRef = useRef(
    (tab.turns?.length ?? 0) > 0 && !tab.turns?.some((turn) => turn.running),
  );
  const agentRootPath = useMemo(() => resolveAgentPaneRootPath(projectPath), [projectPath]);
  const isVisibleRef = useRef(isVisible);
  const isRuntimeActiveRef = useRef(isRuntimeActive);
  const pendingSetupRef = useRef<Promise<void> | null>(null);
  const submitInFlightRef = useRef(false);
  const submitAbortRef = useRef(false);
  const approvalConfirmTimerRef = useRef<number | null>(null);
  const approvalConfirmedTurnRef = useRef<string | null>(null);
  const turnOutputStartRef = useRef(0);
  const turnOutputBufferRef = useRef('');
  const submitTimeoutRef = useRef<number | null>(null);
  const cwdParserRef = useRef(createNexusCwdStreamParser(() => {}));
  const streamJsonAutoRetryRef = useRef(false);
  const tryScheduleStreamJsonAutoRetryRef = useRef<(finishAgentPrintRun: () => void) => boolean>(
    () => false,
  );
  const streamJsonBootstrappedRef = useRef(false);
  const streamJsonSettleTimerRef = useRef<number | null>(null);
  const streamJsonStallLabelRef = useRef('');
  const stalePtyClearedRef = useRef<string | null>(null);

  const [activePtyId, setActivePtyId] = useState<string | null>(tab.ptyId ?? null);
  const [isAgentReady, setIsAgentReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [contextUsage, setContextUsage] = useState<AgentContextUsageSnapshot | null>(null);
  const [contextUsageLoading, setContextUsageLoading] = useState(false);
  const contextUsageReportTimerRef = useRef<number | null>(null);
  const contextUsageReportPendingRef = useRef(false);
  const [turnsRevision, setTurnsRevision] = useState(0);
  const [followUps, setFollowUps] = useState<AgentFollowUp[]>([]);
  const [editingTurnId, setEditingTurnId] = useState<string | null>(null);
  const editingTurnIdRef = useRef<string | null>(null);
  const followUpsRef = useRef<AgentFollowUp[]>([]);
  const suppressFollowUpFlushRef = useRef(false);
  const promotePendingFollowUpTurnRef = useRef<() => void>(() => {});
  const tryFlushFollowUpQueueRef = useRef<
    (options?: { force?: boolean; onlyId?: string }) => boolean
  >(() => false);

  paneIdRef.current = tab.id;
  isVisibleRef.current = isVisible;
  isRuntimeActiveRef.current = isRuntimeActive;
  onTurnsChangeRef.current = onTurnsChange;
  onPtyCreatedRef.current = onPtyCreated;
  onPtyLostRef.current = onPtyLost;
  onAppendDraftRef.current = onAppendDraft;
  onRestoreDraftRef.current = onRestoreDraft;
  followUpsRef.current = followUps;

  useEffect(() => {
    deferAutoSpawnRef.current =
      (tab.turns?.length ?? 0) > 0 && !tab.turns?.some((turn) => turn.running);
  }, [tab.id, tab.turns]);

  const usesStreamJson = useMemo(
    () => isCursorAgentStreamJsonCli(resolveAgentTabCli(tab)),
    [tab.cliAgent, tab.restoreCommand],
  );

  const resolveAgentPrintRunToken = useCallback((paneId: string) => {
    return (
      agentPrintRunTokenRef.current ||
      useTerminalSessionStore.getState().agentPrintRunTokenByPane[paneId] ||
      ''
    );
  }, []);

  const markStreamJsonTurnStarted = useCallback(() => {
    hasStreamJsonChunkRef.current = false;
    lastStreamJsonChunkAtRef.current = Date.now();
  }, []);

  const bindAgentPrintRunToken = useCallback((paneId: string, runToken: string) => {
    agentPrintRunTokenRef.current = runToken;
    agentPrintRunActiveRef.current = true;
    hasStreamJsonChunkRef.current = false;
    lastStreamJsonChunkAtRef.current = Date.now();
    useTerminalSessionStore.getState().setAgentPrintRunToken(paneId, runToken);
  }, []);

  const clearAgentPrintRunToken = useCallback((paneId: string) => {
    agentPrintRunTokenRef.current = '';
    agentPrintRunActiveRef.current = false;
    hasStreamJsonChunkRef.current = false;
    useTerminalSessionStore.getState().setAgentPrintRunToken(paneId, null);
  }, []);

  const isTurnRunning = useMemo(
    () => turnsRef.current.some((turn) => turn.running),
    [turnsRevision, tab.turns],
  );
  const hasPendingQuestion = useMemo(() => {
    const turns = turnsRef.current;
    const latestTurn = turns[turns.length - 1];

    if (!latestTurn || latestTurn.running) {
      return false;
    }

    return hasPendingAgentQuestion(latestTurn.activities);
  }, [turnsRevision, tab.turns]);
  const hasPendingPlan = useMemo(() => {
    const turns = turnsRef.current;
    const latestTurn = turns[turns.length - 1];

    if (!latestTurn || latestTurn.running || hasPendingAgentQuestion(latestTurn.activities)) {
      return false;
    }

    return hasPendingAgentPlan(latestTurn.activities);
  }, [turnsRevision, tab.turns]);
  const pendingPlanActivity = useMemo(() => {
    const turns = turnsRef.current;
    const latestTurn = turns[turns.length - 1];

    if (!latestTurn || latestTurn.running) {
      return undefined;
    }

    return findPendingAgentPlanActivity(latestTurn.activities);
  }, [turnsRevision, tab.turns]);
  const isAwaiting = useTerminalSessionStore((state) =>
    Boolean(state.awaitingResponseByPane[tab.id]),
  );
  const isAgentBusy = useTerminalSessionStore((state) => Boolean(state.agentBusyByPane[tab.id]));
  const agentPrintRunToken = useTerminalSessionStore(
    (state) => state.agentPrintRunTokenByPane[tab.id] ?? null,
  );
  const hasPendingLaunch = useTerminalSessionStore((state) =>
    Boolean(state.pendingLaunchCommands[tab.id] && !tab.ptyId),
  );
  const resumeChatId = useTerminalSessionStore((state) => state.resumeChatIdByPane[tab.id] ?? null);
  const isBusy =
    hasPendingLaunch ||
    isTurnRunning ||
    isSubmitting ||
    Boolean(agentPrintRunToken) ||
    (isAwaiting && isAgentBusy);

  useEffect(() => {
    if (!hasPendingPlan || isTurnRunning || isSubmitting) {
      return;
    }

    const paneId = paneIdRef.current;
    clearAgentPrintRunToken(paneId);
    useTerminalSessionStore.getState().resetAgentWorkload(paneId);
  }, [clearAgentPrintRunToken, hasPendingPlan, isSubmitting, isTurnRunning]);

  useEffect(() => {
    if (!isBusy || isTurnRunning || isSubmitting || hasPendingPlan || hasPendingQuestion) {
      return;
    }

    const paneId = paneIdRef.current;
    let cancelled = false;

    const timeoutId = window.setTimeout(() => {
      void window.nexus.agentPrint.isRunning(paneId).then((processRunning) => {
        if (cancelled || processRunning) {
          return;
        }

        clearAgentPrintRunToken(paneId);
        const session = useTerminalSessionStore.getState();
        session.takePendingLaunchCommand(paneId);
        session.resetAgentWorkload(paneId);
        setIsSubmitting(false);
      });
    }, 600);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    clearAgentPrintRunToken,
    hasPendingPlan,
    hasPendingQuestion,
    isBusy,
    isSubmitting,
    isTurnRunning,
  ]);

  const syncOutputTailFromScrollback = useCallback(async () => {
    const ptyId = ptyIdRef.current;

    if (!ptyId) {
      return '';
    }

    const scrollback = await window.nexus.terminal.getScrollbackTail(ptyId, AGENT_OUTPUT_TAIL_SIZE);
    const tail = cleanAgentPtyChunk((scrollback ?? '').slice(-AGENT_OUTPUT_TAIL_SIZE)).replace(/\r/g, '\n');
    outputTailRef.current = tail;
    return tail;
  }, []);

  const syncAgentReadyFromTail = useCallback((tail: string) => {
    if (detectAgentReadyInChunk(tail)) {
      setIsAgentReady(true);
      return;
    }

    const paneId = paneIdRef.current;
    const session = useTerminalSessionStore.getState();
    const hasRunningTurn = turnsRef.current.some((turn) => turn.running);

    if (
      session.activeAgentByPane[paneId] &&
      !session.agentBusyByPane[paneId] &&
      !session.awaitingResponseByPane[paneId] &&
      !hasRunningTurn &&
      !detectSlashAutocompleteInTail(tail)
    ) {
      const plain = cleanAgentPtyChunk(tail);

      if (plain.length > 64) {
        setIsAgentReady(true);
      }
    }
  }, []);

  useEffect(() => {
    if (!usesStreamJson) {
      return;
    }

    const storedToken = useTerminalSessionStore.getState().agentPrintRunTokenByPane[tab.id];

    if (!storedToken || agentPrintRunTokenRef.current) {
      return;
    }

    agentPrintRunTokenRef.current = storedToken;
    agentPrintRunActiveRef.current = true;
  }, [tab.id, usesStreamJson]);

  useEffect(() => {
    const incoming = sanitizeAgentTurnHistory(tab.turns ?? []);
    const localTurns = turnsRef.current;
    const localRunning = localTurns.some((turn) => turn.running);
    const session = useTerminalSessionStore.getState();
    const storedToken = session.agentPrintRunTokenByPane[tab.id];
    const sessionLive =
      Boolean(storedToken) ||
      Boolean(session.agentBusyByPane[tab.id]) ||
      Boolean(session.awaitingResponseByPane[tab.id]) ||
      agentPrintRunActiveRef.current;

    if (incoming.length === 0) {
      if (localRunning || sessionLive) {
        return;
      }

      if (session.resumeChatIdByPane[tab.id] && localTurns.length > 0) {
        return;
      }

      cursorAgentContinueRef.current = false;
      streamJsonStateRef.current = createAgentStreamJsonParserState();
      turnsRef.current = incoming;
      editingTurnIdRef.current = null;
      setEditingTurnId(null);
      setFollowUps([]);
      setTurnsRevision((revision) => revision + 1);
      return;
    }

    const incomingRunning = incoming.some((turn) => turn.running);

    if ((agentPrintRunActiveRef.current || storedToken) && localRunning) {
      return;
    }

    if (
      localRunning &&
      !incomingRunning &&
      incoming.length > 0 &&
      incoming.length <= localTurns.length
    ) {
      return;
    }

    if (shouldPreferLocalAgentTurnHistory(localTurns, incoming)) {
      return;
    }

    turnsRef.current = incoming;
    setTurnsRevision((revision) => revision + 1);
  }, [tab.turns]);

  useEffect(() => {
    if (tab.ptyId) {
      ptyIdRef.current = tab.ptyId;
      setActivePtyId(tab.ptyId);
    }
  }, [tab.ptyId]);

  const persistTurnsDebounceRef = useRef<number | null>(null);
  const streamingTurnsUiRef = useRef<number | null>(null);

  const cancelPersistTurnsDebounce = useCallback(() => {
    if (persistTurnsDebounceRef.current !== null) {
      window.clearTimeout(persistTurnsDebounceRef.current);
      persistTurnsDebounceRef.current = null;
    }
  }, []);

  const flushPersistTurns = useCallback(() => {
    cancelPersistTurnsDebounce();

    const trimmedTurns = trimAgentTurnHistory(turnsRef.current);
    turnsRef.current = trimmedTurns;
    onTurnsChangeRef.current(trimmedTurns, { persist: true });
  }, [cancelPersistTurnsDebounce]);

  useEffect(() => {
    const paneId = tab.id;
    const storeRunning = (tab.turns ?? []).some((turn) => turn.running);
    const localTurns = turnsRef.current;
    const localRunning = localTurns.some((turn) => turn.running);
    const session = useTerminalSessionStore.getState();
    const hasPrintToken = Boolean(session.agentPrintRunTokenByPane[paneId]);

    if (!localRunning && !storeRunning && !hasPrintToken) {
      if (
        session.awaitingResponseByPane[paneId] ||
        session.agentBusyByPane[paneId] ||
        session.agentNotifyEligibleByPane[paneId]
      ) {
        session.resetAgentWorkload(paneId);
      }
    }

    if (!localRunning && storeRunning && localTurns.length > 0) {
      flushPersistTurns();
    }
  }, [flushPersistTurns, tab.id, tab.turns, turnsRevision]);

  const schedulePersistTurns = useCallback(() => {
    cancelPersistTurnsDebounce();
    persistTurnsDebounceRef.current = window.setTimeout(() => {
      persistTurnsDebounceRef.current = null;
      flushPersistTurns();
    }, PERSIST_TURNS_DEBOUNCE_MS);
  }, [cancelPersistTurnsDebounce, flushPersistTurns]);

  const scheduleStreamingTurnsUi = useCallback(() => {
    if (streamingTurnsUiRef.current !== null) {
      return;
    }

    streamingTurnsUiRef.current = window.setTimeout(() => {
      streamingTurnsUiRef.current = null;
      onTurnsChangeRef.current(turnsRef.current, { persist: false });
    }, STREAMING_TURNS_UI_MS);
  }, []);

  const persistTurns = useCallback(
    (nextTurns: AgentTurn[], options?: { flush?: boolean }) => {
      turnsRef.current = nextTurns;
      setTurnsRevision((revision) => revision + 1);

      if (options?.flush) {
        if (streamingTurnsUiRef.current !== null) {
          window.clearTimeout(streamingTurnsUiRef.current);
          streamingTurnsUiRef.current = null;
        }

        flushPersistTurns();
        return;
      }

      scheduleStreamingTurnsUi();
      schedulePersistTurns();
    },
    [flushPersistTurns, schedulePersistTurns, scheduleStreamingTurnsUi],
  );

  useEffect(() => {
    return () => {
      cancelPersistTurnsDebounce();

      if (streamingTurnsUiRef.current !== null) {
        window.clearTimeout(streamingTurnsUiRef.current);
        streamingTurnsUiRef.current = null;
      }

      if (turnsRef.current.length > 0) {
        const trimmedTurns = trimAgentTurnHistory(turnsRef.current);
        turnsRef.current = trimmedTurns;
        onTurnsChangeRef.current(trimmedTurns, { persist: true });
      }
    };
  }, [cancelPersistTurnsDebounce]);

  useEffect(() => {
    const boundResumeChatId = resumeChatId?.trim();

    if (!boundResumeChatId) {
      return;
    }

    cursorAgentContinueRef.current = true;
    streamJsonStateRef.current.sessionId = boundResumeChatId;
    setIsAgentReady(true);
  }, [resumeChatId, tab.id]);

  const updateActiveTurn = useCallback((updater: (turn: AgentTurn) => AgentTurn) => {
    const turns = turnsRef.current;
    const index = [...turns].reverse().findIndex((turn) => turn.running);
    const resolvedIndex = index === -1 ? -1 : turns.length - 1 - index;

    if (resolvedIndex === -1) {
      return;
    }

    const nextTurns = [...turns];
    const prevTurn = nextTurns[resolvedIndex]!;
    const updatedTurn = updater(prevTurn);

    if (updatedTurn === prevTurn) {
      return;
    }

    nextTurns[resolvedIndex] = updatedTurn;
    turnsRef.current = nextTurns;
    setTurnsRevision((revision) => revision + 1);
    scheduleStreamingTurnsUi();
    schedulePersistTurns();
  }, [schedulePersistTurns, scheduleStreamingTurnsUi]);

  const clearStreamJsonSettleTimer = useCallback(() => {
    if (streamJsonSettleTimerRef.current !== null) {
      window.clearTimeout(streamJsonSettleTimerRef.current);
      streamJsonSettleTimerRef.current = null;
    }
  }, []);

  const finalizeActiveTurn = useCallback((notifyOnComplete = false, options?: { force?: boolean }) => {
    clearStreamJsonSettleTimer();

    const turns = turnsRef.current;
    const index = [...turns].reverse().findIndex((turn) => turn.running);
    const resolvedIndex = index === -1 ? -1 : turns.length - 1 - index;

    if (resolvedIndex === -1) {
      return;
    }

    const nextTurns = [...turns];
    const activeTurn = nextTurns[resolvedIndex]!;
    const paneId = paneIdRef.current;
    const turnAgeMs = Date.now() - (activeTurn.startedAt ?? 0);
    const hasOutput = hasMeaningfulStreamJsonTurnOutput(streamJsonStateRef.current);

    if (
      usesStreamJson &&
      !notifyOnComplete &&
      !options?.force &&
      (submitInFlightRef.current || (turnAgeMs < 5000 && !hasOutput))
    ) {
      // #region agent log
      writeDebugSessionLog({
        location: 'useAgentPaneSession.ts:finalizeActiveTurn',
        message: 'finalize active turn skipped',
        data: {
          turnAgeMs,
          hasOutput,
          submitInFlight: submitInFlightRef.current,
        },
        hypothesisId: 'G',
        runId: 'post-fix',
      });
      // #endregion
      return;
    }

    if (usesStreamJson) {
      // #region agent log
      writeDebugSessionLog({
        location: 'useAgentPaneSession.ts:finalizeActiveTurn',
        message: 'finalize active turn (stream json)',
        data: {
          notifyOnComplete,
          hasMeaningful: hasMeaningfulStreamJsonTurnOutput(streamJsonStateRef.current),
          shouldFinalize: streamJsonStateRef.current.shouldFinalize,
          activityKinds: streamJsonStateRef.current.activities.map((entry) => entry.kind),
          pendingResponseLength: streamJsonStateRef.current.pendingResponseText.trim().length,
        },
        hypothesisId: 'F',
        runId: 'post-fix',
      });
      // #endregion

      window.nexus.agentPrint.stop(paneId);
      nextTurns[resolvedIndex] = finalizeStreamJsonTurn(activeTurn, streamJsonStateRef.current);
      streamJsonStateRef.current = createAgentStreamJsonParserState();
      turnOutputBufferRef.current = '';
      clearAgentPrintRunToken(paneId);
      finalizeMobileReleasesForPane(paneId);
    } else {
      const outputSlice =
        turnOutputBufferRef.current.trim() ||
        outputTailRef.current.slice(turnOutputStartRef.current);
      turnOutputBufferRef.current = '';
      nextTurns[resolvedIndex] =
        outputSlice.trim().length > 0
          ? rebuildTurnFromAgentOutput(activeTurn, outputSlice)
          : finalizeAgentTurn(activeTurn, parserStateRef.current);
      parserStateRef.current = createAgentTranscriptParserState();
    }

    persistTurns(finalizeBuildingAgentPlans(nextTurns), { flush: true });
    recordHomeDashboardActivity('agentExecutions');

    if (notifyOnComplete) {
      const finalizedActivities = nextTurns[resolvedIndex]?.activities ?? [];
      const hasFollowUps = followUpsRef.current.length > 0;
      const requiresHumanAction =
        hasPendingAgentQuestion(finalizedActivities) || hasPendingAgentPlan(finalizedActivities);

      if (!hasFollowUps || requiresHumanAction) {
        useTerminalSessionStore.getState().completeTaskIfAwaiting(paneId);
      } else {
        useTerminalSessionStore.getState().resetAgentWorkload(paneId);
      }
    } else {
      useTerminalSessionStore.getState().resetAgentWorkload(paneId);
    }

    setIsAgentReady(true);

    if (!suppressFollowUpFlushRef.current) {
      tryFlushFollowUpQueueRef.current({ force: true });
    }

    promotePendingFollowUpTurnRef.current();
  }, [clearAgentPrintRunToken, clearStreamJsonSettleTimer, persistTurns, usesStreamJson]);

  useEffect(() => {
    if (isAgentBusy || isTurnRunning || isSubmitting) {
      return;
    }

    const currentTurns = turnsRef.current;

    if (!hasBuildingAgentPlans(currentTurns)) {
      return;
    }

    const hasStaleBuilding = currentTurns.some(
      (turn, turnIndex) =>
        turnIndex < currentTurns.length - 1 &&
        turn.activities.some((entry) => entry.kind === 'plan' && entry.planStatus === 'building'),
    );

    if (!hasStaleBuilding) {
      return;
    }

    persistTurns(repairStaleBuildingAgentPlans(currentTurns), { flush: true });
  }, [isAgentBusy, isSubmitting, isTurnRunning, persistTurns, tab.turns, turnsRevision]);

  const finalizeStreamJsonTurnFromEvent = useCallback((source = 'unknown') => {
    const streamState = streamJsonStateRef.current;
    const turnStartedAt = [...turnsRef.current].reverse().find((turn) => turn.running)?.startedAt ?? null;
    const elapsedMs = turnStartedAt ? Date.now() - turnStartedAt : null;
    // #region agent log
    writeDebugSessionLog({
      location: 'useAgentPaneSession.ts:finalizeStreamJsonTurnFromEvent',
      message: 'finalize stream json turn',
      data: {
        source,
        elapsedMs,
        shouldFinalize: streamState.shouldFinalize,
        hasMeaningful: hasMeaningfulStreamJsonTurnOutput(streamState),
        autoRetryUsed: streamJsonAutoRetryRef.current,
        activityKinds: streamState.activities.map((entry) => entry.kind),
        pendingResponseLength: streamState.pendingResponseText.trim().length,
      },
      hypothesisId: 'E',
    });
    // #endregion

    if (streamJsonSettleTimerRef.current !== null) {
      window.clearTimeout(streamJsonSettleTimerRef.current);
      streamJsonSettleTimerRef.current = null;
    }

    const turns = turnsRef.current;
    const index = [...turns].reverse().findIndex((turn) => turn.running);
    const resolvedIndex = index === -1 ? -1 : turns.length - 1 - index;

    if (resolvedIndex === -1) {
      tryFlushFollowUpQueueRef.current({ force: true });
      promotePendingFollowUpTurnRef.current();
      return;
    }

    const paneId = paneIdRef.current;
    const nextTurns = [...turns];
    nextTurns[resolvedIndex] = finalizeStreamJsonTurn(nextTurns[resolvedIndex]!, streamJsonStateRef.current);

    window.nexus.agentPrint.stop(paneId);

    if (streamJsonStateRef.current.sessionId) {
      cursorAgentContinueRef.current = true;
      useTerminalSessionStore.getState().setResumeChatId(paneId, streamJsonStateRef.current.sessionId);
    }

    streamJsonStateRef.current = createAgentStreamJsonParserState();
    turnOutputBufferRef.current = '';
    streamJsonAutoRetryRef.current = false;
    clearAgentPrintRunToken(paneId);
    persistTurns(nextTurns, { flush: true });
    recordHomeDashboardActivity('agentExecutions');

    const finalizedActivities = nextTurns[resolvedIndex]?.activities ?? [];
    const hasFollowUps = followUpsRef.current.length > 0;
    const requiresHumanAction =
      hasPendingAgentQuestion(finalizedActivities) || hasPendingAgentPlan(finalizedActivities);

    if (!hasFollowUps || requiresHumanAction) {
      useTerminalSessionStore.getState().completeTaskIfAwaiting(paneId);
    } else {
      useTerminalSessionStore.getState().resetAgentWorkload(paneId);
    }

    setIsAgentReady(true);
    tryFlushFollowUpQueueRef.current({ force: true });
    promotePendingFollowUpTurnRef.current();
  }, [clearAgentPrintRunToken, persistTurns]);

  const clearContextUsageReportTimer = useCallback(() => {
    if (contextUsageReportTimerRef.current !== null) {
      window.clearTimeout(contextUsageReportTimerRef.current);
      contextUsageReportTimerRef.current = null;
    }
  }, []);

  const syncContextUsageFromTail = useCallback((tail: string) => {
    const parsed = parseAgentContextUsageFromTail(tail);

    if (!parsed) {
      return;
    }

    setContextUsage((current) => mergeAgentContextUsageSnapshots(current, parsed));
  }, []);

  const syncContextUsageFromStreamJson = useCallback((usage: AgentStreamJsonTokenUsage) => {
    setContextUsage((current) =>
      mergeAgentContextUsageSnapshots(current, buildAgentContextUsageFromStreamJsonUsage(usage)),
    );
  }, []);

  const tryFinalizeSettledStreamJsonTurn = useCallback(
    (processRunning = false, source = 'unknown') => {
      if (!turnsRef.current.some((turn) => turn.running)) {
        return false;
      }

      feedAgentStreamJsonChunk(streamJsonStateRef.current, '');

      if (streamJsonStateRef.current.shouldFinalize) {
        // #region agent log
        writeDebugSessionLog({
          location: 'useAgentPaneSession.ts:tryFinalizeSettled',
          message: 'shouldFinalize branch',
          data: {
            source,
            processRunning,
            hasMeaningful: hasMeaningfulStreamJsonTurnOutput(streamJsonStateRef.current),
            activityKinds: streamJsonStateRef.current.activities.map((entry) => entry.kind),
          },
          hypothesisId: 'C',
        });
        // #endregion

        if (!hasMeaningfulStreamJsonTurnOutput(streamJsonStateRef.current)) {
          streamJsonStateRef.current.shouldFinalize = false;

          if (
            !processRunning &&
            tryScheduleStreamJsonAutoRetryRef.current(() => {
              clearAgentPrintRunToken(paneIdRef.current);
            })
          ) {
            agentPrintRunActiveRef.current = false;
            window.nexus.agentPrint.stop(paneIdRef.current);
            return true;
          }

          return false;
        }

        agentPrintRunActiveRef.current = false;
        window.nexus.agentPrint.stop(paneIdRef.current);
        finalizeStreamJsonTurnFromEvent('tryFinalize-shouldFinalize');
        return true;
      }

      if (processRunning) {
        return false;
      }

      if (!tryMarkStreamJsonReadyToFinalize(streamJsonStateRef.current)) {
        if (
          !hasMeaningfulStreamJsonTurnOutput(streamJsonStateRef.current) &&
          tryScheduleStreamJsonAutoRetryRef.current(() => {
            clearAgentPrintRunToken(paneIdRef.current);
          })
        ) {
          agentPrintRunActiveRef.current = false;
          window.nexus.agentPrint.stop(paneIdRef.current);
          return true;
        }

        return false;
      }

      updateActiveTurn((turn) => ({
        ...turn,
        activities: streamJsonStateRef.current.activities.map((entry) => ({ ...entry })),
      }));
      agentPrintRunActiveRef.current = false;
      window.nexus.agentPrint.stop(paneIdRef.current);
      finalizeStreamJsonTurnFromEvent('tryFinalize-ready');
      return true;
    },
    [
      clearAgentPrintRunToken,
      finalizeStreamJsonTurnFromEvent,
      updateActiveTurn,
    ],
  );

  const syncStreamJsonStallLiveStatus = useCallback(
    (idleMs: number) => {
      const label = resolveStreamJsonStallLiveStatus(streamJsonStateRef.current, idleMs);

      if (!label) {
        if (!streamJsonStallLabelRef.current) {
          return;
        }

        streamJsonStallLabelRef.current = '';

        if (!clearStreamJsonLiveStatus(streamJsonStateRef.current)) {
          return;
        }

        updateActiveTurn((turn) => ({
          ...turn,
          activities: streamJsonStateRef.current.activities.map((entry) => ({ ...entry })),
        }));
        return;
      }

      if (label === streamJsonStallLabelRef.current) {
        return;
      }

      streamJsonStallLabelRef.current = label;

      if (!upsertStreamJsonLiveStatus(streamJsonStateRef.current, label)) {
        return;
      }

      updateActiveTurn((turn) => ({
        ...turn,
        activities: streamJsonStateRef.current.activities.map((entry) => ({ ...entry })),
      }));
    },
    [updateActiveTurn],
  );

  const tryHandoffLongRunningDevShell = useCallback((idleMs: number): boolean => {
    if (idleMs < STREAM_JSON_LONG_SHELL_HANDOFF_MS) {
      return false;
    }

    const streamingShell = [...streamJsonStateRef.current.activities]
      .reverse()
      .find(
        (entry) =>
          entry.kind === 'tool_run' &&
          entry.streaming &&
          entry.toolCommand?.trim(),
      );

    const command = streamingShell?.toolCommand?.trim();

    if (!command || !shouldOpenAgentShellToolTerminal(command)) {
      return false;
    }

    forceSettleStreamJsonInFlightWork(streamJsonStateRef.current);

    if (!streamJsonStateRef.current.pendingResponseText.trim()) {
      feedAgentStreamJsonChunk(
        streamJsonStateRef.current,
        `${JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ text: 'Servidor de desenvolvimento em execução. Acompanhe pelo terminal.' }],
          },
        })}\n`,
      );
    }

    streamJsonStateRef.current.shouldFinalize = true;
    return true;
  }, []);

  const scheduleStreamJsonSettleCheck = useCallback(() => {
    if (!usesStreamJson) {
      return;
    }

    clearStreamJsonSettleTimer();
    streamJsonSettleTimerRef.current = window.setTimeout(() => {
      streamJsonSettleTimerRef.current = null;

      void window.nexus.agentPrint.isRunning(paneIdRef.current).then((processRunning) => {
        if (processRunning) {
          const idleMs = Date.now() - lastStreamJsonChunkAtRef.current;

          if (idleMs >= STREAM_JSON_STALL_UI_MS) {
            syncStreamJsonStallLiveStatus(idleMs);
          }

          return;
        }

        tryFinalizeSettledStreamJsonTurn(false, 'settleTimer');
      });
    }, STREAM_JSON_RESPONSE_IDLE_FINALIZE_MS);
  }, [
    clearStreamJsonSettleTimer,
    syncStreamJsonStallLiveStatus,
    tryFinalizeSettledStreamJsonTurn,
    usesStreamJson,
  ]);

  const applyStreamJsonChunk = useCallback(
    (chunk: string): boolean => {
      if (chunk) {
        clearStreamJsonSettleTimer();
      }

      const streamUpdate = feedAgentStreamJsonChunk(streamJsonStateRef.current, chunk);
      const hasMeaningfulProgress =
        streamUpdate.hasUpdate ||
        streamUpdate.shouldFinalize ||
        Boolean(streamUpdate.sessionId) ||
        Boolean(streamUpdate.usage) ||
        streamUpdate.shellToolEvents.length > 0;

      let clearedStall = false;

      if (hasMeaningfulProgress) {
        hasStreamJsonChunkRef.current = true;
        lastStreamJsonChunkAtRef.current = Date.now();

        if (streamJsonStallLabelRef.current) {
          streamJsonStallLabelRef.current = '';
          clearStreamJsonLiveStatus(streamJsonStateRef.current);
          clearedStall = true;
        }
      }

      if (streamUpdate.sessionId) {
        cursorAgentContinueRef.current = true;
        useTerminalSessionStore.getState().setResumeChatId(paneIdRef.current, streamUpdate.sessionId);
      }

      if (streamUpdate.hasUpdate || clearedStall) {
        updateActiveTurn((turn) => ({
          ...turn,
          activities: [...streamJsonStateRef.current.activities],
        }));
      }

      if (streamUpdate.usage) {
        syncContextUsageFromStreamJson(streamUpdate.usage);
      }

      if (streamUpdate.shellToolEvents.length > 0) {
        handleMobileReleaseShellToolEvents(paneIdRef.current, streamUpdate.shellToolEvents);
        void handleAgentShellToolTerminalEvents(
          paneIdRef.current,
          streamUpdate.shellToolEvents,
          agentRootPath,
        );
      }

      if (chunk && hasMeaningfulProgress) {
        scheduleStreamJsonSettleCheck();
      }

      return streamUpdate.shouldFinalize;
    },
    [
      agentRootPath,
      clearStreamJsonSettleTimer,
      scheduleStreamJsonSettleCheck,
      syncContextUsageFromStreamJson,
      updateActiveTurn,
    ],
  );

  const writeToPty = useCallback((text: string) => {
    if (!ptyIdRef.current) {
      return false;
    }

    window.nexus.terminal.write(ptyIdRef.current, text);
    return true;
  }, []);

  const startStreamJsonAgentRun = useCallback(
    (prompt: string, imageRefs: string[], options?: { isAutoRetry?: boolean }) => {
      const paneId = paneIdRef.current;
      const session = useTerminalSessionStore.getState();
      const currentMode = session.activeAgentModeByPane[paneId] ?? 'agent';
      const lastPrintMode = session.agentPrintLastModeByPane[paneId];
      const modeChangedSinceLastPrint =
        lastPrintMode !== undefined && lastPrintMode !== currentMode;
      const model = session.agentModelByPane[paneId] ?? null;
      const mode = resolveCursorAgentPrintMode(currentMode);
      const root = agentRootPath.replace(/\/+$/, '');
      const resolvedImageRefs = imageRefs.map((ref) => {
        const relPath = ref.startsWith('@') ? ref.slice(1) : ref;

        if (relPath.startsWith('/')) {
          return ref;
        }

        return `@${root}/${relPath}`;
      });
      const fullPrompt = [prompt, ...resolvedImageRefs].filter(Boolean).join(' ').trim();
      const resumeChatId = session.resumeChatIdByPane[paneId]?.trim() ?? null;

      if (!fullPrompt) {
        return false;
      }

      const hasCompletedTurn = turnsRef.current.some((turn) => !turn.running && !turn.pendingFollowUp);

      streamJsonStateRef.current = createAgentStreamJsonParserState();

      if (resumeChatId) {
        streamJsonStateRef.current.sessionId = resumeChatId;
        cursorAgentContinueRef.current = true;
      }

      streamJsonStateRef.current.activities = createInitialTurnActivities();

      if (!options?.isAutoRetry) {
        streamJsonAutoRetryRef.current = false;
      }

      if (shouldMarkAgentAwaiting(paneId, fullPrompt, session.activeAgentByPane)) {
        session.setLastCommand(paneId, fullPrompt);
        trackAgentGitPrompt(paneId, fullPrompt);
        session.markAwaitingResponse(paneId);
      } else {
        session.setLastCommand(paneId, fullPrompt);
      }

      session.setAgentBusy(paneId, true);
      session.setAgentPrintLastMode(paneId, currentMode);
      lastStreamJsonChunkAtRef.current = Date.now();
      const runToken = crypto.randomUUID();
      bindAgentPrintRunToken(paneId, runToken);

      void window.nexus.agentPrint.start({
        paneId,
        cwd: agentRootPath,
        prompt: fullPrompt,
        model,
        mode,
        resumeChatId,
        continueSession:
          !resumeChatId &&
          cursorAgentContinueRef.current &&
          hasCompletedTurn &&
          !modeChangedSinceLastPrint,
        runToken,
      });

      recordHomeDashboardActivity('prompts');

      return true;
    },
    [agentRootPath, bindAgentPrintRunToken],
  );

  const tryScheduleStreamJsonAutoRetry = useCallback(
    (finishAgentPrintRun: () => void): boolean => {
      if (streamJsonAutoRetryRef.current) {
        return false;
      }

      if (hasMeaningfulStreamJsonTurnOutput(streamJsonStateRef.current)) {
        return false;
      }

      const retryTurn = turnsRef.current.find((turn) => turn.running);

      if (!retryTurn) {
        return false;
      }

      const prompt = retryTurn.user.agentPrompt?.trim() || retryTurn.user.content.trim();
      const imageRefs = (retryTurn.user.attachments ?? [])
        .map((attachment) =>
          attachment.relativePath ? buildImagePathReference(attachment.relativePath) : '',
        )
        .filter(Boolean);

      if (!prompt && imageRefs.length === 0) {
        return false;
      }

      streamJsonAutoRetryRef.current = true;
      finishAgentPrintRun();
      streamJsonStateRef.current = createAgentStreamJsonParserState();
      streamJsonStateRef.current.activities = createInitialTurnActivities();
      turnOutputBufferRef.current = '';

      window.setTimeout(() => {
        startStreamJsonAgentRun(prompt, imageRefs, { isAutoRetry: true });
      }, STREAM_JSON_AUTO_RETRY_DELAY_MS);

      return true;
    },
    [startStreamJsonAgentRun],
  );
  tryScheduleStreamJsonAutoRetryRef.current = tryScheduleStreamJsonAutoRetry;

  const requestContextUsageReport = useCallback(() => {
    setContextUsageLoading(true);
    contextUsageReportPendingRef.current = true;
    clearContextUsageReportTimer();

    if (usesStreamJson) {
      const pendingUsage = streamJsonStateRef.current.pendingUsage;

      if (pendingUsage) {
        syncContextUsageFromStreamJson(pendingUsage);
      }

      contextUsageReportTimerRef.current = window.setTimeout(() => {
        contextUsageReportTimerRef.current = null;
        contextUsageReportPendingRef.current = false;
        setContextUsageLoading(false);
      }, CONTEXT_USAGE_REPORT_DELAY_MS);
      return;
    }

    if (!ptyIdRef.current) {
      contextUsageReportPendingRef.current = false;
      setContextUsageLoading(false);
      return;
    }

    writeToPty('/context\n');

    contextUsageReportTimerRef.current = window.setTimeout(() => {
      contextUsageReportTimerRef.current = null;
      syncContextUsageFromTail(outputTailRef.current);
      contextUsageReportPendingRef.current = false;
      setContextUsageLoading(false);
      writeToPty('\x1b');
    }, CONTEXT_USAGE_REPORT_DELAY_MS);
  }, [
    clearContextUsageReportTimer,
    syncContextUsageFromStreamJson,
    syncContextUsageFromTail,
    usesStreamJson,
    writeToPty,
  ]);

  const clearApprovalConfirmTimer = useCallback(() => {
    if (approvalConfirmTimerRef.current !== null) {
      window.clearTimeout(approvalConfirmTimerRef.current);
      approvalConfirmTimerRef.current = null;
    }
  }, []);

  const scheduleSmartModeApproval = useCallback(() => {
    if (submitAbortRef.current) {
      return;
    }

    const runningTurn = turnsRef.current.find((turn) => turn.running);

    if (!runningTurn || approvalConfirmedTurnRef.current === runningTurn.id) {
      return;
    }

    if (!detectSmartModeApprovalInTail(outputTailRef.current)) {
      return;
    }

    clearApprovalConfirmTimer();
    approvalConfirmTimerRef.current = window.setTimeout(() => {
      approvalConfirmTimerRef.current = null;

      const activeTurn = turnsRef.current.find((turn) => turn.running);

      if (!activeTurn || approvalConfirmedTurnRef.current === activeTurn.id) {
        return;
      }

      if (!detectSmartModeApprovalInTail(outputTailRef.current)) {
        return;
      }

      writeToPty('\r');
      approvalConfirmedTurnRef.current = activeTurn.id;
    }, APPROVAL_CONFIRM_DELAY_MS);
  }, [clearApprovalConfirmTimer, writeToPty]);

  const scheduleSetupSettled = useCallback(
    (paneId: string) => {
      const setupPromise = waitForAgentPaneReady(paneId).then(() => {
        syncAgentReadyFromTail(outputTailRef.current);
      });
      pendingSetupRef.current = setupPromise;
      void setupPromise.finally(() => {
        if (pendingSetupRef.current === setupPromise) {
          pendingSetupRef.current = null;
        }
      });
    },
    [syncAgentReadyFromTail],
  );

  const waitForComposerAgentReady = useCallback(
    async (shouldAbort: () => boolean): Promise<boolean> => {
      if (usesStreamJson) {
        return !shouldAbort();
      }

      const paneId = paneIdRef.current;
      const deadline = Date.now() + COMPOSER_READY_MAX_MS;

      while (Date.now() < deadline) {
        if (shouldAbort()) {
          return false;
        }

        if (!turnsRef.current.some((turn) => turn.running)) {
          useTerminalSessionStore.getState().resetAgentWorkload(paneId);
        }

        const activeOk = await waitForActiveAgent(paneId, 90, shouldAbort);

        if (!activeOk) {
          await delay(COMPOSER_READY_POLL_MS);
          continue;
        }

        if (outputTailRef.current.trim()) {
          syncAgentReadyFromTail(outputTailRef.current);
        } else {
          await syncOutputTailFromScrollback();
          syncAgentReadyFromTail(outputTailRef.current);
        }

        const tail = outputTailRef.current;

        if (detectAgentReadyInChunk(tail) && !detectSlashAutocompleteInTail(tail)) {
          return true;
        }

        const session = useTerminalSessionStore.getState();

        if (
          session.activeAgentByPane[paneId] &&
          !session.agentBusyByPane[paneId] &&
          !session.awaitingResponseByPane[paneId]
        ) {
          return true;
        }

        await delay(COMPOSER_READY_POLL_MS);
      }

      return Boolean(useTerminalSessionStore.getState().activeAgentByPane[paneIdRef.current]);
    },
    [syncAgentReadyFromTail, syncOutputTailFromScrollback, usesStreamJson],
  );

  const runCommand = useCallback(
    (command: string) => {
      const normalized = command.endsWith('\n') ? command : `${command}\n`;
      const commandLine = normalized.replace(/\n$/, '');
      const paneId = paneIdRef.current;
      const session = useTerminalSessionStore.getState();

      if (commandLine) {
        if (shouldMarkAgentAwaiting(paneId, commandLine, session.activeAgentByPane)) {
          session.setLastCommand(paneId, commandLine);
          trackAgentGitPrompt(paneId, commandLine);
          session.markAwaitingResponse(paneId);
        } else {
          session.setLastCommand(paneId, commandLine);
        }

        void startMobileReleaseFromCommand(paneId, commandLine);
      }

      if (usesStreamJson && commandLine && isAgentSetupCommand(commandLine)) {
        return true;
      }

      const written = writeToPty(normalized);

      if (written && commandLine && isAgentSetupCommand(commandLine)) {
        setIsAgentReady(false);
        scheduleSetupSettled(paneId);
      }

      return written;
    },
    [scheduleSetupSettled, usesStreamJson, writeToPty],
  );

  const stopAgent = useCallback((options?: { preserveFollowUps?: boolean }) => {
    const ptyId = ptyIdRef.current;
    const paneId = paneIdRef.current;
    const session = useTerminalSessionStore.getState();

    submitAbortRef.current = true;
    submitInFlightRef.current = false;
    setIsSubmitting(false);
    clearStreamJsonSettleTimer();

    if (submitTimeoutRef.current !== null) {
      window.clearTimeout(submitTimeoutRef.current);
      submitTimeoutRef.current = null;
    }

    pendingSetupRef.current = null;
    approvalConfirmedTurnRef.current = null;
    clearApprovalConfirmTimer();
    resetAgentReadyDetectors(paneId);
    streamJsonAutoRetryRef.current = false;

    clearAgentPrintRunToken(paneId);
    session.takePendingLaunchCommand(paneId);
    session.resetAgentWorkload(paneId);

    if (usesStreamJson) {
      window.nexus.agentPrint.stop(paneId);
    }

    if (ptyId) {
      void sendAgentInterruptSequence((sequence) => {
        window.nexus.terminal.write(ptyId, sequence);
      }).then(() => {
        syncAgentReadyFromTail(outputTailRef.current);
      });
    }

    if (options?.preserveFollowUps) {
      suppressFollowUpFlushRef.current = true;
    }

    let finalizeGuard = 0;

    while (turnsRef.current.some((turn) => turn.running) && finalizeGuard < 8) {
      finalizeActiveTurn(false, { force: true });
      finalizeGuard += 1;
    }

    const latestTurn = turnsRef.current[turnsRef.current.length - 1];

    if (
      latestTurn &&
      !latestTurn.running &&
      isAgentTurnSummaryVisible(latestTurn.summary) &&
      !latestTurn.activities.some(
        (entry) => entry.kind === 'response' && entry.label.trim().length > 0,
      )
    ) {
      const fallbackLabel =
        (latestTurn.summary?.editedFileCount ?? 0) > 0 ||
        (latestTurn.summary?.commandCount ?? 0) > 0
          ? 'Alterações aplicadas.'
          : 'O agente encerrou sem uma resposta em texto.';

      persistTurns(
        turnsRef.current.map((turn, index) =>
          index === turnsRef.current.length - 1
            ? {
                ...turn,
                activities: [
                  ...turn.activities,
                  {
                    id: crypto.randomUUID(),
                    kind: 'response' as const,
                    label: fallbackLabel,
                    createdAt: Date.now(),
                  },
                ],
              }
            : turn,
        ),
        { flush: true },
      );
    }

    parserStateRef.current = createAgentTranscriptParserState();
    streamJsonStateRef.current = createAgentStreamJsonParserState();
    clearAgentPrintRunToken(paneId);
    session.resetAgentWorkload(paneId);
    setIsAgentReady(true);

    if (options?.preserveFollowUps) {
      suppressFollowUpFlushRef.current = false;
    } else {
      setFollowUps([]);
    }

    return Boolean(ptyId) || usesStreamJson;
  }, [
    clearAgentPrintRunToken,
    clearApprovalConfirmTimer,
    clearStreamJsonSettleTimer,
    finalizeActiveTurn,
    persistTurns,
    syncAgentReadyFromTail,
    usesStreamJson,
  ]);

  const rollbackAgentFromTurn = useCallback(
    async (turnId: string): Promise<boolean> => {
      const turns = turnsRef.current;
      const index = turns.findIndex((turn) => turn.id === turnId);

      if (index === -1) {
        return false;
      }

      const target = turns[index]!;

      if (turns.some((turn) => turn.running)) {
        stopAgent();
      }

      const isLastTurn = index === turns.length - 1;

      await revertAgentGitChangesForTurn({
        paneId: paneIdRef.current,
        projectPath,
        turn: target,
        isActiveOrPendingTurn: isLastTurn,
      });

      const truncated = turns.slice(0, index);
      persistTurns(truncated, { flush: true });
      parserStateRef.current = createAgentTranscriptParserState();
      streamJsonStateRef.current = createAgentStreamJsonParserState();
      cursorAgentContinueRef.current = truncated.length > 0;

      return true;
    },
    [persistTurns, projectPath, stopAgent],
  );

  const sendPromptToPty = useCallback(
    (trimmed: string, imageRefs: string[]) => {
      if (usesStreamJson) {
        streamJsonStateRef.current = createAgentStreamJsonParserState();
        startStreamJsonAgentRun(trimmed, imageRefs);
        return;
      }

      const paneId = paneIdRef.current;
      const session = useTerminalSessionStore.getState();

      writeToPty(PTY_CLEAR_INPUT);

      if (trimmed) {
        if (shouldMarkAgentAwaiting(paneId, trimmed, session.activeAgentByPane)) {
          session.setLastCommand(paneId, trimmed);
          trackAgentGitPrompt(paneId, trimmed);
          session.markAwaitingResponse(paneId);
        } else {
          session.setLastCommand(paneId, trimmed);
        }

        const cliAgent = extractCliAgentCommand(trimmed);

        if (cliAgent) {
          session.setActiveAgent(paneId, cliAgent);
        }

        writeToPty(trimmed);
      }

      for (const reference of imageRefs) {
        writeToPty(` ${reference}`);
      }

      if (trimmed || imageRefs.length > 0) {
        writeToPty('\n');
        recordHomeDashboardActivity('prompts');
      }
    },
    [usesStreamJson, startStreamJsonAgentRun, writeToPty],
  );

  const appendPendingFollowUpTurn = useCallback(
    (user: AgentUserMessage) => {
      const turn: AgentTurn = {
        id: crypto.randomUUID(),
        user,
        activities: [],
        running: false,
        pendingFollowUp: true,
        startedAt: Date.now(),
      };

      persistTurns([...turnsRef.current, turn], { flush: true });
    },
    [persistTurns],
  );

  const promotePendingFollowUpTurn = useCallback(() => {
    const turns = turnsRef.current;
    const index = turns.findIndex((turn) => turn.pendingFollowUp);

    if (index === -1 || turns.some((turn) => turn.running)) {
      return;
    }

    const pendingTurn = turns[index]!;
    const nextTurns = [...turns];
    nextTurns[index] = {
      ...pendingTurn,
      pendingFollowUp: undefined,
      running: true,
      activities: createInitialTurnActivities(),
      startedAt: Date.now(),
    };
    turnOutputStartRef.current = outputTailRef.current.length;
    turnOutputBufferRef.current = '';
    parserStateRef.current = createAgentTranscriptParserState();
    streamJsonStateRef.current = createAgentStreamJsonParserState();
    if (usesStreamJson) {
      markStreamJsonTurnStarted();
    }
    persistTurns(nextTurns, { flush: true });

    if (!usesStreamJson) {
      return;
    }

    const prompt = pendingTurn.user.agentPrompt?.trim() || pendingTurn.user.content.trim();
    const imageRefs = (pendingTurn.user.attachments ?? [])
      .map((attachment) =>
        attachment.relativePath ? buildImagePathReference(attachment.relativePath) : '',
      )
      .filter(Boolean);

    if (!prompt && imageRefs.length === 0) {
      return;
    }

    resetAgentReadyDetectors(paneIdRef.current);
    setIsAgentReady(false);
    startStreamJsonAgentRun(prompt, imageRefs);
  }, [markStreamJsonTurnStarted, persistTurns, resetAgentReadyDetectors, startStreamJsonAgentRun, usesStreamJson]);

  const dispatchFollowUpToPty = useCallback(
    (item: AgentFollowUp, force = false): boolean => {
      if (!usesStreamJson && !ptyIdRef.current) {
        return false;
      }

      if (!usesStreamJson && !force && !detectAgentFollowUpReadyInChunk(outputTailRef.current)) {
        return false;
      }

      const imageRefs = item.attachments
        .map((attachment) =>
          attachment.relativePath ? buildImagePathReference(attachment.relativePath) : '',
        )
        .filter(Boolean);

      const paneId = paneIdRef.current;
      const agentPrompt = resolveFollowUpAgentPrompt(item);
      const user = createUserMessage(
        item.content,
        item.attachments,
        item.mode ?? resolvePaneAgentMode(paneId),
        {
          ...(item.agentPrompt ? { agentPrompt: item.agentPrompt } : {}),
          ...(item.skillLabel ? { skillLabel: item.skillLabel } : {}),
        },
      );
      const hasRunningTurn = turnsRef.current.some((turn) => turn.running);

      if (hasRunningTurn) {
        if (usesStreamJson) {
          if (!force) {
            return false;
          }

          stopAgent({ preserveFollowUps: true });
        } else {
          const session = useTerminalSessionStore.getState();

          writeToPty(PTY_CLEAR_INPUT);

          if (agentPrompt) {
            if (shouldMarkAgentAwaiting(paneId, agentPrompt, session.activeAgentByPane)) {
              session.setLastCommand(paneId, agentPrompt);
              trackAgentGitPrompt(paneId, agentPrompt);
              session.markAwaitingResponse(paneId);
            } else {
              session.setLastCommand(paneId, agentPrompt);
            }

            writeToPty(agentPrompt);
          }

          for (const reference of imageRefs) {
            writeToPty(` ${reference}`);
          }

          if (agentPrompt || imageRefs.length > 0) {
            writeToPty('\n');
          }

          appendPendingFollowUpTurn(user);
          return true;
        }
      }

      if (turnsRef.current.some((turn) => turn.running)) {
        return false;
      }

      const turn = createTurn(user);

      if (usesStreamJson) {
        turn.activities = createInitialTurnActivities();
        markStreamJsonTurnStarted();
      }

      turnOutputStartRef.current = outputTailRef.current.length;
      turnOutputBufferRef.current = '';
      parserStateRef.current = createAgentTranscriptParserState();
      streamJsonStateRef.current = createAgentStreamJsonParserState();
      persistTurns([...turnsRef.current, turn], { flush: true });
      resetAgentReadyDetectors(paneId);
      setIsAgentReady(false);

      if (usesStreamJson) {
        startStreamJsonAgentRun(agentPrompt, imageRefs);
      } else {
        const session = useTerminalSessionStore.getState();

        writeToPty(PTY_CLEAR_INPUT);

        if (agentPrompt) {
          if (shouldMarkAgentAwaiting(paneId, agentPrompt, session.activeAgentByPane)) {
            session.setLastCommand(paneId, agentPrompt);
            trackAgentGitPrompt(paneId, agentPrompt);
            session.markAwaitingResponse(paneId);
          } else {
            session.setLastCommand(paneId, agentPrompt);
          }

          writeToPty(agentPrompt);
        }

        for (const reference of imageRefs) {
          writeToPty(` ${reference}`);
        }

        if (agentPrompt || imageRefs.length > 0) {
          writeToPty('\n');
        }
      }

      return true;
    },
    [
      appendPendingFollowUpTurn,
      markStreamJsonTurnStarted,
      persistTurns,
      resetAgentReadyDetectors,
      startStreamJsonAgentRun,
      stopAgent,
      usesStreamJson,
      writeToPty,
    ],
  );

  const tryFlushFollowUpQueue = useCallback(
    (options?: { force?: boolean; onlyId?: string }): boolean => {
      const queue = followUpsRef.current;

      if (queue.length === 0) {
        return false;
      }

      if (!options?.force && turnsRef.current.some((turn) => turn.running)) {
        return false;
      }

      const target = options?.onlyId
        ? queue.find((item) => item.id === options.onlyId)
        : queue[0];

      if (!target) {
        return false;
      }

      const dispatched = dispatchFollowUpToPty(target, options?.force ?? false);

      if (!dispatched) {
        return false;
      }

      setFollowUps((current) => current.filter((item) => item.id !== target.id));
      return true;
    },
    [dispatchFollowUpToPty],
  );

  const enqueueFollowUp = useCallback(
    (content: string, attachments: AgentPromptAttachment[]): boolean => {
      const fields = resolveFollowUpEnqueueFields(content);
      const item: AgentFollowUp = {
        id: crypto.randomUUID(),
        content: fields.content,
        attachments,
        createdAt: Date.now(),
        mode: resolvePaneAgentMode(paneIdRef.current),
        ...(fields.skillLabel ? { skillLabel: fields.skillLabel } : {}),
        ...(fields.agentPrompt ? { agentPrompt: fields.agentPrompt } : {}),
      };

      setFollowUps((current) => [...current, item]);
      return true;
    },
    [],
  );

  const removeFollowUp = useCallback((id: string) => {
    setFollowUps((current) => current.filter((item) => item.id !== id));
  }, []);

  const editFollowUp = useCallback(
    (id: string) => {
      const item = followUpsRef.current.find((entry) => entry.id === id);

      if (!item) {
        return;
      }

      setFollowUps((current) => current.filter((entry) => entry.id !== id));
      onRestoreDraftRef.current?.(resolveFollowUpAgentPrompt(item));

      for (const attachment of item.attachments) {
        void attachAgentPromptImageToPane(projectPath, paneIdRef.current, attachment.dataUrl, false);
      }
    },
    [projectPath],
  );

  const sendFollowUpNow = useCallback(
    (id: string) => {
      tryFlushFollowUpQueue({ force: true, onlyId: id });
    },
    [tryFlushFollowUpQueue],
  );

  promotePendingFollowUpTurnRef.current = promotePendingFollowUpTurn;
  tryFlushFollowUpQueueRef.current = tryFlushFollowUpQueue;

  const submitPrompt = useCallback(
    async (prompt: string, options?: AgentPromptSubmitOptions): Promise<boolean> => {
      const trimmed = prompt.trim();
      const hasDisplayOverride = options?.displayContent !== undefined;
      const displayContent = hasDisplayOverride ? options.displayContent!.trim() : trimmed;
      const attachments = snapshotAttachments(paneIdRef.current);
      const imageRefs = attachments
        .map((attachment) =>
          attachment.relativePath ? buildImagePathReference(attachment.relativePath) : '',
        )
        .filter(Boolean);

      if ((!trimmed && imageRefs.length === 0) || (!usesStreamJson && !ptyIdRef.current)) {
        return false;
      }

      if (submitInFlightRef.current && !options?.forceNewTurn) {
        return false;
      }

      if (submitInFlightRef.current && options?.forceNewTurn) {
        stopAgent();
      }

      const hasRunningTurn = turnsRef.current.some((turn) => turn.running);

      const editingTurnId = editingTurnIdRef.current;

      if (hasRunningTurn && !editingTurnId) {
        if (options?.forceNewTurn) {
          stopAgent();
        } else {
          useTerminalPasteImageStore.getState().clearPaneImages(paneIdRef.current);
          return enqueueFollowUp(trimmed, attachments);
        }
      }

      if (editingTurnId) {
        editingTurnIdRef.current = null;
        setEditingTurnId(null);
        await rollbackAgentFromTurn(editingTurnId);
        setFollowUps([]);
      }

      submitInFlightRef.current = true;
      submitAbortRef.current = false;
      setIsSubmitting(true);
      approvalConfirmedTurnRef.current = null;
      clearApprovalConfirmTimer();

      if (submitTimeoutRef.current !== null) {
        window.clearTimeout(submitTimeoutRef.current);
      }

      submitTimeoutRef.current = window.setTimeout(() => {
        submitAbortRef.current = true;
      }, SUBMIT_GATE_TIMEOUT_MS);

      try {
        const paneId = paneIdRef.current;
        const shouldAbort = () => submitAbortRef.current;

        if (pendingSetupRef.current && !usesStreamJson) {
          await Promise.race([pendingSetupRef.current, delay(SUBMIT_SETUP_TIMEOUT_MS)]);
        }

        if (shouldAbort()) {
          return false;
        }

        const composerReady = await waitForComposerAgentReady(shouldAbort);

        if (!composerReady || shouldAbort()) {
          return false;
        }

        if (!usesStreamJson) {
          finalizeActiveTurn();
          parserStateRef.current = createAgentTranscriptParserState();
        } else {
          parserStateRef.current = createAgentTranscriptParserState();
        }

        streamJsonStateRef.current = createAgentStreamJsonParserState();

        const resolvedSkillLabel =
          options?.skillLabel?.trim() ||
          (isAgentSkillSlashCommand(displayContent) ? displayContent : undefined);

        const resolvedUser = await resolveSubmitAgentUserMessage(
          agentRootPath,
          displayContent,
          attachments,
        );

        const user = createUserMessage(
          resolvedUser.content,
          resolvedUser.attachments ?? attachments,
          resolvePaneAgentMode(paneIdRef.current),
          {
            ...(trimmed !== displayContent ? { agentPrompt: trimmed } : {}),
            ...(resolvedSkillLabel ? { skillLabel: resolvedSkillLabel } : {}),
          },
        );
        const turn = createTurn(user);

        if (usesStreamJson) {
          turn.activities = createInitialTurnActivities();
          markStreamJsonTurnStarted();
        }

        persistTurns([...turnsRef.current, turn], { flush: true });

        await delay(PROMPT_CLEAR_DELAY_MS);

        if (shouldAbort()) {
          return false;
        }

        turnOutputStartRef.current = outputTailRef.current.length;
        turnOutputBufferRef.current = '';
        sendPromptToPty(trimmed, imageRefs);
        resetAgentReadyDetectors(paneId);
        setIsAgentReady(false);

        useTerminalPasteImageStore.getState().clearPaneImages(paneIdRef.current);

        return true;
      } finally {
        if (submitTimeoutRef.current !== null) {
          window.clearTimeout(submitTimeoutRef.current);
          submitTimeoutRef.current = null;
        }

        submitAbortRef.current = false;
        submitInFlightRef.current = false;
        setIsSubmitting(false);
      }
    },
    [
      clearApprovalConfirmTimer,
      enqueueFollowUp,
      finalizeActiveTurn,
      markStreamJsonTurnStarted,
      persistTurns,
      rollbackAgentFromTurn,
      sendPromptToPty,
      stopAgent,
      waitForComposerAgentReady,
      usesStreamJson,
    ],
  );

  const submitQuestionAnswers = useCallback(
    async (activityId: string, answers: AgentQuestionAnswers): Promise<boolean> => {
      const turns = turnsRef.current;
      const latestTurn = turns[turns.length - 1];

      if (!latestTurn || latestTurn.running || turns.some((turn) => turn.running)) {
        return false;
      }

      const activity = latestTurn.activities.find((entry) => entry.id === activityId);

      if (
        !activity ||
        activity.kind !== 'question' ||
        activity.questionStatus !== 'pending' ||
        !activity.questions ||
        !isAgentQuestionAnswerComplete(activity.questions, answers)
      ) {
        return false;
      }

      const prompt = buildAgentQuestionAnswerPrompt(activity.questions, answers);

      if (!prompt.trim()) {
        return false;
      }

      const nextTurns = turns.map((turn, index) => {
        if (index !== turns.length - 1) {
          return turn;
        }

        return {
          ...turn,
          activities: turn.activities.map((entry) =>
            entry.id === activityId
              ? {
                  ...entry,
                  questionStatus: 'answered' as const,
                  questionAnswers: answers,
                }
              : entry,
          ),
        };
      });

      persistTurns(nextTurns, { flush: true });

      return submitPrompt(prompt);
    },
    [persistTurns, submitPrompt],
  );

  const acceptPlan = useCallback(
    async (activityId: string): Promise<boolean> => {
      const turns = turnsRef.current;
      const latestTurn = turns[turns.length - 1];

      if (!latestTurn || latestTurn.running || turns.some((turn) => turn.running)) {
        return false;
      }

      const activity = latestTurn.activities.find((entry) => entry.id === activityId);

      if (!activity || activity.kind !== 'plan' || activity.planStatus !== 'pending') {
        return false;
      }

      let planBody = activity.planBody?.trim() ?? '';

      if (!planBody && activity.planUri) {
        const resolved = await resolvePlanBodyFromUri(activity.planUri);
        planBody = resolved?.trim() ?? '';
      }

      if (!planBody) {
        planBody = activity.planOverview?.trim() ?? '';
      }

      if (!planBody) {
        useToastStore.getState().showToast('Não foi possível carregar o conteúdo do plano');
        return false;
      }

      const nextTurns = turns.map((turn, index) => {
        if (index !== turns.length - 1) {
          return turn;
        }

        return {
          ...turn,
          activities: turn.activities.map((entry) =>
            entry.id === activityId
              ? {
                  ...entry,
                  planStatus: 'building' as const,
                  ...(entry.planBody ? {} : { planBody }),
                }
              : entry,
          ),
        };
      });

      persistTurns(nextTurns, { flush: true });
      runCommand('/agent\n');

      const submitted = await submitPrompt(buildAgentPlanImplementPrompt(planBody, activity.planName));

      if (!submitted) {
        persistTurns(
          turns.map((turn, index) => {
            if (index !== turns.length - 1) {
              return turn;
            }

            return {
              ...turn,
              activities: turn.activities.map((entry) =>
                entry.id === activityId ? { ...entry, planStatus: 'pending' as const } : entry,
              ),
            };
          }),
          { flush: true },
        );
      }

      return submitted;
    },
    [persistTurns, runCommand, submitPrompt],
  );

  const rejectPlan = useCallback(
    (activityId: string): boolean => {
      const turns = turnsRef.current;
      const latestTurn = turns[turns.length - 1];

      if (!latestTurn || latestTurn.running || turns.some((turn) => turn.running)) {
        return false;
      }

      const activity = latestTurn.activities.find((entry) => entry.id === activityId);

      if (!activity || activity.kind !== 'plan' || activity.planStatus !== 'pending') {
        return false;
      }

      const nextTurns = turns.map((turn, index) => {
        if (index !== turns.length - 1) {
          return turn;
        }

        return {
          ...turn,
          activities: turn.activities.map((entry) =>
            entry.id === activityId ? { ...entry, planStatus: 'rejected' as const } : entry,
          ),
        };
      });

      persistTurns(nextTurns, { flush: true });
      return true;
    },
    [persistTurns],
  );

  useEffect(() => {
    const planId = pendingPlanActivity?.id;
    const planUri = pendingPlanActivity?.planUri;

    if (!planId || !planUri || pendingPlanActivity?.planBody?.trim()) {
      return;
    }

    let cancelled = false;
    let attempt = 0;
    let timeoutId: number | undefined;

    const applyPlanBody = (planBody: string) => {
      const nextTurns = turnsRef.current.map((turn, index) => {
        if (index !== turnsRef.current.length - 1) {
          return turn;
        }

        return {
          ...turn,
          activities: turn.activities.map((entry) =>
            entry.id === planId
              ? {
                  ...entry,
                  planBody,
                  planTodos:
                    entry.planTodos && entry.planTodos.length > 0
                      ? entry.planTodos
                      : parsePlanTodosFromMarkdown(planBody),
                }
              : entry,
          ),
        };
      });

      persistTurns(nextTurns, { flush: true });
    };

    const tryResolve = () => {
      void resolvePlanBodyFromUri(planUri).then((planBody) => {
        if (cancelled) {
          return;
        }

        if (planBody?.trim()) {
          applyPlanBody(planBody.trim());
          return;
        }

        attempt += 1;

        if (attempt >= PLAN_BODY_RESOLVE_MAX_ATTEMPTS) {
          return;
        }

        timeoutId = window.setTimeout(tryResolve, PLAN_BODY_RESOLVE_BASE_DELAY_MS * attempt);
      });
    };

    tryResolve();

    return () => {
      cancelled = true;

      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    persistTurns,
    pendingPlanActivity?.id,
    pendingPlanActivity?.planUri,
    pendingPlanActivity?.planBody,
  ]);

  const editAgentTurn = useCallback(
    (turnId: string): boolean => {
      const target = turnsRef.current.find((turn) => turn.id === turnId);

      if (!target || target.running || target.pendingFollowUp) {
        return false;
      }

      if (turnsRef.current.some((turn) => turn.running)) {
        stopAgent();
      }

      editingTurnIdRef.current = turnId;
      setEditingTurnId(turnId);
      setFollowUps([]);

      useTerminalPasteImageStore.getState().clearPaneImages(paneIdRef.current);
      onRestoreDraftRef.current?.(target.user.agentPrompt ?? target.user.content);

      const turnMode = target.user.mode ?? 'agent';
      const currentMode = resolvePaneAgentMode(paneIdRef.current);

      if (turnMode !== currentMode) {
        runCommand(`/${turnMode}\n`);
      }

      for (const attachment of target.user.attachments ?? []) {
        void attachAgentPromptImageToPane(projectPath, paneIdRef.current, attachment.dataUrl, false);
      }

      return true;
    },
    [projectPath, runCommand, stopAgent],
  );

  const cancelAgentTurnEdit = useCallback((): boolean => {
    if (!editingTurnIdRef.current) {
      return false;
    }

    editingTurnIdRef.current = null;
    setEditingTurnId(null);
    onRestoreDraftRef.current?.('');
    useTerminalPasteImageStore.getState().clearPaneImages(paneIdRef.current);
    return true;
  }, []);

  const redoAgentTurn = useCallback(
    async (turnId: string) => {
      const turns = turnsRef.current;
      const index = turns.findIndex((turn) => turn.id === turnId);

      if (index === -1) {
        return false;
      }

      const target = turns[index]!;
      const rolledBack = await rollbackAgentFromTurn(turnId);

      if (!rolledBack) {
        return false;
      }

      return submitPrompt(target.user.agentPrompt ?? target.user.content);
    },
    [rollbackAgentFromTurn, submitPrompt],
  );

  const appendDraft = useCallback((text: string) => {
    onAppendDraftRef.current?.(text);
    return true;
  }, []);

  const failStuckTurn = useCallback(() => {
    const turns = turnsRef.current;
    const index = [...turns].reverse().findIndex((turn) => turn.running);
    const resolvedIndex = index === -1 ? -1 : turns.length - 1 - index;

    if (resolvedIndex === -1) {
      return;
    }

    const nextTurns = [...turns];
    const activeTurn = nextTurns[resolvedIndex]!;
    const withoutThought = activeTurn.activities.filter(
      (entry) => entry.kind !== 'thought' && entry.kind !== 'live_status' && entry.kind !== 'tool_run',
    );

    nextTurns[resolvedIndex] = finalizeAgentTurn(
      {
        ...activeTurn,
        activities: [...withoutThought, createFailedPromptActivity()],
      },
      parserStateRef.current,
    );

    parserStateRef.current = createAgentTranscriptParserState();
    persistTurns(nextTurns, { flush: true });
    useTerminalSessionStore.getState().resetAgentWorkload(paneIdRef.current);
    writeToPty('\x1b');
    void delay(PROMPT_CLEAR_DELAY_MS).then(() => {
      writeToPty(PTY_CLEAR_INPUT);
    });
  }, [persistTurns, writeToPty]);

  const tabCliAgent = resolveAgentTabCli(tab);
  const tabRestoreCommand = tab.restoreCommand?.trim() ?? '';

  useEffect(() => {
    streamJsonBootstrappedRef.current = false;
    stalePtyClearedRef.current = null;
  }, [tab.id]);

  const bootstrapStreamJsonAgent = useCallback(() => {
    if (streamJsonBootstrappedRef.current) {
      return;
    }

    streamJsonBootstrappedRef.current = true;

    const paneId = paneIdRef.current;
    const session = useTerminalSessionStore.getState();

    session.takePendingLaunchCommand(paneId);
    session.setActiveAgent(paneId, tabCliAgent);
    setIsAgentReady(true);
  }, [tabCliAgent]);

  const clearStaleAgentPty = useCallback(async (currentPtyId: string) => {
    if (stalePtyClearedRef.current === currentPtyId) {
      return;
    }

    stalePtyClearedRef.current = currentPtyId;

    if (await window.nexus.terminal.has(currentPtyId)) {
      window.nexus.terminal.kill(currentPtyId);
    }

    ptyIdRef.current = null;
    setActivePtyId(null);

    if (tab.ptyId) {
      onPtyLostRef.current();
    }
  }, [tab.ptyId]);

  const spawnAgentPty = useCallback(async () => {
    if (creatingRef.current || ptyIdRef.current) {
      return;
    }

    deferAutoSpawnRef.current = false;
    creatingRef.current = true;
    try {
      const terminalAgent = cliAgentToTerminalAgent(tabCliAgent);
      const createdPtyId = await window.nexus.terminal.create(agentRootPath, terminalAgent);
      ptyIdRef.current = createdPtyId;
      setActivePtyId(createdPtyId);
      setIsAgentReady(false);
      onPtyCreatedRef.current(createdPtyId);
      useTerminalSessionStore.getState().setActiveAgent(paneIdRef.current, tabCliAgent);

      window.setTimeout(() => {
        if (ptyIdRef.current !== createdPtyId) {
          return;
        }

        const pendingCommand = buildAgentPaneLaunchCommand(
          useTerminalSessionStore.getState().takePendingLaunchCommand(paneIdRef.current) ??
            tabRestoreCommand ??
            tabCliAgent,
        );

        if (!pendingCommand) {
          if (isCursorAgentStreamJsonCli(tabCliAgent)) {
            setIsAgentReady(true);
          }
          return;
        }

        window.nexus.terminal.write(createdPtyId, `${pendingCommand}\n`);
        useTerminalSessionStore.getState().setLastCommand(paneIdRef.current, pendingCommand);
      }, LAUNCH_COMMAND_DELAY_MS);
    } finally {
      creatingRef.current = false;
    }
  }, [agentRootPath, tabCliAgent, tabRestoreCommand]);

  useEffect(() => {
    void (async () => {
      if (!isRuntimeActiveRef.current) {
        return;
      }

      if (deferAutoSpawnRef.current) {
        if (usesStreamJson) {
          bootstrapStreamJsonAgent();
        }

        return;
      }

      if (usesStreamJson) {
        const stalePtyId = ptyIdRef.current ?? tab.ptyId;

        if (stalePtyId) {
          await clearStaleAgentPty(stalePtyId);
        }

        bootstrapStreamJsonAgent();
        return;
      }

      const currentPtyId = ptyIdRef.current ?? tab.ptyId;

      if (currentPtyId && (await window.nexus.terminal.has(currentPtyId))) {
        ptyIdRef.current = currentPtyId;
        setActivePtyId(currentPtyId);
        useTerminalSessionStore.getState().takePendingLaunchCommand(paneIdRef.current);
        return;
      }

      if (currentPtyId) {
        ptyIdRef.current = null;
        setActivePtyId(null);
        setIsAgentReady(false);

        if (tab.ptyId) {
          onPtyLostRef.current();
        }
      }

      if (!ptyIdRef.current && !creatingRef.current) {
        await spawnAgentPty();
      }
    })();
  }, [isRuntimeActive, spawnAgentPty, tab.id, tab.ptyId, tabCliAgent, usesStreamJson]);

  const isBootstrapping =
    !deferAutoSpawnRef.current &&
    (usesStreamJson ? !isAgentReady && hasPendingLaunch : !activePtyId || hasPendingLaunch);

  useEffect(() => {
    if (!activePtyId || !isRuntimeActive || isAgentReady) {
      return;
    }

    let cancelled = false;

    const pollScrollback = async () => {
      if (cancelled) {
        return;
      }

      const scrollback = await window.nexus.terminal.getScrollbackTail(
        activePtyId,
        AGENT_OUTPUT_TAIL_SIZE,
      );

      if (cancelled) {
        return;
      }

      const tail = (scrollback ?? '').slice(-AGENT_OUTPUT_TAIL_SIZE);
      outputTailRef.current = cleanAgentPtyChunk(tail).replace(/\r/g, '\n');
      syncAgentReadyFromTail(tail);
      syncContextUsageFromTail(outputTailRef.current);
    };

    void pollScrollback();
    const intervalId = window.setInterval(() => {
      void pollScrollback();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activePtyId, isAgentReady, isRuntimeActive, syncAgentReadyFromTail, syncContextUsageFromTail]);

  useEffect(() => {
    const paneId = paneIdRef.current;
    const ptyId = activePtyId;

    if (!ptyId || !isRuntimeActive || !isVisible) {
      return;
    }

    let cancelled = false;

    void window.nexus.terminal.getScrollbackTail(ptyId, AGENT_OUTPUT_TAIL_SIZE).then((scrollback) => {
      if (cancelled) {
        return;
      }

      const tail = (scrollback ?? '').slice(-AGENT_OUTPUT_TAIL_SIZE);
      outputTailRef.current = cleanAgentPtyChunk(tail).replace(/\r/g, '\n');
      syncAgentReadyFromTail(tail);
      syncContextUsageFromTail(outputTailRef.current);

      const hasRunningTurn = turnsRef.current.some((turn) => turn.running);

      if (hasRunningTurn) {
        return;
      }

      if (detectAgentReadyInChunk(tail) || detectAgentFollowUpReadyInChunk(tail)) {
        useTerminalSessionStore.getState().resetAgentWorkload(paneId);
        syncAgentBusyFromTail(
          paneId,
          tail,
          resolveAgentPaneActiveWorkload(paneId, false),
          useTerminalSessionStore.getState().setAgentBusy,
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activePtyId, isRuntimeActive, isVisible, syncAgentReadyFromTail, syncContextUsageFromTail, tab.id]);

  useEffect(() => {
    const paneId = paneIdRef.current;

    if (!activePtyId) {
      return;
    }

    const completeIfReady = () => {
      if (usesStreamJson && turnsRef.current.some((turn) => turn.running)) {
        return;
      }

      finalizeActiveTurn(true);
      syncAgentReadyFromTail(outputTailRef.current);
    };

    const agentDetector = createAgentReadyStreamDetector(completeIfReady, {
      isAwaiting: () => {
        const session = useTerminalSessionStore.getState();
        return isPaneTrackingAgentCompletion(
          paneId,
          session.awaitingResponseByPane,
          session.agentNotifyEligibleByPane,
          session.agentBusyByPane,
        );
      },
      isBlocked: () => Boolean(useTerminalSessionStore.getState().agentBusyByPane[paneId]),
    });

    const unsubscribeData = window.nexus.terminal.onData((incomingPtyId, data) => {
      if (incomingPtyId !== activePtyId) {
        return;
      }

      agentDetector.feed(data);
      feedMobileReleaseOutput(paneId, data);

      const cleaned = cwdParserRef.current(cleanAgentPtyChunk(data)).replace(/\r/g, '\n');

      if (cleaned) {
        outputTailRef.current = `${outputTailRef.current}${cleaned}`.slice(-AGENT_OUTPUT_TAIL_SIZE);

        const hasRunningTurn = turnsRef.current.some((turn) => turn.running);

        if (hasRunningTurn && !usesStreamJson) {
          turnOutputBufferRef.current = `${turnOutputBufferRef.current}${cleaned}`.slice(
            -AGENT_TURN_OUTPUT_MAX,
          );
        }

        syncContextUsageFromTail(outputTailRef.current);

        syncAgentReadyFromTail(outputTailRef.current);
        syncAgentBusyFromTail(
          paneId,
          outputTailRef.current,
          resolveAgentPaneActiveWorkload(paneId, hasRunningTurn),
          useTerminalSessionStore.getState().setAgentBusy,
        );

        if (
          !hasRunningTurn &&
          detectAgentFollowUpReadyInChunk(outputTailRef.current)
        ) {
          useTerminalSessionStore.getState().resetAgentWorkload(paneId);
        }

        if (hasRunningTurn) {
          updateActiveTurn((turn) => feedAgentTranscriptChunk(turn, cleaned, parserStateRef.current));
        }

        const launchError = detectAgentLaunchErrorInTail(outputTailRef.current);

        if (launchError && hasRunningTurn) {
          updateActiveTurn((turn) => ({
            ...turn,
            activities: [
              ...turn.activities.filter(
                (entry) =>
                  entry.kind !== 'response' &&
                  !(entry.kind === 'thought' && !entry.label.trim()) &&
                  entry.kind !== 'live_status' &&
                  entry.kind !== 'tool_run',
              ),
              createFailedPromptActivity(launchError),
            ],
          }));
          finalizeActiveTurn();
          useTerminalSessionStore.getState().resetAgentWorkload(paneId);
        } else if (!usesStreamJson) {
          scheduleSmartModeApproval();
        }

        if (
          followUpsRef.current.length > 0 &&
          detectAgentFollowUpReadyInChunk(outputTailRef.current)
        ) {
          tryFlushFollowUpQueueRef.current();
        }
      }
    });

    const unsubscribeExit = window.nexus.terminal.onExit((incomingPtyId) => {
      if (incomingPtyId !== activePtyId) {
        return;
      }

      finalizeActiveTurn();
      ptyIdRef.current = null;
      setActivePtyId(null);
      setContextUsage(null);
      setContextUsageLoading(false);
      contextUsageReportPendingRef.current = false;
      clearContextUsageReportTimer();

      if (usesStreamJson && !turnsRef.current.some((turn) => turn.running)) {
        setIsAgentReady(true);
        return;
      }

      setIsAgentReady(false);
      onPtyLostRef.current();
    });

    return () => {
      unsubscribeData();
      unsubscribeExit();
      clearApprovalConfirmTimer();
      clearContextUsageReportTimer();
    };
  }, [activePtyId, clearApprovalConfirmTimer, clearContextUsageReportTimer, finalizeActiveTurn, scheduleSmartModeApproval, syncAgentReadyFromTail, syncContextUsageFromTail, updateActiveTurn, usesStreamJson]);

  useEffect(() => {
    if (!usesStreamJson) {
      return;
    }

    const paneId = paneIdRef.current;

    return registerAgentPrintPaneHandlers(paneId, {
      onData: (incomingPaneId, data, runToken) => {
        if (incomingPaneId !== paneIdRef.current) {
          return;
        }

        const expectedToken = resolveAgentPrintRunToken(paneIdRef.current);

        if (!expectedToken || runToken !== expectedToken) {
          return;
        }

        if (!agentPrintRunTokenRef.current) {
          agentPrintRunTokenRef.current = runToken;
          agentPrintRunActiveRef.current = true;
        }

        if (
          !agentPrintRunActiveRef.current &&
          !turnsRef.current.some((turn) => turn.running)
        ) {
          return;
        }

        if (applyStreamJsonChunk(data)) {
          scheduleStreamJsonSettleCheck();
        }
      },
      onDone: (incomingPaneId, payload) => {
        if (incomingPaneId !== paneIdRef.current) {
          return;
        }

        const expectedToken = resolveAgentPrintRunToken(paneIdRef.current);

        if (!expectedToken || payload.runToken !== expectedToken) {
          return;
        }

        agentPrintRunActiveRef.current = false;
        const turnStartedAt = [...turnsRef.current].reverse().find((turn) => turn.running)?.startedAt ?? null;
        // #region agent log
        writeDebugSessionLog({
          location: 'useAgentPaneSession.ts:onDone',
          message: 'agentPrint onDone received',
          data: {
            code: payload.code,
            error: payload.error ?? null,
            elapsedMs: turnStartedAt ? Date.now() - turnStartedAt : null,
            shouldFinalize: streamJsonStateRef.current.shouldFinalize,
            hasMeaningful: hasMeaningfulStreamJsonTurnOutput(streamJsonStateRef.current),
            autoRetryUsed: streamJsonAutoRetryRef.current,
            activityKinds: streamJsonStateRef.current.activities.map((entry) => entry.kind),
          },
          hypothesisId: 'A',
        });
        // #endregion

        const finishAgentPrintRun = () => {
          clearAgentPrintRunToken(paneIdRef.current);
        };

        if (applyStreamJsonChunk('')) {
          if (!hasMeaningfulStreamJsonTurnOutput(streamJsonStateRef.current)) {
            if (tryScheduleStreamJsonAutoRetry(finishAgentPrintRun)) {
              return;
            }

            updateActiveTurn((turn) => ({
              ...turn,
              activities: [
                ...turn.activities.filter(
                  (entry) =>
                    entry.kind !== 'response' &&
                    !(entry.kind === 'thought' && !entry.label.trim()) &&
                    entry.kind !== 'live_status' &&
                    entry.kind !== 'tool_run',
                ),
                createFailedPromptActivity(
                  'O agente encerrou sem responder. Envie novamente para continuar.',
                ),
              ],
            }));
            finalizeActiveTurn(true);
            finishAgentPrintRun();
            streamJsonAutoRetryRef.current = false;
            return;
          }

          finalizeStreamJsonTurnFromEvent('onDone-shouldFinalize');
          finishAgentPrintRun();
          return;
        }

        const activePaneId = paneIdRef.current;

        if (!turnsRef.current.some((turn) => turn.running)) {
          useTerminalSessionStore.getState().completeTaskIfAwaiting(activePaneId);

          if (followUpsRef.current.length > 0) {
            tryFlushFollowUpQueueRef.current({ force: true });
          }

          finishAgentPrintRun();
          return;
        }

        if (payload.error && !streamJsonStateRef.current.shouldFinalize) {
          updateActiveTurn((turn) => ({
            ...turn,
            activities: [
              ...turn.activities.filter(
                (entry) =>
                  entry.kind !== 'response' &&
                  !(entry.kind === 'thought' && !entry.label.trim()) &&
                  entry.kind !== 'live_status' &&
                  entry.kind !== 'tool_run',
              ),
              createFailedPromptActivity(payload.error),
            ],
          }));
          finalizeActiveTurn(true);
          finishAgentPrintRun();
          return;
        }

        if (
          payload.code !== 0 &&
          !streamJsonStateRef.current.shouldFinalize &&
          !streamJsonStateRef.current.pendingResponseText.trim()
        ) {
          updateActiveTurn((turn) => ({
            ...turn,
            activities: [
              ...turn.activities.filter(
                (entry) =>
                  entry.kind !== 'response' &&
                  !(entry.kind === 'thought' && !entry.label.trim()) &&
                  entry.kind !== 'live_status' &&
                  entry.kind !== 'tool_run',
              ),
              createFailedPromptActivity(
                payload.error ?? 'Não foi possível executar o agent. Verifique se o cursor-agent está instalado.',
              ),
            ],
          }));
          finalizeActiveTurn(true);
          finishAgentPrintRun();
          return;
        }

        if (streamJsonStateRef.current.shouldFinalize) {
          if (
            !hasMeaningfulStreamJsonTurnOutput(streamJsonStateRef.current) &&
            payload.code === 0 &&
            !payload.error &&
            tryScheduleStreamJsonAutoRetry(finishAgentPrintRun)
          ) {
            return;
          }

          if (!hasMeaningfulStreamJsonTurnOutput(streamJsonStateRef.current)) {
            streamJsonStateRef.current.shouldFinalize = false;
            updateActiveTurn((turn) => ({
              ...turn,
              activities: [
                ...turn.activities.filter(
                  (entry) =>
                    entry.kind !== 'response' &&
                    !(entry.kind === 'thought' && !entry.label.trim()) &&
                    entry.kind !== 'live_status' &&
                    entry.kind !== 'tool_run',
                ),
                createFailedPromptActivity(
                  'O agente encerrou sem responder. Envie novamente para continuar.',
                ),
              ],
            }));
            finalizeActiveTurn(true);
            finishAgentPrintRun();
            streamJsonAutoRetryRef.current = false;
            return;
          }

          finalizeStreamJsonTurnFromEvent('onDone-shouldFinalize-late');
          finishAgentPrintRun();
          return;
        }

        if (
          payload.code === 0 &&
          !payload.error &&
          !hasMeaningfulStreamJsonTurnOutput(streamJsonStateRef.current) &&
          tryScheduleStreamJsonAutoRetry(finishAgentPrintRun)
        ) {
          return;
        }

        if (
          payload.code === 0 &&
          !payload.error &&
          !streamJsonStateRef.current.shouldFinalize &&
          turnsRef.current.some((turn) => turn.running)
        ) {
          if (!hasMeaningfulStreamJsonTurnOutput(streamJsonStateRef.current)) {
            updateActiveTurn((turn) => ({
              ...turn,
              activities: [
                ...turn.activities.filter(
                  (entry) =>
                    entry.kind !== 'response' &&
                    !(entry.kind === 'thought' && !entry.label.trim()) &&
                    entry.kind !== 'live_status' &&
                    entry.kind !== 'tool_run',
                ),
                createFailedPromptActivity(
                  'O agente encerrou sem responder. Envie novamente para continuar.',
                ),
              ],
            }));
            finalizeActiveTurn(true);
            finishAgentPrintRun();
            streamJsonAutoRetryRef.current = false;
            return;
          }

          applyStreamJsonChunk('');
          finalizeActiveTurn(true);
          finishAgentPrintRun();
          streamJsonAutoRetryRef.current = false;
          return;
        }

        finalizeActiveTurn(true);
        finishAgentPrintRun();
        streamJsonAutoRetryRef.current = false;
      },
    });
  }, [
    applyStreamJsonChunk,
    clearAgentPrintRunToken,
    finalizeActiveTurn,
    finalizeStreamJsonTurnFromEvent,
    resolveAgentPrintRunToken,
    startStreamJsonAgentRun,
    tab.id,
    tryScheduleStreamJsonAutoRetry,
    updateActiveTurn,
    usesStreamJson,
  ]);

  useEffect(() => {
    if (!usesStreamJson || !isTurnRunning) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (!turnsRef.current.some((turn) => turn.running)) {
        return;
      }

      const paneId = paneIdRef.current;
      const latestTurn = [...turnsRef.current].reverse().find((turn) => turn.running);
      const turnStartedAt = latestTurn?.startedAt ?? Date.now();
      const idleAnchor = Math.max(lastStreamJsonChunkAtRef.current, turnStartedAt);
      const idleMs = Date.now() - idleAnchor;
      const storedToken = resolveAgentPrintRunToken(paneId);

      void window.nexus.agentPrint.isRunning(paneId).then((processRunning) => {
        if (processRunning) {
          if (!agentPrintRunTokenRef.current && storedToken) {
            agentPrintRunTokenRef.current = storedToken;
            agentPrintRunActiveRef.current = true;
          }

          if (Date.now() - turnStartedAt >= STREAM_JSON_ABSOLUTE_MAX_MS) {
            forceSettleStreamJsonInFlightWork(streamJsonStateRef.current);
            applyStreamJsonChunk('');

            if (!streamJsonStateRef.current.shouldFinalize) {
              tryMarkStreamJsonReadyToFinalize(streamJsonStateRef.current);
            }

            agentPrintRunActiveRef.current = false;
            window.nexus.agentPrint.stop(paneId);
            clearAgentPrintRunToken(paneId);

            if (streamJsonStateRef.current.shouldFinalize) {
              finalizeStreamJsonTurnFromEvent();
            } else {
              finalizeActiveTurn(true);
            }

            return;
          }

          if (tryHandoffLongRunningDevShell(idleMs)) {
            agentPrintRunActiveRef.current = false;
            window.nexus.agentPrint.stop(paneId);
            clearAgentPrintRunToken(paneId);
            finalizeStreamJsonTurnFromEvent();
            return;
          }

          if (idleMs >= STREAM_JSON_STALL_UI_MS) {
            syncStreamJsonStallLiveStatus(idleMs);
          }

          return;
        }

        if (
          idleMs >= STREAM_JSON_RESPONSE_IDLE_FINALIZE_MS &&
          tryFinalizeSettledStreamJsonTurn(false, 'idleInterval')
        ) {
          return;
        }

        if (agentPrintRunActiveRef.current) {
          if (idleMs < STREAM_JSON_DEAD_PROCESS_FINALIZE_MS) {
            return;
          }

          agentPrintRunActiveRef.current = false;
          clearAgentPrintRunToken(paneId);
          window.nexus.agentPrint.stop(paneId);

          if (streamJsonStateRef.current.shouldFinalize) {
            finalizeStreamJsonTurnFromEvent();
            return;
          }

          if (hasMeaningfulStreamJsonTurnOutput(streamJsonStateRef.current)) {
            applyStreamJsonChunk('');
            finalizeActiveTurn(true);
            return;
          }

          lastStreamJsonChunkAtRef.current = Date.now();
          return;
        }

        if (storedToken && !processRunning) {
          if (idleMs < STREAM_JSON_INCOMPLETE_ORPHAN_FINALIZE_MS) {
            return;
          }

          if (
            !hasMeaningfulStreamJsonTurnOutput(streamJsonStateRef.current) &&
            tryScheduleStreamJsonAutoRetry(() => {
              clearAgentPrintRunToken(paneId);
              window.nexus.agentPrint.stop(paneId);
            })
          ) {
            return;
          }
        }

        const streamState = streamJsonStateRef.current;
        const hasPendingInteraction =
          hasPendingStreamJsonInteraction(streamState) ||
          Boolean(latestTurn && hasPendingAgentQuestion(latestTurn.activities));
        const hasRenderablePendingInteraction = Boolean(
          latestTurn &&
            (hasPendingAgentPlan(latestTurn.activities) ||
              hasPendingAgentQuestion(latestTurn.activities)),
        );

        if (hasPendingInteraction && (processRunning || agentPrintRunActiveRef.current)) {
          return;
        }

        if (hasPendingInteraction && storedToken && !hasRenderablePendingInteraction) {
          return;
        }

        if (
          !hasStreamJsonChunkRef.current &&
          Date.now() - turnStartedAt < STREAM_JSON_STARTUP_GRACE_MS
        ) {
          return;
        }

        if (streamJsonAutoRetryRef.current && !processRunning) {
          return;
        }

        const processEnded = !processRunning && !agentPrintRunActiveRef.current && !storedToken;
        const missingResponse =
          !hasMeaningfulStreamJsonTurnOutput(streamState) &&
          (streamState.shouldFinalize || processEnded);
        const awaitingCompletion = isAgentStreamJsonStateAwaitingCompletion(streamState);
        const orphanThreshold =
          missingResponse
            ? STREAM_JSON_INCOMPLETE_ORPHAN_FINALIZE_MS
            : processEnded || streamState.shouldFinalize
              ? STREAM_JSON_ORPHAN_FINALIZE_MS
              : awaitingCompletion
                ? STREAM_JSON_INCOMPLETE_ORPHAN_FINALIZE_MS
                : STREAM_JSON_ORPHAN_FINALIZE_MS;

        if (idleMs < orphanThreshold) {
          return;
        }

        applyStreamJsonChunk('');

        if (streamJsonStateRef.current.shouldFinalize) {
          finalizeStreamJsonTurnFromEvent();
        } else {
          finalizeActiveTurn(true);
        }
      });
    }, STREAM_JSON_IDLE_CHECK_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    applyStreamJsonChunk,
    clearAgentPrintRunToken,
    finalizeActiveTurn,
    finalizeStreamJsonTurnFromEvent,
    isTurnRunning,
    syncStreamJsonStallLiveStatus,
    tryFinalizeSettledStreamJsonTurn,
    tryHandoffLongRunningDevShell,
    tryScheduleStreamJsonAutoRetry,
    usesStreamJson,
  ]);

  useEffect(() => {
    if (!isTurnRunning) {
      return;
    }

    const startedAt = Date.now();

    const intervalId = window.setInterval(() => {
      const hasRunningTurn = turnsRef.current.some((turn) => turn.running);

      if (!hasRunningTurn) {
        window.clearInterval(intervalId);
        return;
      }

      if (Date.now() - startedAt < STUCK_TURN_TIMEOUT_MS) {
        return;
      }

      if (usesStreamJson) {
        return;
      }

      const activeTurn = turnsRef.current.find((turn) => turn.running);

      if (!activeTurn) {
        return;
      }

      const hasProgress = activeTurn.activities.some(
        (entry) =>
          entry.kind === 'file_edit' ||
          entry.kind === 'file_read' ||
          entry.kind === 'status' ||
          entry.kind === 'response' ||
          (entry.kind === 'thought' && !entry.streaming && Boolean(entry.durationMs)),
      );

      if (detectSlashAutocompleteInTail(outputTailRef.current) || !hasProgress) {
        finalizeActiveTurn(true);
        window.clearInterval(intervalId);
      }
    }, STUCK_TURN_CHECK_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [finalizeActiveTurn, finalizeStreamJsonTurnFromEvent, isTurnRunning, usesStreamJson]);

  useEffect(() => {
    if (followUps.length === 0 || isTurnRunning || isSubmitting || hasPendingQuestion || hasPendingPlan) {
      return;
    }

    tryFlushFollowUpQueue({ force: true });
  }, [
    followUps.length,
    hasPendingPlan,
    hasPendingQuestion,
    isSubmitting,
    isTurnRunning,
    tryFlushFollowUpQueue,
  ]);

  useEffect(() => {
    return registerAgentPaneHandlers(paneIdRef.current, {
      submit: submitPrompt,
      stop: stopAgent,
      write: appendDraft,
      runCommand,
      redo: redoAgentTurn,
    });
  }, [appendDraft, redoAgentTurn, runCommand, stopAgent, submitPrompt, tab.id]);

  return {
    submitPrompt,
    stopAgent,
    runCommand,
    redoAgentTurn,
    editAgentTurn,
    cancelAgentTurnEdit,
    editingTurnId,
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
    isWritable: usesStreamJson ? isAgentReady : Boolean(ptyIdRef.current),
    contextUsage,
    contextUsageLoading,
    requestContextUsageReport,
  };
}

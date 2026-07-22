import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '@/types';
import type { AgentGitChangeGroup } from '@/types/agentGit';
import { registerAgentPrintPaneHandlers } from '@/utils/agentPrintBridge';
import { buildAgentSkillPrompt } from '@/utils/agentCliSession';
import { buildDailySkillContext } from '@/utils/buildDailySkillContext';
import {
  loadDailyResultsCache,
  writeDailyResultsCache,
  type CachedDailyResult,
  type DailyAgentResultEntry,
  type DailyAgentResultModalState,
  type DailyGenerationContext,
} from '@/utils/dailyAgentResultStore';
import {
  createAgentStreamJsonParserState,
  feedAgentStreamJsonChunk,
  hasMeaningfulStreamJsonTurnOutput,
} from '@/utils/agentStreamJsonParser';
import { resolveDailyAgentFinalResponse } from '@/utils/dailyAgentResponse';
import { buildDailyProjectMetaLabel } from '@/utils/buildDailyProjectMetaLabel';
import { isTranscriptionOnLocalDay } from '@/utils/brainTranscriptionLinks';
import {
  DAILY_RESPONSE_TONES,
  type DailyResponseTone,
} from '@/utils/dailyResponseTone';
import { recordHomeDashboardActivity } from '@/utils/recordHomeDashboardActivity';

export type {
  DailyAgentResultEntry,
  DailyAgentResultModalState,
  DailyAgentResultStatus,
  DailyGenerationContext,
} from '@/utils/dailyAgentResultStore';

const DAILY_AGENT_TIMEOUT_MS = 5 * 60 * 1000;

interface ActiveDailyRun {
  tone: DailyResponseTone;
  paneId: string;
  unregister: () => void;
  runToken: string;
  timeoutId: number | null;
}

function createLoadingResponses(): Record<DailyResponseTone, DailyAgentResultEntry> {
  return {
    'non-technical': { content: '', status: 'loading' },
    technical: { content: '', status: 'loading' },
  };
}

function isDailyResultComplete(modal: DailyAgentResultModalState): boolean {
  return DAILY_RESPONSE_TONES.every((tone) => modal.responses[tone].status !== 'loading');
}

export function useDailyAgentGeneration(projects: Project[]) {
  const [runningProjectId, setRunningProjectId] = useState<string | null>(null);
  const [resultModal, setResultModal] = useState<DailyAgentResultModalState | null>(null);
  const [cachedProjectIds, setCachedProjectIds] = useState<string[]>([]);
  const activeRunsRef = useRef<Map<DailyResponseTone, ActiveDailyRun>>(new Map());
  const pendingRunsRef = useRef(0);
  const cacheRef = useRef<Map<string, CachedDailyResult>>(new Map());
  const lastContextRef = useRef<DailyGenerationContext | null>(null);
  const hydratedProjectsKeyRef = useRef('');

  const projectIdsKey = useMemo(
    () => projects.map((project) => project.id).sort().join('|'),
    [projects],
  );

  const syncCachedProjectIds = useCallback(() => {
    setCachedProjectIds(Array.from(cacheRef.current.keys()));
  }, []);

  const persistCurrentResult = useCallback(
    (modal: DailyAgentResultModalState, context: DailyGenerationContext | null) => {
      if (!context || context.project.id !== modal.project.id || !isDailyResultComplete(modal)) {
        return;
      }

      cacheRef.current.set(modal.project.id, { modal, context });
      writeDailyResultsCache(cacheRef.current);
      syncCachedProjectIds();
    },
    [syncCachedProjectIds],
  );

  useEffect(() => {
    if (projectIdsKey === hydratedProjectsKeyRef.current) {
      return;
    }

    hydratedProjectsKeyRef.current = projectIdsKey;
    cacheRef.current = loadDailyResultsCache(projects);
    syncCachedProjectIds();
  }, [projectIdsKey, projects, syncCachedProjectIds]);

  const clearActiveRun = useCallback((tone: DailyResponseTone) => {
    const activeRun = activeRunsRef.current.get(tone);

    if (!activeRun) {
      return;
    }

    if (activeRun.timeoutId !== null) {
      window.clearTimeout(activeRun.timeoutId);
    }

    activeRun.unregister();
    activeRunsRef.current.delete(tone);
  }, []);

  const stopActiveRuns = useCallback(() => {
    if (window.nexus?.agentPrint) {
      for (const activeRun of activeRunsRef.current.values()) {
        if (activeRun.timeoutId !== null) {
          window.clearTimeout(activeRun.timeoutId);
        }

        window.nexus.agentPrint.stop(activeRun.paneId);
        activeRun.unregister();
      }
    }

    activeRunsRef.current.clear();
    pendingRunsRef.current = 0;
    setRunningProjectId(null);
  }, []);

  const finishRun = useCallback(
    (tone: DailyResponseTone) => {
      clearActiveRun(tone);
      pendingRunsRef.current = Math.max(0, pendingRunsRef.current - 1);

      if (pendingRunsRef.current === 0) {
        setRunningProjectId(null);
        window.queueMicrotask(() => {
          setResultModal((current) => {
            if (current) {
              persistCurrentResult(current, lastContextRef.current);
            }

            return current;
          });
        });
      }
    },
    [clearActiveRun, persistCurrentResult],
  );

  const closeModal = useCallback(() => {
    stopActiveRuns();

    setResultModal((current) => {
      if (current) {
        persistCurrentResult(current, lastContextRef.current);
      }

      return null;
    });
  }, [persistCurrentResult, stopActiveRuns]);

  const updateResponse = useCallback(
    (tone: DailyResponseTone, entry: DailyAgentResultEntry) => {
      setResultModal((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          responses: {
            ...current.responses,
            [tone]: entry,
          },
        };
      });
    },
    [],
  );

  const startToneRun = useCallback(
    async ({
      project,
      skill,
      groups,
      gitChanges,
      transcriptions,
      targetDate,
      tone,
      batchToken,
    }: DailyGenerationContext & { tone: DailyResponseTone; batchToken: string }) => {
      if (!window.nexus?.agentPrint) {
        return;
      }

      const context = buildDailySkillContext({
        projectName: project.name,
        groups,
        gitChanges,
        transcriptions,
        targetDate,
        responseTone: tone,
      });
      const prompt = buildAgentSkillPrompt(skill.command, context);
      const runToken = `${batchToken}:${tone}`;
      const paneId = `daily:${project.id}:${runToken}`;
      const parserState = createAgentStreamJsonParserState();
      let settled = false;

      const settle = (entry: DailyAgentResultEntry, options?: { stopProcess?: boolean }) => {
        if (settled) {
          return;
        }

        settled = true;

        if (options?.stopProcess !== false) {
          window.nexus.agentPrint.stop(paneId);
        }

        updateResponse(tone, entry);

        if (entry.status === 'success' && entry.content.trim()) {
          recordHomeDashboardActivity('prompts');
          recordHomeDashboardActivity('agentExecutions');
        }

        finishRun(tone);
      };

      const completeFromParser = (fallbackError?: string) => {
        feedAgentStreamJsonChunk(parserState, '');
        const content = resolveDailyAgentFinalResponse(parserState);

        if (content.trim()) {
          settle({ content, status: 'success' });
          return;
        }

        settle({
          content: '',
          status: 'error',
          errorMessage: fallbackError ?? 'Não foi possível gerar a resposta.',
        });
      };

      const unregister = registerAgentPrintPaneHandlers(paneId, {
        onData: (_incomingPaneId, data, incomingRunToken) => {
          if (settled || incomingRunToken !== runToken) {
            return;
          }

          const streamUpdate = feedAgentStreamJsonChunk(parserState, data);

          if (
            streamUpdate.shouldFinalize ||
            (parserState.shouldFinalize && hasMeaningfulStreamJsonTurnOutput(parserState))
          ) {
            completeFromParser();
          }
        },
        onDone: (_incomingPaneId, payload) => {
          if (settled || payload.runToken !== runToken) {
            return;
          }

          feedAgentStreamJsonChunk(parserState, '');
          const content = resolveDailyAgentFinalResponse(parserState);
          const hasError = payload.code !== 0 || Boolean(payload.error);

          if (content.trim()) {
            settle(
              {
                content,
                status: 'success',
              },
              { stopProcess: false },
            );
            return;
          }

          settle(
            {
              content: '',
              status: 'error',
              errorMessage:
                hasError
                  ? payload.error ?? 'Não foi possível gerar a resposta.'
                  : 'Não foi possível gerar a resposta.',
            },
            { stopProcess: false },
          );
        },
      });

      const timeoutId = window.setTimeout(() => {
        if (settled) {
          return;
        }

        completeFromParser('A geração demorou demais e foi interrompida.');
      }, DAILY_AGENT_TIMEOUT_MS);

      activeRunsRef.current.set(tone, { tone, paneId, unregister, runToken, timeoutId });

      try {
        await window.nexus.agentPrint.start({
          paneId,
          cwd: project.path,
          prompt,
          runToken,
        });
      } catch (error) {
        settle({
          content: '',
          status: 'error',
          errorMessage:
            error instanceof Error ? error.message : 'Não foi possível iniciar o agent.',
        });
      }
    },
    [finishRun, updateResponse],
  );

  useEffect(() => {
    return () => {
      stopActiveRuns();
    };
  }, [stopActiveRuns]);

  const generate = useCallback(
    async (options: DailyGenerationContext) => {
      if (!window.nexus?.agentPrint || runningProjectId) {
        return;
      }

      const projectMeta = buildDailyProjectMetaLabel({
        groups: options.groups,
        gitChanges: options.gitChanges,
        transcriptionCount: options.transcriptions.filter((item) =>
          isTranscriptionOnLocalDay(item.createdAt, options.targetDate),
        ).length,
      });
      const batchToken = crypto.randomUUID();

      lastContextRef.current = options;
      stopActiveRuns();
      pendingRunsRef.current = DAILY_RESPONSE_TONES.length;

      setRunningProjectId(options.project.id);
      setResultModal({
        project: options.project,
        projectMeta,
        responses: createLoadingResponses(),
      });

      await Promise.all(
        DAILY_RESPONSE_TONES.map((tone) =>
          startToneRun({
            ...options,
            tone,
            batchToken,
          }),
        ),
      );
    },
    [runningProjectId, startToneRun, stopActiveRuns],
  );

  const hasCachedResult = useCallback(
    (projectId: string) => cacheRef.current.has(projectId),
    [cachedProjectIds],
  );

  const viewCached = useCallback((projectId: string) => {
    const cached = cacheRef.current.get(projectId);

    if (!cached) {
      return;
    }

    lastContextRef.current = cached.context;
    setResultModal(cached.modal);
  }, []);

  const regenerate = useCallback(
    (targetDate: Date) => {
      if (runningProjectId || !resultModal) {
        return;
      }

      const cached = cacheRef.current.get(resultModal.project.id);
      const context = cached?.context ?? lastContextRef.current;

      if (!context || context.project.id !== resultModal.project.id) {
        return;
      }

      void generate({
        ...context,
        targetDate,
      });
    },
    [generate, resultModal, runningProjectId],
  );

  return {
    runningProjectId,
    resultModal,
    hasCachedResult,
    generate,
    viewCached,
    regenerate,
    closeModal,
  };
}

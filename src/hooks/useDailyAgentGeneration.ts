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
} from '@/utils/agentStreamJsonParser';
import { resolveDailyAgentFinalResponse } from '@/utils/dailyAgentResponse';
import { buildDailyProjectMetaLabel } from '@/utils/buildDailyProjectMetaLabel';
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

interface ActiveDailyRun {
  tone: DailyResponseTone;
  paneId: string;
  unregister: () => void;
  runToken: string;
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

  const stopActiveRuns = useCallback(() => {
    if (window.nexus?.agentPrint) {
      for (const activeRun of activeRunsRef.current.values()) {
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
      const activeRun = activeRunsRef.current.get(tone);

      if (activeRun) {
        activeRun.unregister();
        activeRunsRef.current.delete(tone);
      }

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
    [persistCurrentResult],
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
        targetDate,
        responseTone: tone,
      });
      const prompt = buildAgentSkillPrompt(skill.command, context);
      const runToken = `${batchToken}:${tone}`;
      const paneId = `daily:${project.id}:${runToken}`;
      const parserState = createAgentStreamJsonParserState();

      const unregister = registerAgentPrintPaneHandlers(paneId, {
        onData: (_incomingPaneId, data, incomingRunToken) => {
          if (incomingRunToken !== runToken) {
            return;
          }

          feedAgentStreamJsonChunk(parserState, data);
        },
        onDone: (_incomingPaneId, payload) => {
          if (payload.runToken !== runToken) {
            return;
          }

          feedAgentStreamJsonChunk(parserState, '');

          const content = resolveDailyAgentFinalResponse(parserState);
          const hasError = payload.code !== 0 || Boolean(payload.error);

          updateResponse(tone, {
            content,
            status: hasError ? 'error' : 'success',
            errorMessage:
              hasError && !content
                ? payload.error ?? 'Não foi possível gerar a resposta.'
                : undefined,
          });

          recordHomeDashboardActivity('prompts');
          recordHomeDashboardActivity('agentExecutions');
          finishRun(tone);
        },
      });

      activeRunsRef.current.set(tone, { tone, paneId, unregister, runToken });

      try {
        await window.nexus.agentPrint.start({
          paneId,
          cwd: project.path,
          prompt,
          runToken,
        });
      } catch (error) {
        updateResponse(tone, {
          content: '',
          status: 'error',
          errorMessage:
            error instanceof Error ? error.message : 'Não foi possível iniciar o agent.',
        });
        finishRun(tone);
      }
    },
    [finishRun, updateResponse],
  );

  const generate = useCallback(
    async (options: DailyGenerationContext) => {
      if (!window.nexus?.agentPrint || runningProjectId) {
        return;
      }

      const projectMeta = buildDailyProjectMetaLabel({
        groups: options.groups,
        gitChanges: options.gitChanges,
      });
      const batchToken = crypto.randomUUID();

      lastContextRef.current = options;
      activeRunsRef.current.clear();
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
    [runningProjectId, startToneRun],
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

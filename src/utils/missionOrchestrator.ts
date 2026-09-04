import { getBuiltinRoleById } from '@/constants/agentRoles';
import { getBuiltinTemplateById } from '@/constants/agentTemplates';
import { useMissionStore } from '@/stores/useMissionStore';
import { useProjectStore } from '@/stores/useProjectStore';
import type { AgentTurn } from '@/types';
import type { Mission, MissionAgentNode, MissionEdge } from '@/types/mission';
import { buildHandoffPayloadText } from '@/utils/buildHandoffPayload';
import { buildMissionAgentPrompt } from '@/utils/buildMissionAgentPrompt';
import {
  computeMissionProgress,
  isMissionAutomationNode,
  isMissionRootNode,
} from '@/utils/missionHelpers';
import { runMissionAutomationNode } from '@/utils/missionAutomationRunner';
import {
  collectMissionQaEvidences,
  isMissionQaNode,
} from '@/utils/missionQaEvidence';
import { publishMissionDiscovery } from '@/utils/missionContextActions';
import {
  getAgentPaneLiveTranscript,
  hasAgentPaneSubmit,
  runAgentPaneCommand,
  submitAgentPanePrompt,
} from '@/utils/agentPaneRegistry';
import { findPaneTab } from '@/utils/tabGroups';
import { resolveAgentLaunchCommand } from '@/utils/resolveAgentLaunchCommand';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';

const SCHEDULE_POLL_MS = 80;
const SCHEDULE_ATTEMPTS = 250;
const MODEL_COMMAND_DELAY_MS = 120;
const ACTIVATE_AGENT_DELAY_MS = 800;
const UNCAPTURED_RESPONSE_LABEL = 'Nenhuma resposta foi capturada. Tente enviar novamente.';

export function hasSuccessfulMissionAgentTurn(turn: AgentTurn): boolean {
  if (turn.running) {
    return false;
  }

  const hasResponse = turn.activities.some(
    (activity) =>
      activity.kind === 'response' &&
      activity.label.trim().length > 0 &&
      activity.label.trim() !== UNCAPTURED_RESPONSE_LABEL,
  );
  if (hasResponse) {
    return true;
  }

  if (
    turn.activities.some(
      (activity) =>
        activity.kind === 'file_edit' ||
        activity.kind === 'tool_run' ||
        activity.kind === 'task',
    )
  ) {
    return true;
  }

  const summary = turn.summary;
  if (!summary) {
    return false;
  }

  return (
    (summary.editedFileCount ?? 0) > 0 ||
    (summary.commandCount ?? 0) > 0 ||
    ((summary.exploredFileCount ?? 0) > 0 &&
      turn.activities.some((activity) => activity.kind === 'file_read'))
  );
}

export function isFailedMissionAgentTurn(turn: AgentTurn): boolean {
  if (turn.running || hasSuccessfulMissionAgentTurn(turn)) {
    return false;
  }

  const failedStatus = turn.activities.some(
    (activity) =>
      activity.kind === 'status' &&
      /não foi possível|não respondeu|tente novamente|envio cancelado|falhou|error/i.test(
        activity.label,
      ),
  );
  if (failedStatus) {
    return true;
  }

  return turn.activities.length === 0 && turn.summary === undefined;
}

export function isMissionTurnOwnedByNode(
  turn: AgentTurn,
  node: Pick<MissionAgentNode, 'startedAt'>,
): boolean {
  if (!node.startedAt) {
    return true;
  }

  const nodeStartedMs = Date.parse(node.startedAt);
  if (!Number.isFinite(nodeStartedMs)) {
    return true;
  }

  return turn.startedAt >= nodeStartedMs - 5_000;
}

export function resolveMissionAgentLatestTurn(
  paneId: string,
  storeTurns: AgentTurn[],
): AgentTurn | undefined {
  const liveTurns = getAgentPaneLiveTranscript(paneId)?.turns ?? [];
  const liveLatest = liveTurns[liveTurns.length - 1];
  const storeLatest = storeTurns[storeTurns.length - 1];

  if (liveLatest && !liveLatest.running) {
    return liveLatest;
  }

  if (storeLatest && !storeLatest.running) {
    return storeLatest;
  }

  return liveLatest ?? storeLatest;
}

export function resolveMissionAgentOwnedTurn(
  paneId: string,
  storeTurns: AgentTurn[],
  node: Pick<MissionAgentNode, 'startedAt'>,
): AgentTurn | undefined {
  const liveTurns = getAgentPaneLiveTranscript(paneId)?.turns ?? [];
  const candidates = [...liveTurns, ...storeTurns]
    .filter((turn, index, all) => all.findIndex((entry) => entry.id === turn.id) === index)
    .filter((turn) => isMissionTurnOwnedByNode(turn, node))
    .sort((left, right) => right.startedAt - left.startedAt);

  const finished = candidates.find((turn) => !turn.running);
  return finished ?? candidates[0];
}

function isAgentNodeBusy(node: MissionAgentNode): boolean {
  if (!node.paneId) {
    return false;
  }

  const live = getAgentPaneLiveTranscript(node.paneId);
  if (live?.turns.some((turn) => turn.running)) {
    return true;
  }

  const project = useProjectStore.getState().projects.find((entry) => entry.id === node.projectId);
  if (project) {
    const pane = findPaneTab(project.tabs, node.paneId);
    if (pane?.type === 'agent' && pane.turns.some((turn) => turn.running)) {
      return true;
    }
  }

  if (!hasAgentPaneSubmit(node.paneId)) {
    return false;
  }

  const session = useTerminalSessionStore.getState();
  return Boolean(
    session.awaitingResponseByPane[node.paneId] || session.agentPrintRunTokenByPane[node.paneId],
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForSubmit(paneId: string): Promise<boolean> {
  for (let attempt = 0; attempt < SCHEDULE_ATTEMPTS; attempt += 1) {
    if (hasAgentPaneSubmit(paneId)) {
      return true;
    }

    await delay(SCHEDULE_POLL_MS);
  }

  return false;
}

function incomingEdges(mission: Mission, nodeId: string): MissionEdge[] {
  return mission.edges.filter((edge) => edge.targetNodeId === nodeId);
}

function outgoingEdges(mission: Mission, nodeId: string): MissionEdge[] {
  return mission.edges.filter((edge) => edge.sourceNodeId === nodeId);
}

function getNode(mission: Mission, nodeId: string): MissionAgentNode | undefined {
  return mission.nodes.find((node) => node.id === nodeId);
}

function conditionMatches(edge: MissionEdge, node: MissionAgentNode): boolean {
  switch (edge.condition) {
    case 'always':
      return node.status === 'completed' || node.status === 'failed';
    case 'on_completion':
      return node.status === 'completed' || node.status === 'failed';
    case 'on_success':
      return node.status === 'completed';
    case 'on_failure':
      return node.status === 'failed';
    case 'after_approval':
      return node.status === 'completed';
    case 'custom':
      return node.status === 'completed';
    default:
      return false;
  }
}

function dependenciesSatisfied(mission: Mission, nodeId: string): boolean {
  const incoming = incomingEdges(mission, nodeId).filter(
    (edge) => edge.type !== 'parallel' && edge.type !== 'live',
  );

  if (incoming.length === 0) {
    return true;
  }

  return incoming.every((edge) => {
    const source = getNode(mission, edge.sourceNodeId);

    if (!source) {
      return false;
    }

    if (isMissionRootNode(source)) {
      return (
        mission.status === 'running' ||
        mission.status === 'paused' ||
        source.status === 'completed'
      );
    }

    if (edge.condition === 'after_approval') {
      return source.status === 'completed';
    }

    return conditionMatches(edge, source);
  });
}

function getLatestTurn(paneId: string | null, node?: MissionAgentNode): AgentTurn | null {
  if (paneId) {
    const live = getAgentPaneLiveTranscript(paneId)?.turns;
    const liveLatest = live?.[live.length - 1];
    if (liveLatest) {
      return liveLatest;
    }

    const projects = useProjectStore.getState().projects;
    for (const project of projects) {
      const pane = findPaneTab(project.tabs, paneId);
      if (pane?.type === 'agent') {
        return pane.turns[pane.turns.length - 1] ?? null;
      }
    }
  }

  const snapshot = node?.transcriptTurns;
  if (Array.isArray(snapshot) && snapshot.length > 0) {
    return snapshot[snapshot.length - 1] as AgentTurn;
  }

  return null;
}

function buildResultSummary(mission: Mission): Mission['result'] {
  const projectIds = [...new Set(mission.nodes.map((node) => node.projectId))];
  let editedFileCount = 0;
  let responseLead = '';

  for (const node of mission.nodes) {
    const turn = getLatestTurn(node.paneId, node);

    if (turn?.summary) {
      editedFileCount += turn.summary.editedFileCount;
      if (!responseLead && turn.summary.responseLead) {
        responseLead = turn.summary.responseLead;
      }
    }
  }

  return {
    editedFileCount,
    projectIds,
    alertCount: mission.inbox.filter((item) => !item.resolvedAt).length,
    decisionCount: 0,
    responseLead: responseLead || undefined,
  };
}

async function ensurePaneForNode(
  node: MissionAgentNode,
  addAgentTabForProject: (projectId: string, command: string) => Promise<string | null>,
): Promise<string | null> {
  const project = useProjectStore.getState().projects.find((entry) => entry.id === node.projectId);

  if (!project) {
    return null;
  }

  if (node.paneId) {
    const existing = findPaneTab(project.tabs, node.paneId);
    if (existing?.type === 'agent') {
      return node.paneId;
    }
  }

  const command = await resolveAgentLaunchCommand(project.path, node.aiProvider);
  return addAgentTabForProject(project.id, command);
}

export async function scheduleEligibleMissionNodes(input: {
  missionId: string;
  addAgentTabForProject: (projectId: string, command: string) => Promise<string | null>;
  syncAgentWorkingDirectory?: (paneId: string, workingDirectory: string) => Promise<void>;
  activateAgentNode?: (nodeId: string) => void | Promise<void>;
}): Promise<void> {
  const store = useMissionStore.getState();
  let mission = store.getMissionById(input.missionId);

  if (!mission || mission.status === 'paused' || mission.status === 'cancelled') {
    return;
  }

  const snapshot = mission;

  const eligibleAutomations = snapshot.nodes.filter(
    (node) =>
      isMissionAutomationNode(node) &&
      (node.status === 'pending' || node.status === 'waiting') &&
      !snapshot.inbox.some(
        (item) =>
          item.nodeId === node.id && !item.resolvedAt && item.kind === 'approval',
      ) &&
      dependenciesSatisfied(snapshot, node.id),
  );

  for (const node of eligibleAutomations) {
    const startedAt = new Date().toISOString();
    await store.upsertNode(snapshot.id, {
      ...node,
      status: 'running',
      progress: Math.max(node.progress, 5),
      attempt: node.attempt + 1,
      startedAt: node.startedAt ?? startedAt,
      lastError: undefined,
      currentStep: {
        id: crypto.randomUUID(),
        label: 'Executando automação',
        status: 'running',
        startedAt,
      },
    });

    if (snapshot.status === 'draft') {
      await store.updateMission(snapshot.id, {
        status: 'running',
        startedAt: snapshot.startedAt ?? startedAt,
      });
    }

    const result = await runMissionAutomationNode({
      missionId: snapshot.id,
      nodeId: node.id,
    });

    const latest = store.getMissionById(input.missionId);
    const current = latest?.nodes.find((entry) => entry.id === node.id) ?? node;

    if (result.waitingApproval) {
      await store.upsertNode(snapshot.id, {
        ...current,
        status: 'waiting',
        progress: Math.max(current.progress, 40),
        currentStep: {
          id: crypto.randomUUID(),
          label: 'Aguardando aprovação',
          status: 'running',
          startedAt,
        },
      });
      continue;
    }

    const completedAt = new Date().toISOString();
    await store.upsertNode(snapshot.id, {
      ...current,
      status: result.ok ? 'completed' : 'failed',
      progress: 100,
      completedAt,
      lastError: result.error,
      automation: current.automation
        ? {
            ...current.automation,
            output: result.output ?? current.automation.output,
          }
        : current.automation,
      currentStep: {
        id: crypto.randomUUID(),
        label: result.ok ? 'Automação concluída' : 'Automação falhou',
        status: result.ok ? 'completed' : 'failed',
        startedAt,
        completedAt,
      },
    });
  }

  if (eligibleAutomations.length > 0) {
    const refreshed = store.getMissionById(input.missionId);
    if (refreshed) {
      await store.updateMission(refreshed.id, {
        progress: computeMissionProgress(refreshed.nodes),
      });
    }
    await scheduleEligibleMissionNodes(input);
    return;
  }

  mission = store.getMissionById(input.missionId) ?? snapshot;
  const runningCount = mission.nodes.filter((node) => node.status === 'running').length;
  const slots = Math.max(0, mission.maxParallelAgents - runningCount);

  if (slots <= 0) {
    return;
  }

  const refreshedAgents = mission.nodes.filter(
    (node) =>
      (node.kind ?? 'agent') === 'agent' &&
      (node.status === 'pending' || node.status === 'waiting') &&
      dependenciesSatisfied(mission, node.id),
  );
  const toStart = refreshedAgents.slice(0, slots);

  if (toStart.length === 0) {
    const pendingWork = mission.nodes.some(
      (entry) =>
        !isMissionRootNode(entry) &&
        (entry.status === 'pending' ||
          entry.status === 'waiting' ||
          entry.status === 'running' ||
          entry.status === 'blocked'),
    );

    const hasRunnable = mission.nodes.some(
      (entry) =>
        !isMissionRootNode(entry) &&
        (entry.status === 'pending' || entry.status === 'waiting') &&
        dependenciesSatisfied(mission, entry.id),
    );
    const hasRunning = mission.nodes.some(
      (entry) => !isMissionRootNode(entry) && entry.status === 'running',
    );

    if (pendingWork && !hasRunnable && !hasRunning && mission.status === 'running') {
      const completedAt = new Date().toISOString();
      for (const entry of mission.nodes) {
        if (
          !isMissionRootNode(entry) &&
          (entry.status === 'pending' || entry.status === 'waiting' || entry.status === 'blocked')
        ) {
          await store.upsertNode(mission.id, {
            ...entry,
            status: 'failed',
            lastError: entry.lastError ?? 'Dependência anterior não concluída com sucesso.',
            completedAt,
          });
        }
      }
      await store.updateMission(mission.id, {
        status: 'failed',
        progress: 100,
        completedAt,
        result: buildResultSummary(store.getMissionById(mission.id) ?? mission),
      });
      return;
    }

    if (!pendingWork && mission.status === 'running') {
      const failed = mission.nodes.some(
        (entry) => !isMissionRootNode(entry) && entry.status === 'failed',
      );
      const completedAt = new Date().toISOString();
      await store.updateMission(mission.id, {
        status: failed ? 'failed' : 'completed',
        progress: 100,
        completedAt,
        result: buildResultSummary(mission),
      });
    } else {
      await store.updateMission(mission.id, {
        progress: computeMissionProgress(mission.nodes),
      });
    }
    return;
  }

  const roles = store.getRoles();
  const templates = store.getTemplates();

  for (const node of toStart) {
    const paneId = await ensurePaneForNode(node, input.addAgentTabForProject);

    if (!paneId) {
      await store.upsertNode(mission.id, {
        ...node,
        status: 'failed',
        lastError: 'Não foi possível criar o agent para este nó.',
      });
      continue;
    }

    if (node.worktreePath && input.syncAgentWorkingDirectory) {
      await input.syncAgentWorkingDirectory(paneId, node.worktreePath);
    }

    if (node.paneId !== paneId) {
      await store.upsertNode(mission.id, { ...node, paneId });
    }

    if (input.activateAgentNode) {
      await input.activateAgentNode(node.id);
      await delay(ACTIVATE_AGENT_DELAY_MS);
    }

    const handoffParts: string[] = [];

    for (const edge of incomingEdges(mission, node.id)) {
      const source = getNode(mission, edge.sourceNodeId);

      if (!source || !conditionMatches(edge, source)) {
        continue;
      }

      const template =
        templates.find((entry) => entry.id === source.agentTemplateId) ??
        getBuiltinTemplateById(source.agentTemplateId);
      const role =
        roles.find((entry) => entry.id === source.roleId) ?? getBuiltinRoleById(source.roleId);
      const sourceLabel = isMissionAutomationNode(source)
        ? (source.name ?? 'Nó')
        : `${template?.name ?? 'Agent'} (${role?.name ?? 'Papel'})`;
      const turn = getLatestTurn(source.paneId, source);
      const automationOutput = source.automation?.output
        ? `\nSaída do nó:\n${JSON.stringify(source.automation.output, null, 2)}`
        : '';
      const text = buildHandoffPayloadText({
        edge,
        sourceLabel,
        turn,
        discoveries: mission.discoveries
          .filter((discovery) => discovery.sourceNodeId === source.id)
          .map((discovery) => discovery.content),
      });

      if (text || automationOutput) {
        handoffParts.push(`${text || sourceLabel}${automationOutput}`);
      }
    }

    const prompt = buildMissionAgentPrompt({
      mission,
      node: { ...node, paneId, attempt: node.attempt + 1 },
      roles,
      templates,
      handoffText: handoffParts.join('\n\n---\n\n'),
    });

    const ready = await waitForSubmit(paneId);

    if (!ready) {
      await store.upsertNode(mission.id, {
        ...node,
        paneId,
        status: 'failed',
        lastError: 'Agent não ficou pronto a tempo.',
      });
      continue;
    }

    const model = node.model?.trim();

    if (model && model !== 'auto') {
      runAgentPaneCommand(paneId, `/model ${model}\n`);
      await delay(MODEL_COMMAND_DELAY_MS);
    }

    const startedAt = new Date().toISOString();
    await store.upsertNode(mission.id, {
      ...node,
      paneId,
      status: 'running',
      progress: Math.max(node.progress, 5),
      attempt: node.attempt + 1,
      startedAt,
      completedAt: undefined,
      lastError: undefined,
      injectedContext: handoffParts.join('\n\n---\n\n') || node.injectedContext,
      transcriptTurns: undefined,
      transcriptFollowUps: undefined,
      transcriptCapturedAt: undefined,
      currentStep: {
        id: crypto.randomUUID(),
        label: 'Executando objetivo',
        status: 'running',
        startedAt,
      },
      checklist:
        node.checklist.length > 0
          ? node.checklist
          : [
              {
                id: crypto.randomUUID(),
                label: 'Contexto recebido',
                status: 'completed',
                completedAt: startedAt,
              },
              {
                id: crypto.randomUUID(),
                label: 'Executando objetivo',
                status: 'running',
                startedAt,
              },
              {
                id: crypto.randomUUID(),
                label: 'Entregar resultados',
                status: 'pending',
              },
            ],
    });

    if (mission.status === 'draft') {
      await store.updateMission(mission.id, {
        status: 'running',
        startedAt: mission.startedAt ?? startedAt,
      });
    }

    const submitted = await submitAgentPanePrompt(paneId, prompt, {
      displayContent: node.objective,
      forceNewTurn: true,
    });

    if (!submitted) {
      const current =
        store.getMissionById(mission.id)?.nodes.find((entry) => entry.id === node.id) ?? node;
      await store.upsertNode(mission.id, {
        ...current,
        paneId,
        status: 'failed',
        progress: 0,
        startedAt,
        lastError: 'Não foi possível iniciar o agent neste nó.',
        currentStep: {
          id: crypto.randomUUID(),
          label: 'Falha ao iniciar',
          status: 'failed',
          startedAt,
          completedAt: new Date().toISOString(),
        },
      });
    }
  }
}

export async function handleMissionNodeTurnFinished(input: {
  missionId: string;
  nodeId: string;
  failed?: boolean;
  errorMessage?: string;
  addAgentTabForProject: (projectId: string, command: string) => Promise<string | null>;
  syncAgentWorkingDirectory?: (paneId: string, workingDirectory: string) => Promise<void>;
  activateAgentNode?: (nodeId: string) => void | Promise<void>;
}): Promise<void> {
  const store = useMissionStore.getState();
  let mission = store.getMissionById(input.missionId);

  if (!mission) {
    return;
  }

  const node = getNode(mission, input.nodeId);

  if (!node) {
    return;
  }

  if ((node.runUntil ?? 'turn_end') === 'session' && !input.failed) {
    const completedAt = new Date().toISOString();
    const project = useProjectStore
      .getState()
      .projects.find((entry) => entry.id === node.projectId);
    const pane = node.paneId && project ? findPaneTab(project.tabs, node.paneId) : null;
    const live = node.paneId ? getAgentPaneLiveTranscript(node.paneId) : null;
    const turns =
      live?.turns ??
      (pane?.type === 'agent' ? pane.turns : []) ??
      [];
    const followUps =
      live?.followUps ??
      (pane?.type === 'agent' ? pane.followUps : []) ??
      [];

    await store.upsertNode(mission.id, {
      ...node,
      status: 'running',
      progress: Math.max(node.progress, 40),
      lastError: undefined,
      ...(turns.length > 0
        ? {
            transcriptTurns: turns,
            transcriptFollowUps: followUps,
            transcriptCapturedAt: completedAt,
          }
        : {}),
      currentStep: {
        id: crypto.randomUUID(),
        label: 'Sessão ativa — aguardando próximo passo',
        status: 'running',
        startedAt: node.startedAt ?? completedAt,
      },
    });

    const { pushMissionCompanionEvent } = await import('@/utils/missionCompanion');
    pushMissionCompanionEvent({
      missionId: mission.id,
      nodeId: node.id,
      title: `${node.name?.trim() || 'Agent'} concluiu um turno`,
      summary: 'O agent continua em sessão ao vivo. Ele pode receber follow-ups e falar com peers.',
      nextStep: 'Use arestas Live ou o companion para o próximo passo.',
    });
    return;
  }

  const completedAt = new Date().toISOString();
  const nextStatus = input.failed ? 'failed' : 'completed';

  if (!input.failed && (mission.status === 'failed' || mission.status === 'paused')) {
    await store.updateMission(mission.id, {
      status: 'running',
      completedAt: undefined,
      result: undefined,
    });
    mission = store.getMissionById(input.missionId) ?? mission;
  }

  let nextEvidences = node.evidences;
  let transcriptTurns = node.transcriptTurns;
  let transcriptFollowUps = node.transcriptFollowUps;
  let transcriptCapturedAt = node.transcriptCapturedAt;

  if (!input.failed) {
    const project = useProjectStore
      .getState()
      .projects.find((entry) => entry.id === node.projectId);
    const pane = node.paneId && project ? findPaneTab(project.tabs, node.paneId) : null;
    const live = node.paneId ? getAgentPaneLiveTranscript(node.paneId) : null;
    const turns =
      live?.turns ??
      (pane?.type === 'agent' ? pane.turns : []) ??
      [];
    const followUps =
      live?.followUps ??
      (pane?.type === 'agent' ? pane.followUps : []) ??
      [];

    if (turns.length > 0) {
      transcriptTurns = turns;
      transcriptFollowUps = followUps;
      transcriptCapturedAt = completedAt;
    }

    if (isMissionQaNode(node)) {
      nextEvidences = collectMissionQaEvidences({
        mission,
        node: {
          ...node,
          transcriptTurns,
        },
        turns: turns as AgentTurn[],
        projectPath: node.worktreePath || project?.path || '',
      });
      const existingDiscoveryTexts = new Set(
        mission.discoveries
          .filter((discovery) => discovery.sourceNodeId === node.id)
          .map((discovery) => discovery.content.trim().toLowerCase()),
      );
      for (const evidence of nextEvidences) {
        if (evidence.kind !== 'text' || !evidence.content?.trim()) {
          continue;
        }
        const key = evidence.content.trim().toLowerCase();
        if (existingDiscoveryTexts.has(key)) {
          continue;
        }
        existingDiscoveryTexts.add(key);
        publishMissionDiscovery({
          missionId: mission.id,
          sourceNodeId: node.id,
          content: evidence.content.trim(),
        });
      }
    }
  }

  await store.upsertNode(mission.id, {
    ...node,
    status: nextStatus,
    progress: 100,
    completedAt,
    lastError: input.failed ? input.errorMessage : undefined,
    currentStep: node.currentStep
      ? {
          ...node.currentStep,
          status: input.failed ? 'failed' : 'completed',
          completedAt,
        }
      : undefined,
    checklist: node.checklist.map((step) =>
      step.status === 'running' || step.status === 'pending'
        ? {
            ...step,
            status: input.failed && step.status === 'running' ? 'failed' : 'completed',
            completedAt,
          }
        : step,
    ),
    ...(nextEvidences ? { evidences: nextEvidences } : {}),
    ...(transcriptTurns ? { transcriptTurns, transcriptFollowUps, transcriptCapturedAt } : {}),
  });

  const missionAfterUpdate = store.getMissionById(input.missionId);

  if (!missionAfterUpdate) {
    return;
  }

  if (!input.failed) {
    const { pushMissionCompanionEvent, buildCompanionNextStep } = await import(
      '@/utils/missionCompanion'
    );
    const template =
      store.getTemplates().find((entry) => entry.id === node.agentTemplateId) ??
      getBuiltinTemplateById(node.agentTemplateId);
    pushMissionCompanionEvent({
      missionId: missionAfterUpdate.id,
      nodeId: node.id,
      title: `${node.name?.trim() || template?.name || 'Agent'} concluiu`,
      summary: input.errorMessage || 'Turno finalizado com sucesso.',
      nextStep: buildCompanionNextStep(missionAfterUpdate.id, node.id),
    });
  }

  if (input.failed && node.attempt < node.maxAttempts) {
    await store.upsertNode(missionAfterUpdate.id, {
      ...node,
      status: 'pending',
      progress: 0,
      completedAt: undefined,
      lastError: input.errorMessage,
    });
    await scheduleEligibleMissionNodes(input);
    return;
  }

  const isValidationRole =
    node.roleId === 'role-validation' || node.roleId === 'role-qa' || node.roleId === 'role-review';

  if (input.failed && isValidationRole) {
    const sources = incomingEdges(missionAfterUpdate, node.id)
      .map((edge) => getNode(missionAfterUpdate, edge.sourceNodeId))
      .filter((entry): entry is MissionAgentNode => Boolean(entry));

    for (const source of sources) {
      if (source.iteration >= source.maxIterations) {
        continue;
      }

      await store.upsertNode(missionAfterUpdate.id, {
        ...source,
        status: 'pending',
        progress: 0,
        completedAt: undefined,
        iteration: source.iteration + 1,
        attempt: 0,
      });
    }

    await store.upsertNode(missionAfterUpdate.id, {
      ...node,
      status: 'waiting',
      progress: 0,
      completedAt: undefined,
      iteration: Math.min(node.iteration + 1, node.maxIterations),
      attempt: 0,
    });

    if (missionAfterUpdate.subagentPolicy === 'ask') {
      await store.upsertInboxItem(missionAfterUpdate.id, {
        id: crypto.randomUUID(),
        missionId: missionAfterUpdate.id,
        nodeId: node.id,
        kind: 'spawn_request',
        title: 'Criar sub-agent?',
        message: 'A validação falhou. Deseja criar um agent adicional para ajudar?',
        createdAt: completedAt,
        actions: [
          { id: 'approve', label: 'Criar' },
          { id: 'reject', label: 'Não' },
        ],
      });
    }

    await scheduleEligibleMissionNodes(input);
    return;
  }

  for (const edge of outgoingEdges(missionAfterUpdate, node.id)) {
    if (!conditionMatches(edge, { ...node, status: nextStatus })) {
      continue;
    }

    const target = getNode(missionAfterUpdate, edge.targetNodeId);

    if (!target) {
      continue;
    }

    if (edge.condition === 'after_approval') {
      await store.upsertNode(missionAfterUpdate.id, { ...target, status: 'blocked' });
      await store.upsertInboxItem(missionAfterUpdate.id, {
        id: crypto.randomUUID(),
        missionId: missionAfterUpdate.id,
        nodeId: target.id,
        kind: 'approval',
        title: 'Aprovação necessária',
        message: `O nó seguinte precisa de aprovação para continuar: ${target.objective}`,
        createdAt: completedAt,
        actions: [
          { id: 'approve', label: 'Aprovar' },
          { id: 'reject', label: 'Rejeitar' },
        ],
      });
      continue;
    }

    if (dependenciesSatisfied({ ...missionAfterUpdate, nodes: missionAfterUpdate.nodes.map((entry) =>
      entry.id === node.id ? { ...entry, status: nextStatus } : entry,
    ) }, target.id)) {
      if (target.status === 'pending' || target.status === 'waiting' || target.status === 'blocked') {
        await store.upsertNode(missionAfterUpdate.id, {
          ...target,
          status: 'waiting',
        });
      }
    }
  }

  const missionFinal = store.getMissionById(input.missionId);

  if (!missionFinal) {
    return;
  }

  const progress = computeMissionProgress(missionFinal.nodes);
  const pendingWork = missionFinal.nodes.some(
    (entry) =>
      !isMissionRootNode(entry) &&
      (entry.status === 'pending' ||
        entry.status === 'waiting' ||
        entry.status === 'running' ||
        entry.status === 'blocked'),
  );

  if (!pendingWork) {
    const failed = missionFinal.nodes.some(
      (entry) => !isMissionRootNode(entry) && entry.status === 'failed',
    );
    await store.updateMission(missionFinal.id, {
      status: failed ? 'failed' : 'completed',
      progress: 100,
      completedAt,
      result: buildResultSummary(missionFinal),
    });
    return;
  }

  await store.updateMission(missionFinal.id, { progress });
  await scheduleEligibleMissionNodes(input);
}

export async function startMission(input: {
  missionId: string;
  addAgentTabForProject: (projectId: string, command: string) => Promise<string | null>;
  syncAgentWorkingDirectory?: (paneId: string, workingDirectory: string) => Promise<void>;
  activateAgentNode?: (nodeId: string) => void | Promise<void>;
}): Promise<void> {
  const store = useMissionStore.getState();
  const mission = store.getMissionById(input.missionId);

  if (!mission) {
    return;
  }

  const startedAt = new Date().toISOString();
  const hasBusyAgent = mission.nodes.some(
    (node) => !isMissionRootNode(node) && node.status === 'running' && isAgentNodeBusy(node),
  );

  if (mission.status === 'paused' && hasBusyAgent) {
    await store.updateMission(mission.id, {
      status: 'running',
      completedAt: undefined,
      result: undefined,
      progress: computeMissionProgress(mission.nodes),
    });

    const runningNode = mission.nodes.find(
      (node) => !isMissionRootNode(node) && node.status === 'running' && isAgentNodeBusy(node),
    );
    if (runningNode && input.activateAgentNode) {
      await input.activateAgentNode(runningNode.id);
    }

    await scheduleEligibleMissionNodes(input);
    return;
  }

  const fullReset =
    mission.status === 'completed' ||
    mission.status === 'failed' ||
    mission.status === 'cancelled';

  await store.updateMission(mission.id, {
    status: 'running',
    startedAt: fullReset || !mission.startedAt ? startedAt : mission.startedAt,
    completedAt: undefined,
    result: undefined,
    progress: fullReset ? 0 : computeMissionProgress(mission.nodes),
  });

  for (const node of mission.nodes) {
    if (isMissionRootNode(node)) {
      await store.upsertNode(mission.id, {
        ...node,
        status: 'completed',
        progress: 100,
        startedAt: node.startedAt ?? startedAt,
        completedAt: startedAt,
        lastError: undefined,
      });
      continue;
    }

    const zombieRunning = node.status === 'running' && !isAgentNodeBusy(node);
    const shouldReset =
      fullReset ||
      node.status === 'failed' ||
      node.status === 'cancelled' ||
      node.status === 'blocked' ||
      node.status === 'paused' ||
      zombieRunning;

    let next = node;
    if (shouldReset) {
      next = {
        ...node,
        status: 'pending',
        progress: 0,
        lastError: undefined,
        completedAt: undefined,
        currentStep: undefined,
      };
    }

    if (next.status === 'pending' && incomingEdges(mission, node.id).length > 0) {
      next = { ...next, status: 'waiting' };
    }

    if (
      next.status !== node.status ||
      next.progress !== node.progress ||
      next.lastError !== node.lastError ||
      next.completedAt !== node.completedAt ||
      next.currentStep !== node.currentStep
    ) {
      await store.upsertNode(mission.id, next);
    }
  }

  await scheduleEligibleMissionNodes(input);
}

export async function pauseMission(missionId: string): Promise<void> {
  await useMissionStore.getState().updateMission(missionId, { status: 'paused' });
}

export async function cancelMission(missionId: string): Promise<void> {
  const store = useMissionStore.getState();
  const mission = store.getMissionById(missionId);

  if (!mission) {
    return;
  }

  for (const node of mission.nodes) {
    if (node.status === 'running' || node.status === 'waiting' || node.status === 'pending') {
      await store.upsertNode(missionId, {
        ...node,
        status: 'cancelled',
        progress: node.status === 'running' ? node.progress : 0,
      });
    }
  }

  await store.updateMission(missionId, {
    status: 'cancelled',
    completedAt: new Date().toISOString(),
  });
}

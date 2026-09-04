import { useMissionStore } from '@/stores/useMissionStore';
import { submitAgentPanePrompt } from '@/utils/agentPaneRegistry';
import {
  getMissionNodeDisplayName,
  getMissionNodeKind,
  isMissionAgentNode,
  isMissionNoteNode,
} from '@/utils/missionHelpers';
import { getBuiltinTemplateById } from '@/constants/agentTemplates';
import type { Mission, MissionAgentNode, MissionEdge } from '@/types/mission';

export interface MissionLivePeer {
  nodeId: string;
  name: string;
  kind: NonNullable<MissionAgentNode['kind']>;
  paneId: string | null;
  status: MissionAgentNode['status'];
  roleId: string;
}

export interface MissionLiveAskResult {
  ok: boolean;
  error?: string;
  targetNodeId?: string;
  targetName?: string;
}

export interface MissionLiveMessageLog {
  id: string;
  missionId: string;
  fromNodeId: string;
  toNodeId: string;
  message: string;
  createdAt: string;
}

const messageLogs: MissionLiveMessageLog[] = [];
const MAX_LOGS = 200;

function getMission(missionId: string): Mission | undefined {
  return useMissionStore.getState().getMissionById(missionId);
}

function resolveNodeName(node: MissionAgentNode): string {
  const template = getBuiltinTemplateById(node.agentTemplateId);
  return getMissionNodeDisplayName(node, template?.name ?? 'Agent');
}

function liveEdges(mission: Mission, nodeId: string): MissionEdge[] {
  return mission.edges.filter(
    (edge) =>
      edge.type === 'live' &&
      (edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId),
  );
}

export function listLivePeers(missionId: string, nodeId: string): MissionLivePeer[] {
  const mission = getMission(missionId);
  if (!mission) {
    return [];
  }

  const peers = new Map<string, MissionLivePeer>();

  for (const edge of liveEdges(mission, nodeId)) {
    const otherId =
      edge.sourceNodeId === nodeId ? edge.targetNodeId : edge.sourceNodeId;
    const other = mission.nodes.find((node) => node.id === otherId);
    if (!other) {
      continue;
    }

    peers.set(other.id, {
      nodeId: other.id,
      name: resolveNodeName(other),
      kind: getMissionNodeKind(other),
      paneId: other.paneId,
      status: other.status,
      roleId: other.roleId,
    });
  }

  return [...peers.values()];
}

export function listMissionLiveAgents(missionId: string): MissionLivePeer[] {
  const mission = getMission(missionId);
  if (!mission) {
    return [];
  }

  return mission.nodes
    .filter((node) => isMissionAgentNode(node))
    .map((node) => ({
      nodeId: node.id,
      name: resolveNodeName(node),
      kind: getMissionNodeKind(node),
      paneId: node.paneId,
      status: node.status,
      roleId: node.roleId,
    }));
}

function findPeerByName(
  mission: Mission,
  fromNodeId: string,
  targetName: string,
): MissionAgentNode | null {
  const needle = targetName.trim().toLowerCase();
  if (!needle) {
    return null;
  }

  const peers = listLivePeers(mission.id, fromNodeId);
  const match = peers.find((peer) => peer.name.toLowerCase() === needle);
  if (!match) {
    return null;
  }

  return mission.nodes.find((node) => node.id === match.nodeId) ?? null;
}

export function getLiveMessageLogs(missionId: string): MissionLiveMessageLog[] {
  return messageLogs.filter((entry) => entry.missionId === missionId);
}

export async function askLiveAgent(input: {
  missionId: string;
  fromNodeId: string;
  toNameOrId: string;
  message: string;
}): Promise<MissionLiveAskResult> {
  const mission = getMission(input.missionId);
  if (!mission) {
    return { ok: false, error: 'Missão não encontrada.' };
  }

  if (mission.status !== 'running' && mission.status !== 'paused') {
    return { ok: false, error: 'A missão precisa estar em execução.' };
  }

  const message = input.message.trim();
  if (!message) {
    return { ok: false, error: 'Mensagem vazia.' };
  }

  const from = mission.nodes.find((node) => node.id === input.fromNodeId);
  if (!from) {
    return { ok: false, error: 'Nó de origem não encontrado.' };
  }

  const byId = mission.nodes.find((node) => node.id === input.toNameOrId);
  const target =
    byId &&
    liveEdges(mission, input.fromNodeId).some(
      (edge) =>
        edge.sourceNodeId === byId.id || edge.targetNodeId === byId.id,
    )
      ? byId
      : findPeerByName(mission, input.fromNodeId, input.toNameOrId);

  if (!target) {
    return {
      ok: false,
      error: `Peer "${input.toNameOrId}" não está conectado por aresta Live.`,
    };
  }

  if (!isMissionAgentNode(target) || !target.paneId) {
    return { ok: false, error: 'O destino não é um agent ativo.' };
  }

  const fromName = resolveNodeName(from);
  const prompt = `[Live de ${fromName}]\n${message}`;
  const submitted = await submitAgentPanePrompt(target.paneId, prompt, {
    displayContent: prompt,
    forceNewTurn: false,
  });

  if (!submitted) {
    return { ok: false, error: 'Não foi possível entregar o follow-up ao agent.' };
  }

  messageLogs.unshift({
    id: crypto.randomUUID(),
    missionId: mission.id,
    fromNodeId: from.id,
    toNodeId: target.id,
    message,
    createdAt: new Date().toISOString(),
  });
  if (messageLogs.length > MAX_LOGS) {
    messageLogs.length = MAX_LOGS;
  }

  return {
    ok: true,
    targetNodeId: target.id,
    targetName: resolveNodeName(target),
  };
}

export async function askLiveAgentAsHuman(input: {
  missionId: string;
  targetNodeIds: string[];
  message: string;
}): Promise<Array<{ nodeId: string; ok: boolean; error?: string }>> {
  const mission = getMission(input.missionId);
  if (!mission) {
    return [];
  }

  const message = input.message.trim();
  if (!message) {
    return [];
  }

  const results: Array<{ nodeId: string; ok: boolean; error?: string }> = [];

  for (const nodeId of input.targetNodeIds) {
    const node = mission.nodes.find((entry) => entry.id === nodeId);
    if (!node?.paneId || !isMissionAgentNode(node)) {
      results.push({ nodeId, ok: false, error: 'Agent inválido.' });
      continue;
    }

    const hasLive = mission.edges.some(
      (edge) =>
        edge.type === 'live' &&
        (edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId),
    );
    const forceNewTurn = !hasLive && (node.runUntil ?? 'turn_end') === 'turn_end';
    const prompt = hasLive ? `[Ask humano]\n${message}` : message;
    const submitted = await submitAgentPanePrompt(node.paneId, prompt, {
      displayContent: message,
      forceNewTurn,
    });
    results.push({
      nodeId,
      ok: submitted,
      error: submitted ? undefined : 'Falha ao enviar.',
    });
  }

  return results;
}

export function readConnectedNote(input: {
  missionId: string;
  fromNodeId: string;
  noteNameOrId: string;
}): { ok: boolean; content?: string; error?: string; noteId?: string } {
  const mission = getMission(input.missionId);
  if (!mission) {
    return { ok: false, error: 'Missão não encontrada.' };
  }

  const peers = listLivePeers(mission.id, input.fromNodeId);
  const needle = input.noteNameOrId.trim().toLowerCase();
  const peer =
    peers.find((entry) => entry.nodeId === input.noteNameOrId) ??
    peers.find((entry) => entry.name.toLowerCase() === needle);

  if (!peer) {
    return { ok: false, error: 'Nota não conectada por aresta Live.' };
  }

  const note = mission.nodes.find((node) => node.id === peer.nodeId);
  if (!note || !isMissionNoteNode(note)) {
    return { ok: false, error: 'O peer não é uma nota.' };
  }

  return {
    ok: true,
    noteId: note.id,
    content: note.noteContent ?? '',
  };
}

export async function writeConnectedNote(input: {
  missionId: string;
  fromNodeId: string;
  noteNameOrId: string;
  content: string;
  append?: boolean;
}): Promise<{ ok: boolean; error?: string; noteId?: string }> {
  const mission = getMission(input.missionId);
  if (!mission) {
    return { ok: false, error: 'Missão não encontrada.' };
  }

  const peers = listLivePeers(mission.id, input.fromNodeId);
  const needle = input.noteNameOrId.trim().toLowerCase();
  const peer =
    peers.find((entry) => entry.nodeId === input.noteNameOrId) ??
    peers.find((entry) => entry.name.toLowerCase() === needle);

  if (!peer) {
    return { ok: false, error: 'Nota não conectada por aresta Live.' };
  }

  const note = mission.nodes.find((node) => node.id === peer.nodeId);
  if (!note || !isMissionNoteNode(note)) {
    return { ok: false, error: 'O peer não é uma nota.' };
  }

  const nextContent = input.append
    ? `${note.noteContent ?? ''}${note.noteContent ? '\n' : ''}${input.content}`
    : input.content;

  await useMissionStore.getState().upsertNode(mission.id, {
    ...note,
    noteContent: nextContent,
  });

  if (window.nexus?.missions?.writeNoteFile) {
    await window.nexus.missions.writeNoteFile(mission.id, note.id, nextContent);
  }

  return { ok: true, noteId: note.id };
}

export function buildLivePeersPromptSection(
  mission: Mission,
  node: MissionAgentNode,
): string | null {
  const peers = listLivePeers(mission.id, node.id);
  if (peers.length === 0) {
    return null;
  }

  const lines = peers.map((peer) => {
    const kindLabel =
      peer.kind === 'note'
        ? 'nota'
        : peer.kind === 'browser' ||
            peer.kind === 'emulator' ||
            peer.kind === 'terminal' ||
            peer.kind === 'api'
          ? 'portal'
          : 'agent';
    return `- ${peer.name} (${kindLabel}, status: ${peer.status})`;
  });

  return `# Canal Live (Maestri)
Você tem peers conectados por aresta Live. Use a skill nexus-live:
- \`nexus list\` — lista peers
- \`nexus ask "Nome" "mensagem"\` — envia follow-up ao agent (não mata o turno dele)
- \`nexus note read "Nome"\` / \`nexus note write "Nome" "texto"\` — lê/escreve notas conectadas

Peers:
${lines.join('\n')}`;
}

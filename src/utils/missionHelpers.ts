import { getBuiltinTemplateById, resolveAgentTemplateObjective } from '@/constants/agentTemplates';
import { DEFAULT_AI_PROVIDER, type AiProviderId } from '@/constants/aiProviders';
import { useAppSettingsStore } from '@/stores/useAppSettingsStore';
import { DEFAULT_HANDOFF_PAYLOAD } from '@/types/mission';
import type {
  Mission,
  MissionAgentNode,
  MissionEdge,
  MissionHandoffPayload,
  MissionNodeKind,
} from '@/types/mission';

export const MISSION_TOOL_NODE_DEFAULT_WIDTH = 1680;
export const MISSION_TOOL_NODE_DEFAULT_HEIGHT = 1020;
export const MISSION_TOOL_NODE_MIN_WIDTH = 420;
export const MISSION_TOOL_NODE_MIN_HEIGHT = 280;

export function getMissionToolNodeSize(node?: Pick<MissionAgentNode, 'size'> | null): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(
      MISSION_TOOL_NODE_MIN_WIDTH,
      Math.round(node?.size?.width ?? MISSION_TOOL_NODE_DEFAULT_WIDTH),
    ),
    height: Math.max(
      MISSION_TOOL_NODE_MIN_HEIGHT,
      Math.round(node?.size?.height ?? MISSION_TOOL_NODE_DEFAULT_HEIGHT),
    ),
  };
}

export function formatMissionNodeObjectivePreview(
  objective: string,
  agentName: string,
): string {
  const text = objective.trim();
  const name = agentName.trim();
  if (!text || !name) {
    return objective;
  }

  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stripped = text
    .replace(new RegExp(`^Como\\s+${escapedName}\\s*[,:;\\-–—]?\\s*`, 'i'), '')
    .trim();

  if (!stripped) {
    return objective;
  }

  return stripped.charAt(0).toLocaleUpperCase('pt-BR') + stripped.slice(1);
}

export function createMissionNode(input: {
  agentTemplateId: string;
  projectId: string;
  roleId: string;
  objective: string;
  name?: string;
  kind?: MissionAgentNode['kind'];
  position?: { x: number; y: number };
  paneId?: string | null;
  aiProvider?: Exclude<AiProviderId, 'nexus'>;
  model?: string;
}): MissionAgentNode {
  const name = input.name?.trim();
  const kind = input.kind ?? 'agent';
  const aiProvider =
    kind === 'agent'
      ? (input.aiProvider ??
        useAppSettingsStore.getState().preferredAiProvider ??
        DEFAULT_AI_PROVIDER)
      : undefined;
  return {
    id: crypto.randomUUID(),
    kind,
    agentTemplateId: input.agentTemplateId,
    projectId: input.projectId,
    paneId: input.paneId ?? null,
    roleId: input.roleId,
    name: name || undefined,
    objective: input.objective.trim(),
    status: 'pending',
    progress: 0,
    aiProvider,
    model: input.model,
    iteration: 1,
    maxIterations: 3,
    attempt: 0,
    maxAttempts: 3,
    position: input.position ?? { x: 80, y: 80 },
    checklist: [],
    contextRefs: [],
  };
}

export function getMissionNodeKind(
  node: Pick<MissionAgentNode, 'kind'>,
): NonNullable<MissionAgentNode['kind']> {
  return node.kind ?? 'agent';
}

export function isMissionToolNode(node: Pick<MissionAgentNode, 'kind'>): boolean {
  const kind = getMissionNodeKind(node);
  return kind === 'browser' || kind === 'emulator' || kind === 'terminal' || kind === 'api';
}

export function isMissionAutomationNode(node: Pick<MissionAgentNode, 'kind'>): boolean {
  return getMissionNodeKind(node) === 'automation';
}

export function isMissionDisplayNode(node: Pick<MissionAgentNode, 'kind'>): boolean {
  return isMissionToolNode(node);
}

export function getMissionToolNodeLabel(
  kind: Exclude<MissionNodeKind, 'agent' | 'mission'>,
): string {
  switch (kind) {
    case 'browser':
      return 'Navegador';
    case 'emulator':
      return 'Emulador';
    case 'terminal':
      return 'Terminal';
    case 'api':
      return 'API Client';
    case 'automation':
      return 'Nó';
    default:
      return 'Display Node';
  }
}

export function isMissionRootNode(node: Pick<MissionAgentNode, 'kind'>): boolean {
  return getMissionNodeKind(node) === 'mission';
}

export function isMissionAgentNode(node: Pick<MissionAgentNode, 'kind'>): boolean {
  return getMissionNodeKind(node) === 'agent';
}

export function countMissionAgentNodes(
  nodes: Array<Pick<MissionAgentNode, 'kind'>>,
): number {
  return nodes.filter((node) => isMissionAgentNode(node)).length;
}

export const MISSION_ROOT_NODE_SIZE = Math.round(248 * 1.5);
export const MISSION_ROOT_NODE_WIDTH = MISSION_ROOT_NODE_SIZE;
export const MISSION_ROOT_TEMPLATE_ID = 'tpl-mission-root';
export const MISSION_ROOT_ROLE_ID = 'role-mission';

export function createMissionRootNode(input: {
  title: string;
  objective?: string;
  projectId?: string;
  position?: { x: number; y: number };
}): MissionAgentNode {
  const title = input.title.trim() || 'Nova missão';
  const objective = input.objective?.trim() || title;

  return createMissionNode({
    kind: 'mission',
    agentTemplateId: MISSION_ROOT_TEMPLATE_ID,
    roleId: MISSION_ROOT_ROLE_ID,
    projectId: input.projectId ?? '',
    name: title,
    objective,
    position: input.position ?? { x: 40, y: 160 },
  });
}

export function findMissionRootNode(
  nodes: MissionAgentNode[],
): MissionAgentNode | undefined {
  return nodes.find((node) => isMissionRootNode(node));
}

export function resolveMissionRootPosition(nodes: MissionAgentNode[]): { x: number; y: number } {
  const others = nodes.filter((node) => !isMissionRootNode(node));

  if (others.length === 0) {
    return { x: 40, y: 160 };
  }

  const minX = Math.min(...others.map((node) => node.position.x));
  const avgY =
    others.reduce((sum, node) => sum + node.position.y, 0) / Math.max(1, others.length);

  return {
    x: Math.min(40, minX - (MISSION_ROOT_NODE_SIZE + 48)),
    y: Math.round(avgY),
  };
}

export function createMissionToolNode(input: {
  kind: Exclude<MissionNodeKind, 'agent' | 'automation' | 'mission'>;
  projectId: string;
  paneId?: string | null;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
}): MissionAgentNode {
  const label = getMissionToolNodeLabel(input.kind);
  return {
    ...createMissionNode({
      kind: input.kind,
      agentTemplateId: `tpl-tool-${input.kind}`,
      projectId: input.projectId,
      roleId: 'role-custom',
      name: label,
      objective: `Visualizar ${label.toLowerCase()} em tempo real nesta missão.`,
      paneId: input.paneId ?? null,
      position: input.position,
    }),
    size: input.size ?? {
      width: MISSION_TOOL_NODE_DEFAULT_WIDTH,
      height: MISSION_TOOL_NODE_DEFAULT_HEIGHT,
    },
  };
}

export function createMissionAutomationNode(input: {
  projectId: string;
  catalogId: string;
  label: string;
  category: string;
  nodeType: string;
  provider?: string;
  action?: string;
  defaultConfig: Record<string, string | number | boolean | null>;
  position?: { x: number; y: number };
}): MissionAgentNode {
  return {
    ...createMissionNode({
      kind: 'automation',
      agentTemplateId: 'tpl-automation',
      projectId: input.projectId,
      roleId: 'role-custom',
      name: input.label,
      objective: `Executar nó de automação: ${input.label}`,
      position: input.position,
    }),
    automation: {
      category: input.category,
      nodeType: input.nodeType,
      provider: input.provider,
      action: input.action,
      config: { ...input.defaultConfig, catalogId: input.catalogId },
    },
  };
}

export function getMissionNodeDisplayName(
  node: Pick<MissionAgentNode, 'name'>,
  fallback = 'Agent',
): string {
  const custom = node.name?.trim();
  return custom || fallback;
}

export function resolveMissionDeleteNodeTarget(
  node: Pick<MissionAgentNode, 'name' | 'kind'>,
  agentFallback: string,
): { kind: 'agent' | 'node'; name: string } {
  const nodeKind = getMissionNodeKind(node);

  if (nodeKind === 'agent') {
    return {
      kind: 'agent',
      name: getMissionNodeDisplayName(node, agentFallback),
    };
  }

  if (nodeKind === 'mission') {
    return {
      kind: 'node',
      name: getMissionNodeDisplayName(node, 'Missão'),
    };
  }

  if (nodeKind === 'automation') {
    return {
      kind: 'node',
      name: getMissionNodeDisplayName(node, 'Nó'),
    };
  }

  return {
    kind: 'node',
    name: getMissionNodeDisplayName(node, getMissionToolNodeLabel(nodeKind)),
  };
}

export function duplicateMissionNode(node: MissionAgentNode): MissionAgentNode {
  return {
    ...node,
    id: crypto.randomUUID(),
    paneId: null,
    worktreePath: null,
    worktreeBranch: null,
    status: 'pending',
    progress: 0,
    iteration: 1,
    attempt: 0,
    startedAt: undefined,
    completedAt: undefined,
    currentStep: undefined,
    checklist: [],
    contextRefs: [],
    injectedContext: undefined,
    lastError: undefined,
    flowInstanceId: undefined,
    position: {
      x: node.position.x + 56,
      y: node.position.y + 40,
    },
  };
}

export function createMissionEdge(input: {
  sourceNodeId: string;
  targetNodeId: string;
  type?: MissionEdge['type'];
  condition?: MissionEdge['condition'];
  payload?: MissionHandoffPayload;
  label?: string;
}): MissionEdge {
  return {
    id: crypto.randomUUID(),
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    type: input.type ?? 'handoff',
    condition: input.condition ?? 'on_success',
    payload: {
      ...DEFAULT_HANDOFF_PAYLOAD,
      ...input.payload,
    },
    label: input.label,
  };
}

export function createSequentialMissionNodes(input: {
  projectId: string;
  title: string;
  prompt: string;
  origin?: { x: number; y: number };
}): { nodes: MissionAgentNode[]; edges: MissionEdge[] } {
  const originX = input.origin?.x ?? 80;
  const originY = input.origin?.y ?? 160;
  const flowInstanceId = crypto.randomUUID();
  const investigatorTemplate = getBuiltinTemplateById('tpl-investigator');
  const backend = getBuiltinTemplateById('tpl-backend');
  const qaTemplate = getBuiltinTemplateById('tpl-qa');

  const investigator = {
    ...createMissionNode({
      agentTemplateId: 'tpl-investigator',
      projectId: input.projectId,
      roleId: 'role-investigation',
      name: investigatorTemplate?.name,
      objective: resolveAgentTemplateObjective(investigatorTemplate, input.prompt),
      position: { x: originX, y: originY },
    }),
    flowInstanceId,
  };
  const engineer = {
    ...createMissionNode({
      agentTemplateId: 'tpl-backend',
      projectId: input.projectId,
      roleId: 'role-execution',
      name: backend?.name,
      objective: resolveAgentTemplateObjective(backend, input.prompt),
      position: { x: originX + 320, y: originY },
    }),
    flowInstanceId,
  };
  const qa = {
    ...createMissionNode({
      agentTemplateId: 'tpl-qa',
      projectId: input.projectId,
      roleId: 'role-qa',
      name: qaTemplate?.name,
      objective: resolveAgentTemplateObjective(qaTemplate, input.prompt),
      position: { x: originX + 640, y: originY },
    }),
    flowInstanceId,
  };

  return {
    nodes: [investigator, engineer, qa],
    edges: [
      createMissionEdge({
        sourceNodeId: investigator.id,
        targetNodeId: engineer.id,
        type: 'handoff',
        condition: 'on_success',
      }),
      createMissionEdge({
        sourceNodeId: engineer.id,
        targetNodeId: qa.id,
        type: 'validation',
        condition: 'on_success',
      }),
    ],
  };
}

export function missionNodesToFlowTemplateNodes(
  nodes: MissionAgentNode[],
): import('@/types/mission').MissionFlowTemplateNode[] {
  return nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    agentTemplateId: node.agentTemplateId,
    roleId: node.roleId,
    name: node.name,
    objective: node.objective,
    identity: node.identity,
    position: { ...node.position },
    size: node.size ? { ...node.size } : undefined,
    automation: node.automation
      ? {
          ...node.automation,
          config: { ...node.automation.config },
          output: node.automation.output ? { ...node.automation.output } : undefined,
        }
      : undefined,
  }));
}

export function missionEdgesToFlowTemplateEdges(
  edges: MissionEdge[],
): import('@/types/mission').MissionFlowTemplateEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    type: edge.type,
    condition: edge.condition,
    payload: { ...edge.payload },
    label: edge.label,
  }));
}

export function instantiateFlowTemplate(input: {
  template: import('@/types/mission').MissionFlowTemplate;
  projectId: string;
  missionPrompt: string;
  origin?: { x: number; y: number };
}): { nodes: MissionAgentNode[]; edges: MissionEdge[]; idMap: Map<string, string> } {
  const nodes = input.template.nodes;
  const minX = nodes.reduce(
    (min, node) => Math.min(min, node.position.x),
    Number.POSITIVE_INFINITY,
  );
  const minY = nodes.reduce(
    (min, node) => Math.min(min, node.position.y),
    Number.POSITIVE_INFINITY,
  );
  const originX = input.origin?.x ?? 80;
  const originY = input.origin?.y ?? 80;
  const offsetX = Number.isFinite(minX) ? originX - minX : originX;
  const offsetY = Number.isFinite(minY) ? originY - minY : originY;
  const idMap = new Map<string, string>();
  const flowInstanceId = crypto.randomUUID();

  const nextNodes: MissionAgentNode[] = nodes.map((node) => {
    const nextId = crypto.randomUUID();
    idMap.set(node.id, nextId);
    const objective = node.objective.includes('{{mission}}')
      ? resolveAgentTemplateObjective(
          {
            name: node.name ?? 'Agent',
            description: '',
            defaultObjective: node.objective,
          },
          input.missionPrompt,
        )
      : node.objective;

    return {
      ...createMissionNode({
        agentTemplateId: node.agentTemplateId,
        projectId: input.projectId,
        roleId: node.roleId,
        name: node.name,
        objective,
        kind: node.kind,
        position: {
          x: node.position.x + offsetX,
          y: node.position.y + offsetY,
        },
        paneId: null,
      }),
      id: nextId,
      identity: node.identity,
      flowInstanceId,
      automation: node.automation
        ? {
            ...node.automation,
            config: { ...node.automation.config },
            output: undefined,
          }
        : undefined,
      size:
        node.kind && node.kind !== 'agent' && node.kind !== 'automation'
          ? getMissionToolNodeSize(node)
          : node.size,
    };
  });

  const nextEdges: MissionEdge[] = input.template.edges
    .map((edge) => {
      const sourceNodeId = idMap.get(edge.sourceNodeId);
      const targetNodeId = idMap.get(edge.targetNodeId);
      if (!sourceNodeId || !targetNodeId) {
        return null;
      }

      return {
        ...createMissionEdge({
          sourceNodeId,
          targetNodeId,
          type: edge.type,
          condition: edge.condition,
          payload: edge.payload,
          label: edge.label,
        }),
      };
    })
    .filter((edge): edge is MissionEdge => Boolean(edge));

  return { nodes: nextNodes, edges: nextEdges, idMap };
}

export function getMissionEdgeTypeLabel(type: MissionEdge['type']): string {
  switch (type) {
    case 'handoff':
      return 'Handoff';
    case 'dependency':
      return 'Dependência';
    case 'parallel':
      return 'Paralelo';
    case 'validation':
      return 'Validação';
    case 'trigger':
      return 'Trigger';
    case 'shared_discovery':
      return 'Descoberta compartilhada';
    default:
      return type;
  }
}

export function getMissionEdgeTypeDescription(type: MissionEdge['type']): string {
  switch (type) {
    case 'handoff':
      return 'Passa o resultado do agent de origem para o destino continuar o trabalho.';
    case 'dependency':
      return 'O destino só começa depois que a origem terminar (sem transferir contexto automaticamente).';
    case 'parallel':
      return 'Os agents podem rodar em paralelo; a ligação só marca relação entre eles.';
    case 'validation':
      return 'O destino valida o trabalho da origem (aprovação/reprovação com evidências).';
    case 'trigger':
      return 'A origem dispara o destino como evento, sem necessariamente esperar sucesso.';
    case 'shared_discovery':
      return 'Compartilha descobertas/contexto encontrado pela origem com o destino.';
    default:
      return 'Define como os agents se relacionam nesta ligação.';
  }
}

export function getMissionEdgeConditionDescription(condition: MissionEdge['condition']): string {
  switch (condition) {
    case 'on_success':
      return 'Só segue se a origem concluir com sucesso.';
    case 'on_completion':
      return 'Segue quando a origem terminar, independente do resultado.';
    case 'on_failure':
      return 'Só segue se a origem falhar.';
    case 'always':
      return 'A ligação permanece ativa sem depender do status da origem.';
    case 'after_approval':
      return 'Só segue depois de aprovação manual na Inbox.';
    default:
      return 'Define quando esta ligação libera o próximo agent.';
  }
}

export function getMissionStatusLabel(status: Mission['status']): string {
  switch (status) {
    case 'draft':
      return 'Rascunho';
    case 'running':
      return 'Em execução';
    case 'paused':
      return 'Pausada';
    case 'completed':
      return 'Concluída';
    case 'failed':
      return 'Falhou';
    case 'cancelled':
      return 'Cancelada';
    default:
      return status;
  }
}

export function getMissionNodeStatusLabel(status: MissionAgentNode['status']): string {
  switch (status) {
    case 'pending':
      return 'Pendente';
    case 'waiting':
      return 'Aguardando';
    case 'running':
      return 'Em execução';
    case 'blocked':
      return 'Bloqueado';
    case 'completed':
      return 'Concluído';
    case 'failed':
      return 'Falhou';
    case 'paused':
      return 'Pausado';
    case 'cancelled':
      return 'Cancelado';
    default:
      return status;
  }
}

export function computeMissionProgress(nodes: MissionAgentNode[]): number {
  const countable = nodes.filter((node) => !isMissionRootNode(node));

  if (countable.length === 0) {
    return 0;
  }

  const total = countable.reduce((sum, node) => {
    if (node.status === 'completed') {
      return sum + 100;
    }

    if (node.status === 'failed' || node.status === 'cancelled') {
      return sum + 100;
    }

    return sum + Math.max(0, Math.min(100, node.progress));
  }, 0);

  return Math.round(total / countable.length);
}

const MISSION_NODE_PLACEMENT_GRACE_MS = 5000;
const missionNodePlacedAt = new Map<string, number>();

export function markMissionNodeJustPlaced(nodeId: string): void {
  missionNodePlacedAt.set(nodeId, Date.now());
}

export function clearMissionNodePlacementGrace(nodeId: string): void {
  missionNodePlacedAt.delete(nodeId);
}

export function canDeleteMissionNodeWithoutConfirm(nodeId: string): boolean {
  const placedAt = missionNodePlacedAt.get(nodeId);
  if (placedAt == null) {
    return false;
  }

  if (Date.now() - placedAt > MISSION_NODE_PLACEMENT_GRACE_MS) {
    missionNodePlacedAt.delete(nodeId);
    return false;
  }

  return true;
}

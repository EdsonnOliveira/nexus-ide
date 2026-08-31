import { memo, useCallback, useMemo, useState, type MouseEvent, type PointerEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { GitBranch, Maximize2, X } from 'lucide-react';
import type { Mission } from '@/types/mission';
import { getBuiltinTemplateById } from '@/constants/agentTemplates';
import { getBuiltinRoleById } from '@/constants/agentRoles';
import {
  MissionGraphNode,
  type MissionGraphNodeData,
} from '@/components/mission/MissionGraphNode';
import { MissionDeleteConfirmDialog } from '@/components/mission/MissionDeleteConfirmDialog';
import {
  countMissionAgentNodes,
  getMissionNodeDisplayName,
  getMissionNodeKind,
  getMissionStatusLabel,
  getMissionToolNodeLabel,
} from '@/utils/missionHelpers';
import { getMissionAgentVisual } from '@/utils/missionAgentVisuals';
import { useMissionStore } from '@/stores/useMissionStore';

interface MissionCardProps {
  mission: Mission;
  enterDelayMs?: number;
  onOpen: (missionId: string) => void;
  onClose: (missionId: string) => void;
}

const nodeTypes = {
  missionAgent: MissionGraphNode,
};

function MissionCardComponent({
  mission,
  enterDelayMs = 0,
  onOpen,
  onClose,
}: MissionCardProps) {
  const getTemplates = useMissionStore((state) => state.getTemplates);
  const getRoles = useMissionStore((state) => state.getRoles);
  const setActiveMissionId = useMissionStore((state) => state.setActiveMissionId);
  const templates = useMemo(() => getTemplates(), [getTemplates]);
  const roles = useMemo(() => getRoles(), [getRoles]);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const nodes: Node[] = useMemo(
    () =>
      mission.nodes.map((node, index) => {
        const kind = getMissionNodeKind(node);
        const template =
          templates.find((entry) => entry.id === node.agentTemplateId) ??
          getBuiltinTemplateById(node.agentTemplateId);
        const role =
          roles.find((entry) => entry.id === node.roleId) ?? getBuiltinRoleById(node.roleId);
        const visual = getMissionAgentVisual({
          kind,
          agentTemplateId: node.agentTemplateId,
          roleId: node.roleId,
        });
        const data: MissionGraphNodeData = {
          agentName: getMissionNodeDisplayName(
            node,
            kind === 'mission'
              ? mission.title
              : kind === 'agent'
                ? (template?.name ?? 'Agent')
                : kind === 'automation'
                  ? (node.name ?? 'Nó')
                  : getMissionToolNodeLabel(kind),
          ),
          roleName: kind === 'mission' ? 'Missão' : (role?.name ?? 'Papel'),
          objective:
            kind === 'mission'
              ? mission.objective?.trim() ||
                mission.description?.trim() ||
                node.objective
              : node.objective,
          status: node.status,
          progress: kind === 'mission' ? mission.progress : node.progress,
          selected: false,
          agentIndex: index + 1,
          agentTemplateId: node.agentTemplateId,
          roleId: node.roleId,
          accentColor: visual.accent,
          kind,
          kindLabel:
            kind === 'mission'
              ? 'Missão'
              : kind === 'agent'
                ? 'Agent'
                : kind === 'automation'
                  ? 'Nó'
                  : getMissionToolNodeLabel(kind),
          automationCategory: node.automation?.category,
          isMissionRoot: kind === 'mission',
        };

        return {
          id: node.id,
          type: 'missionAgent',
          position: { ...node.position },
          data,
          draggable: false,
          selectable: false,
        };
      }),
    [mission.nodes, roles, templates],
  );

  const edges: Edge[] = useMemo(() => {
    const accentByNodeId = new Map(
      mission.nodes.map((node) => [
        node.id,
        getMissionAgentVisual({
          kind: getMissionNodeKind(node),
          agentTemplateId: node.agentTemplateId,
          roleId: node.roleId,
        }).accent,
      ]),
    );

    return mission.edges.map((edge) => {
      const accent = accentByNodeId.get(edge.sourceNodeId) ?? '#60a5fa';
      const dashed = edge.type === 'validation' || edge.type === 'dependency';

      return {
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        type: 'smoothstep',
        animated: mission.status === 'running' || edge.type === 'handoff',
        style: {
          stroke: accent,
          strokeWidth: 2,
          strokeDasharray: dashed ? '6 4' : undefined,
        },
      };
    });
  }, [mission.edges, mission.nodes, mission.status]);

  const openMissionGraph = useCallback(() => {
    setActiveMissionId(mission.id);
    onOpen(mission.id);
  }, [mission.id, onOpen, setActiveMissionId]);

  const stopAsideEvents = useCallback((event: MouseEvent | PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleClose = useCallback((event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDeleteConfirmOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    setDeleteConfirmOpen(false);
    onClose(mission.id);
  }, [mission.id, onClose]);

  const handleOpenGraph = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      openMissionGraph();
    },
    [openMissionGraph],
  );

  return (
    <>
      <article
      className='home-dashboard__agent-card home-dashboard__mission-card app-button--enter'
      style={{ animationDelay: `${enterDelayMs}ms` }}
      onClick={openMissionGraph}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openMissionGraph();
        }
      }}
      role='button'
      tabIndex={0}
      aria-label={`Abrir missão ${mission.title}`}
    >
      <div className='home-dashboard__agent-card-head'>
        <span className='home-dashboard__agent-card-thumb-wrap home-dashboard__mission-card-thumb'>
          <GitBranch size={16} strokeWidth={2.25} aria-hidden='true' />
        </span>
        <div className='home-dashboard__agent-card-copy'>
          <span className='home-dashboard__agent-card-project'>{mission.title}</span>
          <span className='home-dashboard__mission-card-meta'>
            {getMissionStatusLabel(mission.status)} · {mission.progress}% ·{' '}
            {countMissionAgentNodes(mission.nodes)} agents
          </span>
        </div>
        <div
          className='home-dashboard__agent-card-aside'
          onClick={stopAsideEvents}
          onPointerDown={stopAsideEvents}
          onMouseDown={stopAsideEvents}
        >
          <button
            type='button'
            className='home-dashboard__agent-card-terminal app-button app-button--enter'
            aria-label='Abrir Agent Graph'
            title='Abrir Agent Graph'
            onClick={handleOpenGraph}
          >
            <Maximize2 size={14} strokeWidth={2.25} aria-hidden='true' />
          </button>
          <button
            type='button'
            className='home-dashboard__agent-card-close app-button app-button--enter'
            aria-label='Apagar missão'
            title='Apagar'
            onClick={handleClose}
          >
            <X size={14} strokeWidth={2.25} aria-hidden='true' />
          </button>
        </div>
      </div>
      <div className='home-dashboard__agent-card-body home-dashboard__mission-card-body'>
        <div className='home-dashboard__mission-card-progress'>
          <div
            className='home-dashboard__mission-card-progress-bar'
            style={{ width: `${Math.max(0, Math.min(100, mission.progress))}%` }}
          />
        </div>
        <div className='home-dashboard__mission-card-graph' aria-hidden='true'>
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.28 }}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              panOnDrag={false}
              zoomOnScroll={false}
              zoomOnPinch={false}
              zoomOnDoubleClick={false}
              preventScrolling
              minZoom={0.15}
              maxZoom={1}
              proOptions={{ hideAttribution: true }}
              defaultEdgeOptions={{ type: 'smoothstep' }}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={18}
                size={1.4}
                color='rgba(186,198,214,0.38)'
              />
            </ReactFlow>
          </ReactFlowProvider>
          <button
            type='button'
            className='home-dashboard__mission-card-graph-hit app-button'
            tabIndex={-1}
            aria-hidden='true'
            onClick={handleOpenGraph}
          />
        </div>
      </div>
    </article>
      {deleteConfirmOpen ? (
        <MissionDeleteConfirmDialog
          kind='mission'
          name={mission.title}
          onConfirm={handleConfirmDelete}
          onClose={() => setDeleteConfirmOpen(false)}
        />
      ) : null}
    </>
  );
}

export const MissionCard = memo(MissionCardComponent);

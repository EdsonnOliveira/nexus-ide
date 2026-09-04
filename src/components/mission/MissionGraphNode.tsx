import { memo, useCallback, useMemo, type CSSProperties } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import type { MissionNodeKind, MissionNodeStatus } from '@/types/mission';
import {
  formatMissionNodeObjectivePreview,
  getMissionNodeStatusLabel,
  getMissionToolNodeSize,
  isMissionNoteNode,
  isMissionToolNode,
  MISSION_NOTE_NODE_DEFAULT_HEIGHT,
  MISSION_NOTE_NODE_DEFAULT_WIDTH,
  MISSION_ROOT_NODE_SIZE,
  MISSION_TOOL_NODE_MIN_HEIGHT,
  MISSION_TOOL_NODE_MIN_WIDTH,
} from '@/utils/missionHelpers';
import { getMissionAgentVisual } from '@/utils/missionAgentVisuals';
import { useMissionStore } from '@/stores/useMissionStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTabActions } from '@/stores/useTabStore';
import { MissionToolEmbed } from '@/components/mission/MissionToolEmbed';
import { MissionNoteEmbed } from '@/components/mission/MissionNoteEmbed';
import { MissionAgentEmbed } from '@/components/mission/MissionAgentEmbed';
import { findPaneTab } from '@/utils/tabGroups';
import { listLivePeers } from '@/utils/missionLiveBus';

export interface MissionGraphNodeData {
  agentName: string;
  roleName: string;
  objective: string;
  status: MissionNodeStatus;
  progress: number;
  selected: boolean;
  agentIndex: number;
  agentTemplateId: string;
  roleId: string;
  accentColor: string;
  kind?: MissionNodeKind;
  kindLabel?: string;
  nodeId?: string;
  showLivePreview?: boolean;
  showAgentLive?: boolean;
  automationCategory?: string;
  isMissionRoot?: boolean;
  livePeerCount?: number;
  onResizeEnd?: (size: { width: number; height: number }) => void;
  [key: string]: unknown;
}

function MissionGraphNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as MissionGraphNodeData;
  const visual = getMissionAgentVisual({
    kind: nodeData.kind,
    agentTemplateId: nodeData.agentTemplateId,
    roleId: nodeData.roleId,
    automationCategory: nodeData.automationCategory,
  });
  const Icon = visual.icon;
  const accent = nodeData.accentColor || visual.accent;
  const isTool = isMissionToolNode({ kind: nodeData.kind });
  const isNote = isMissionNoteNode({ kind: nodeData.kind });
  const isAutomation = nodeData.kind === 'automation';
  const isRoot = nodeData.kind === 'mission' || Boolean(nodeData.isMissionRoot);
  const isAgent = nodeData.kind === 'agent' || (!nodeData.kind && !isRoot && !isTool && !isNote && !isAutomation);
  const showToolPreview = Boolean(nodeData.showLivePreview && isTool && nodeData.nodeId);
  const showNotePreview = Boolean(isNote && nodeData.nodeId);
  const showAgentLive = Boolean(nodeData.showAgentLive && isAgent && nodeData.nodeId);
  const showHandles = !isRoot;
  const showTargetHandle = showHandles && !isRoot;
  const showSourceHandle = showHandles;
  const upsertNode = useMissionStore((state) => state.upsertNode);
  const activeMissionId = useMissionStore((state) => state.activeMissionId);
  const setTabPtyId = useProjectStore((state) => state.setTabPtyId);
  const { updateAgentTab } = useTabActions();

  const missionNode = useMissionStore((state) => {
    if (!nodeData.nodeId) {
      return null;
    }

    const active =
      (state.activeMissionId
        ? state.missions.find((mission) => mission.id === state.activeMissionId)
        : null) ??
      state.missions.find((mission) =>
        mission.nodes.some((node) => node.id === nodeData.nodeId),
      );

    return active?.nodes.find((node) => node.id === nodeData.nodeId) ?? null;
  });

  const missionIdForNode = useMissionStore((state) => {
    if (!nodeData.nodeId) {
      return null;
    }
    return (
      state.activeMissionId ??
      state.missions.find((mission) =>
        mission.nodes.some((node) => node.id === nodeData.nodeId),
      )?.id ??
      null
    );
  });

  const project = useProjectStore((state) => {
    if (!missionNode?.projectId) {
      return null;
    }
    return state.projects.find((entry) => entry.id === missionNode.projectId) ?? null;
  });

  const pane = useMemo(() => {
    if (!project || !missionNode?.paneId) {
      return null;
    }
    const tab = findPaneTab(project.tabs, missionNode.paneId);
    return tab?.type === 'agent' ? tab : null;
  }, [missionNode?.paneId, project]);

  const livePeers = useMemo(() => {
    if (!missionIdForNode || !nodeData.nodeId) {
      return [];
    }
    return listLivePeers(missionIdForNode, nodeData.nodeId);
  }, [missionIdForNode, nodeData.nodeId]);

  const handleResizeEnd = useCallback(
    (_event: unknown, params: { width: number; height: number }) => {
      const nextSize = isNote
        ? {
            width: Math.max(200, Math.round(params.width)),
            height: Math.max(160, Math.round(params.height)),
          }
        : getMissionToolNodeSize({
            size: {
              width: params.width,
              height: params.height,
            },
          });

      if (typeof nodeData.onResizeEnd === 'function') {
        nodeData.onResizeEnd(nextSize);
        return;
      }

      if (!missionNode || !activeMissionId) {
        return;
      }

      void upsertNode(activeMissionId, {
        ...missionNode,
        size: nextSize,
      });
    },
    [activeMissionId, isNote, missionNode, nodeData, upsertNode],
  );

  const objectivePreview = useMemo(() => {
    if (isAutomation) {
      return nodeData.roleName;
    }
    return formatMissionNodeObjectivePreview(nodeData.objective, nodeData.agentName);
  }, [isAutomation, nodeData.agentName, nodeData.objective, nodeData.roleName]);

  const showLiveBody = showToolPreview || showNotePreview || showAgentLive;

  return (
    <div
      className={`mission-graph-node${isTool || isNote || showAgentLive ? ' mission-graph-node--tool' : ''}${
        isAutomation ? ' mission-graph-node--automation' : ''
      }${isRoot ? ' mission-graph-node--root' : ''}${
        showLiveBody ? ' mission-graph-node--preview' : ''
      }${nodeData.selected ? ' mission-graph-node--selected' : ''}${
        nodeData.status === 'running' ? ' mission-graph-node--running' : ''
      }${isNote ? ' mission-graph-node--note' : ''}`}
      style={
        {
          width: isRoot ? MISSION_ROOT_NODE_SIZE : undefined,
          height: isRoot ? MISSION_ROOT_NODE_SIZE : undefined,
          '--mission-node-accent': accent,
          '--mission-node-accent-soft': visual.accentSoft,
          '--mission-node-accent-border': visual.accentBorder,
        } as CSSProperties
      }
    >
      {isTool || isNote || showAgentLive ? (
        <NodeResizer
          isVisible={selected || nodeData.selected}
          minWidth={isNote ? 200 : MISSION_TOOL_NODE_MIN_WIDTH}
          minHeight={isNote ? 160 : MISSION_TOOL_NODE_MIN_HEIGHT}
          color={accent}
          lineStyle={{ borderWidth: 1 }}
          handleStyle={{
            width: 10,
            height: 10,
            borderRadius: 3,
            borderWidth: 1,
          }}
          onResizeEnd={handleResizeEnd}
        />
      ) : null}
      {showTargetHandle ? (
        <Handle type='target' position={Position.Left} className='mission-graph-node__handle' />
      ) : null}
      <span className='mission-graph-node__index'>
        {isRoot
          ? 'MISSÃO'
          : `${(nodeData.kindLabel || 'AGENT').toUpperCase()} ${nodeData.agentIndex || 1}`}
      </span>
      <div className='mission-graph-node__main'>
        <span className='mission-graph-node__icon' aria-hidden='true'>
          <Icon size={isRoot ? 28 : 16} strokeWidth={2.2} />
        </span>
        <div className='mission-graph-node__copy'>
          <span className='mission-graph-node__name'>{nodeData.agentName}</span>
          {showLiveBody ? null : (
            <p className='mission-graph-node__objective'>{objectivePreview}</p>
          )}
          {nodeData.kind === 'agent' || isAutomation ? (
            <span className='mission-graph-node__role-pill'>{nodeData.roleName}</span>
          ) : null}
          {livePeers.length > 0 ? (
            <span className='mission-graph-node__live-badge'>
              Live · {livePeers.length}
            </span>
          ) : null}
        </div>
      </div>
      {showToolPreview && missionNode && isMissionToolNode(missionNode) ? (
        <div
          className='mission-graph-node__preview nodrag nopan nowheel'
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <MissionToolEmbed
            node={missionNode}
            live
            variant='node'
            focused={nodeData.selected}
          />
        </div>
      ) : null}
      {showNotePreview && missionNode && missionIdForNode ? (
        <div
          className='mission-graph-node__preview nodrag nopan nowheel'
          style={{
            width: missionNode.size?.width ?? MISSION_NOTE_NODE_DEFAULT_WIDTH,
            height: missionNode.size?.height ?? MISSION_NOTE_NODE_DEFAULT_HEIGHT,
          }}
        >
          <MissionNoteEmbed
            node={missionNode}
            missionId={missionIdForNode}
            focused={nodeData.selected}
          />
        </div>
      ) : null}
      {showAgentLive && missionNode && project && pane ? (
        <div
          className='mission-graph-node__preview nodrag nopan nowheel'
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <MissionAgentEmbed
            node={missionNode}
            projectId={project.id}
            projectPath={project.path}
            pane={pane}
            focused={nodeData.selected}
            setTabPtyId={setTabPtyId}
            updateAgentTab={updateAgentTab}
          />
        </div>
      ) : null}
      {showLiveBody ? null : (
        <>
          <div className='mission-graph-node__footer'>
            <span className='mission-graph-node__status'>
              <span
                className={`mission-graph-node__status-dot mission-graph-node__status-dot--${nodeData.status}`}
                aria-hidden='true'
              />
              {isRoot ? 'Núcleo' : getMissionNodeStatusLabel(nodeData.status)}
            </span>
            {isRoot ? null : (
              <span className='mission-graph-node__progress'>{nodeData.progress}%</span>
            )}
          </div>
          {isRoot ? null : (
            <div className='mission-graph-node__bar'>
              <div style={{ width: `${Math.max(0, Math.min(100, nodeData.progress))}%` }} />
            </div>
          )}
        </>
      )}
      {showSourceHandle ? (
        <Handle type='source' position={Position.Right} className='mission-graph-node__handle' />
      ) : null}
    </div>
  );
}

export const MissionGraphNode = memo(MissionGraphNodeComponent);

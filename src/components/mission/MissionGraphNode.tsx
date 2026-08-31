import { memo, useCallback, useMemo, type CSSProperties } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import type { MissionNodeKind, MissionNodeStatus } from '@/types/mission';
import {
  formatMissionNodeObjectivePreview,
  getMissionNodeStatusLabel,
  getMissionToolNodeSize,
  isMissionToolNode,
  MISSION_ROOT_NODE_SIZE,
  MISSION_TOOL_NODE_MIN_HEIGHT,
  MISSION_TOOL_NODE_MIN_WIDTH,
} from '@/utils/missionHelpers';
import { getMissionAgentVisual } from '@/utils/missionAgentVisuals';
import { useMissionStore } from '@/stores/useMissionStore';
import { MissionToolEmbed } from '@/components/mission/MissionToolEmbed';

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
  automationCategory?: string;
  isMissionRoot?: boolean;
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
  const isAutomation = nodeData.kind === 'automation';
  const isRoot = nodeData.kind === 'mission' || Boolean(nodeData.isMissionRoot);
  const showLivePreview = Boolean(nodeData.showLivePreview && isTool && nodeData.nodeId);
  const showHandles = !isTool;
  const showTargetHandle = showHandles && !isRoot;
  const showSourceHandle = showHandles;
  const upsertNode = useMissionStore((state) => state.upsertNode);
  const activeMissionId = useMissionStore((state) => state.activeMissionId);

  const missionNode = useMissionStore((state) => {
    if (!showLivePreview || !nodeData.nodeId) {
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

  const previewNode = useMemo(() => {
    if (!missionNode || !isMissionToolNode(missionNode)) {
      return null;
    }
    return missionNode;
  }, [missionNode]);

  const handleResizeEnd = useCallback(
    (_event: unknown, params: { width: number; height: number }) => {
      const nextSize = getMissionToolNodeSize({
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

      const current = getMissionToolNodeSize(missionNode);
      if (current.width === nextSize.width && current.height === nextSize.height) {
        return;
      }

      void upsertNode(activeMissionId, {
        ...missionNode,
        size: nextSize,
      });
    },
    [activeMissionId, missionNode, nodeData, upsertNode],
  );

  const objectivePreview = useMemo(() => {
    if (isAutomation) {
      return nodeData.roleName;
    }
    return formatMissionNodeObjectivePreview(nodeData.objective, nodeData.agentName);
  }, [isAutomation, nodeData.agentName, nodeData.objective, nodeData.roleName]);

  return (
    <div
      className={`mission-graph-node${isTool ? ' mission-graph-node--tool' : ''}${
        isAutomation ? ' mission-graph-node--automation' : ''
      }${isRoot ? ' mission-graph-node--root' : ''}${
        showLivePreview ? ' mission-graph-node--preview' : ''
      }${nodeData.selected ? ' mission-graph-node--selected' : ''}${
        nodeData.status === 'running' ? ' mission-graph-node--running' : ''
      }`}
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
      {isTool ? (
        <NodeResizer
          isVisible={selected || nodeData.selected}
          minWidth={MISSION_TOOL_NODE_MIN_WIDTH}
          minHeight={MISSION_TOOL_NODE_MIN_HEIGHT}
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
          {showLivePreview ? null : (
            <p className='mission-graph-node__objective'>
              {objectivePreview}
            </p>
          )}
          {nodeData.kind === 'agent' || isAutomation ? (
            <span className='mission-graph-node__role-pill'>{nodeData.roleName}</span>
          ) : null}
        </div>
      </div>
      {showLivePreview && previewNode ? (
        <div
          className='mission-graph-node__preview nodrag nopan nowheel'
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <MissionToolEmbed
            node={previewNode}
            live
            variant='node'
            focused={nodeData.selected}
          />
        </div>
      ) : null}
      {showLivePreview ? null : (
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

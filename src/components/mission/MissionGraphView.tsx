import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  MousePointer2,
  LayoutGrid,
  MoveRight,
  Pause,
  Pencil,
  Play,
  Plus,
  Scan,
  Square,
  Trash2,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { MissionGraphNode, type MissionGraphNodeData } from '@/components/mission/MissionGraphNode';
import { MissionInspector } from '@/components/mission/MissionInspector';
import {
  MissionNodeLibrary,
  MISSION_LIBRARY_DRAG_MIME,
  readMissionLibraryDragPayload,
} from '@/components/mission/MissionNodeLibrary';
import { MissionNodeContextMenu } from '@/components/mission/MissionNodeContextMenu';
import { MissionFlowTemplateContextMenu } from '@/components/mission/MissionFlowTemplateContextMenu';
import { FlowTemplateEditorDialog } from '@/components/mission/FlowTemplateEditorDialog';
import { MissionDeleteConfirmDialog } from '@/components/mission/MissionDeleteConfirmDialog';
import { MissionGraphHelperLines } from '@/components/mission/MissionGraphHelperLines';
import {
  getMissionAutomationCatalogEntry,
  getMissionAutomationCategoryLabel,
  type MissionAutomationCatalogEntry,
} from '@/constants/missionAutomationCatalog';
import { getBuiltinRoleById } from '@/constants/agentRoles';
import { getBuiltinTemplateById, resolveAgentTemplateObjective } from '@/constants/agentTemplates';
import { preferredAiProviderToCli } from '@/constants/aiProviders';
import { useAppSettingsStore } from '@/stores/useAppSettingsStore';
import { useMissionStore } from '@/stores/useMissionStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTabActions } from '@/stores/useTabStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { computeMissionTokenUsage } from '@/utils/missionContextActions';
import { getMissionAgentVisual } from '@/utils/missionAgentVisuals';
import {
  resolveMissionGraphAlignment,
  type MissionGraphHelperLine,
  type MissionGraphSpacingGuide,
} from '@/utils/missionGraphHelperLines';
import {
  createMissionAutomationNode,
  createMissionEdge,
  createMissionNode,
  createMissionToolNode,
  createMissionNoteNode,
  createSequentialMissionNodes,
  duplicateMissionNode,
  canDeleteMissionNodeWithoutConfirm,
  clearMissionNodePlacementGrace,
  getMissionNodeDisplayName,
  getMissionNodeKind,
  getMissionStatusLabel,
  getMissionToolNodeLabel,
  getMissionToolNodeSize,
  instantiateFlowTemplate,
  isMissionRootNode,
  isMissionToolNode,
  isMissionNoteNode,
  isMissionAgentNode,
  markMissionNodeJustPlaced,
  MISSION_ROOT_NODE_SIZE,
  MISSION_NOTE_NODE_DEFAULT_WIDTH,
  MISSION_NOTE_NODE_DEFAULT_HEIGHT,
  resolveMissionDeleteNodeTarget,
  countMissionAgentNodes,
} from '@/utils/missionHelpers';
import type {
  MissionAgentNode,
  MissionDrawingKind,
  MissionFlowTemplate,
  MissionNodeKind,
} from '@/types/mission';
import { cancelMission, pauseMission, startMission } from '@/utils/missionOrchestrator';
import { resolveAgentLaunchCommand } from '@/utils/resolveAgentLaunchCommand';
import { resolveAgentTabCli } from '@/utils/agentTabHelpers';
import { findPaneTab } from '@/utils/tabGroups';
import { MissionDrawingLayer } from '@/components/mission/MissionDrawingLayer';
import { MissionMarqueeLayer, type MissionMarqueeLayerHandle } from '@/components/mission/MissionMarqueeLayer';
import { MissionCompanionOverlay } from '@/components/mission/MissionCompanionOverlay';

const LazyAgentView = lazy(() =>
  import('@/components/agent/AgentView').then((module) => ({
    default: module.AgentView,
  })),
);

const LazyAgentViewSession = lazy(() =>
  import('@/components/agent/AgentViewSession').then((module) => ({
    default: module.AgentViewSession,
  })),
);

const nodeTypes = {
  missionAgent: MissionGraphNode,
};

interface MissionGraphViewProps {
  missionId: string;
  onClose: () => void;
}

type MissionPendingDelete =
  | { type: 'node'; nodeId: string; kind: 'agent' | 'node'; name: string }
  | { type: 'nodes'; nodeIds: string[]; count: number }
  | {
      type: 'selection';
      nodeIds: string[];
      drawingIds: string[];
      count: number;
    }
  | { type: 'flow'; flowInstanceId: string; name: string }
  | { type: 'flowTemplate'; templateId: string; name: string };

interface MissionAgentRuntimeHostItemProps {
  node: MissionAgentNode;
  projectId: string;
  projectPath: string;
  pane: NonNullable<ReturnType<typeof findPaneTab>>;
  setTabPtyId: (projectId: string, paneId: string, ptyId: string | null) => void;
  updateAgentTab: (
    tabId: string,
    patch: Partial<Pick<import('@/types').AgentTab, 'turns' | 'followUps' | 'workingDirectory' | 'restoreCommand'>>,
  ) => Promise<void> | void;
}

function MissionAgentRuntimeHostItemComponent({
  node,
  projectId,
  projectPath,
  pane,
  setTabPtyId,
  updateAgentTab,
}: MissionAgentRuntimeHostItemProps) {
  const paneId = node.paneId;
  const handlePtyCreated = useCallback(
    (ptyId: string) => {
      if (!paneId) {
        return;
      }
      setTabPtyId(projectId, paneId, ptyId);
    },
    [paneId, projectId, setTabPtyId],
  );
  const handlePtyLost = useCallback(() => {
    if (!paneId) {
      return;
    }
    setTabPtyId(projectId, paneId, null);
  }, [paneId, projectId, setTabPtyId]);
  const handleUpdateTab = useCallback(
    (
      patch: Partial<
        Pick<import('@/types').AgentTab, 'turns' | 'followUps' | 'workingDirectory' | 'restoreCommand'>
      >,
    ) => {
      if (!paneId) {
        return;
      }
      void updateAgentTab(paneId, patch);
    },
    [paneId, updateAgentTab],
  );

  if (pane.type !== 'agent') {
    return null;
  }

  return (
    <div className='mission-graph-view__agent-host-item'>
      <Suspense fallback={null}>
        <LazyAgentViewSession
          tab={pane}
          projectId={projectId}
          projectPath={projectPath}
          isVisible={false}
          isRuntimeActive
          isFocused={false}
          disableStickyPrompt
          onFocusPane={() => undefined}
          onPtyCreated={handlePtyCreated}
          onPtyLost={handlePtyLost}
          onUpdateTab={handleUpdateTab}
        />
      </Suspense>
    </div>
  );
}

const MissionAgentRuntimeHostItem = memo(MissionAgentRuntimeHostItemComponent);

function MissionGraphCanvas({ missionId, onClose }: MissionGraphViewProps) {
  const mission = useMissionStore((state) =>
    state.missions.find((entry) => entry.id === missionId),
  );
  const selectedNodeId = useMissionStore((state) => state.selectedNodeId);
  const selectedNodeIds = useMissionStore((state) => state.selectedNodeIds);
  const selectedEdgeId = useMissionStore((state) => state.selectedEdgeId);
  const setSelectedNodeId = useMissionStore((state) => state.setSelectedNodeId);
  const setSelectedNodeIds = useMissionStore((state) => state.setSelectedNodeIds);
  const clearSelectedNodeIds = useMissionStore((state) => state.clearSelectedNodeIds);
  const setSelectedEdgeId = useMissionStore((state) => state.setSelectedEdgeId);
  const upsertNode = useMissionStore((state) => state.upsertNode);
  const removeNode = useMissionStore((state) => state.removeNode);
  const upsertEdge = useMissionStore((state) => state.upsertEdge);
  const removeEdge = useMissionStore((state) => state.removeEdge);
  const updateMission = useMissionStore((state) => state.updateMission);
  const getRoles = useMissionStore((state) => state.getRoles);
  const getTemplates = useMissionStore((state) => state.getTemplates);
  const flowTemplates = useMissionStore((state) => state.flowTemplates);
  const removeFlowTemplate = useMissionStore((state) => state.removeFlowTemplate);
  const projects = useProjectStore((state) => state.projects);
  const { addAgentTabForProject, addTabForProject, updateAgentTab } = useTabActions();
  const setTabPtyId = useProjectStore((state) => state.setTabPtyId);
  const { fitView, zoomIn, zoomOut, getViewport, setViewport, screenToFlowPosition } =
    useReactFlow();
  const [zoomLabel, setZoomLabel] = useState(100);
  const [autoProposeBusy, setAutoProposeBusy] = useState(false);
  const [conversationOpenKey, setConversationOpenKey] = useState(0);
  const [flowEditorOpen, setFlowEditorOpen] = useState(false);
  const [editingFlowTemplate, setEditingFlowTemplate] = useState<MissionFlowTemplate | null>(null);
  const [nodeContextMenu, setNodeContextMenu] = useState<{
    nodeId: string;
    x: number;
    y: number;
  } | null>(null);
  const [flowTemplateContextMenu, setFlowTemplateContextMenu] = useState<{
    templateId: string;
    x: number;
    y: number;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MissionPendingDelete | null>(null);
  const [helperHorizontal, setHelperHorizontal] = useState<MissionGraphHelperLine | null>(null);
  const [helperVertical, setHelperVertical] = useState<MissionGraphHelperLine | null>(null);
  const [helperSpacings, setHelperSpacings] = useState<MissionGraphSpacingGuide[]>([]);
  const [libraryVisible, setLibraryVisible] = useState(() => {
    try {
      return localStorage.getItem('nexus.mission-graph.library-visible') !== 'false';
    } catch {
      return true;
    }
  });
  const setMissionLibraryVisible = useCallback((visible: boolean) => {
    setLibraryVisible(visible);
    try {
      localStorage.setItem('nexus.mission-graph.library-visible', String(visible));
    } catch {
      // ignore
    }
  }, []);
  const [drawingTool, setDrawingTool] = useState<MissionDrawingKind | null>(null);
  const [selectedDrawingIds, setSelectedDrawingIds] = useState<string[]>([]);
  const [metaKeyDown, setMetaKeyDown] = useState(false);
  const draggingRef = useRef(false);
  const didFitRef = useRef<string | null>(null);
  const justMarqueedRef = useRef(false);
  const marqueeRef = useRef<MissionMarqueeLayerHandle | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const viewportZoom = useStore((state) => state.transform[2] || 1);

  const roles = useMemo(() => getRoles(), [getRoles]);
  const templates = useMemo(() => getTemplates(), [getTemplates]);
  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const deletableSelectedNodeIds = useMemo(() => {
    if (!mission) {
      return [];
    }
    return selectedNodeIds.filter((id) => {
      const node = mission.nodes.find((entry) => entry.id === id);
      return node && !isMissionRootNode(node);
    });
  }, [mission, selectedNodeIds]);
  const selectionCount = deletableSelectedNodeIds.length + selectedDrawingIds.length;

  const clearCanvasSelection = useCallback(() => {
    clearSelectedNodeIds();
    setSelectedDrawingIds([]);
  }, [clearSelectedNodeIds]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey) {
        setMetaKeyDown(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!event.metaKey) {
        setMetaKeyDown(false);
      }
    };
    const handleBlur = () => {
      setMetaKeyDown(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const launchForProject = useCallback(
    async (projectId: string, command?: string) => {
      const project = projects.find((entry) => entry.id === projectId);
      if (!project) {
        return null;
      }
      const resolved = command?.trim()
        ? command
        : await resolveAgentLaunchCommand(project.path);
      return addAgentTabForProject(projectId, resolved);
    },
    [addAgentTabForProject, projects],
  );

  const nodesSignature = useMemo(() => {
    if (!mission) {
      return '';
    }

    return mission.nodes
      .map(
        (node) =>
          `${node.id}|${node.kind ?? 'agent'}|${node.position.x}|${node.position.y}|${node.size?.width ?? ''}|${node.size?.height ?? ''}|${node.status}|${node.progress}|${node.name ?? ''}|${node.objective}|${node.roleId}|${node.agentTemplateId}|${node.paneId ?? ''}`,
      )
      .join(';') + `|mission:${mission.title}|${mission.description ?? ''}|${mission.objective ?? ''}|${mission.status}|${mission.progress}`;
  }, [mission]);

  const edgesSignature = useMemo(() => {
    if (!mission) {
      return '';
    }

    return mission.edges
      .map((edge) => `${edge.id}|${edge.sourceNodeId}|${edge.targetNodeId}|${edge.type}`)
      .join(';');
  }, [mission]);

  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    if (!mission || draggingRef.current) {
      return;
    }

    setNodes(
      mission.nodes.map((node, index) => {
        const template =
          templates.find((entry) => entry.id === node.agentTemplateId) ??
          getBuiltinTemplateById(node.agentTemplateId);
        const role =
          roles.find((entry) => entry.id === node.roleId) ?? getBuiltinRoleById(node.roleId);
        const kind = getMissionNodeKind(node);
        const isRoot = kind === 'mission';
        const visual = getMissionAgentVisual({
          kind,
          agentTemplateId: node.agentTemplateId,
          roleId: node.roleId,
          automationCategory: node.automation?.category,
        });
        const agentIndex = isRoot
          ? 0
          : mission.nodes
              .filter((entry) => getMissionNodeKind(entry) !== 'mission')
              .findIndex((entry) => entry.id === node.id) + 1;
        const fallbackName = isRoot
          ? mission.title
          : kind === 'agent'
            ? (template?.name ?? 'Agent')
            : kind === 'automation'
              ? (node.name ?? 'Nó')
              : getMissionToolNodeLabel(kind);
        const data: MissionGraphNodeData = {
          agentName: isRoot
            ? mission.title
            : getMissionNodeDisplayName(node, fallbackName),
          roleName: isRoot
            ? 'Missão'
            : kind === 'automation'
              ? getMissionAutomationCategoryLabel(node.automation?.category ?? 'flow')
              : (role?.name ?? 'Papel'),
          objective: isRoot
            ? (mission.description?.trim() ||
                mission.objective?.trim() ||
                node.objective ||
                'Defina o objetivo da missão')
            : node.objective,
          status: isRoot
            ? mission.status === 'running'
              ? 'running'
              : mission.status === 'completed'
                ? 'completed'
                : mission.status === 'failed' || mission.status === 'cancelled'
                  ? 'failed'
                  : mission.status === 'paused'
                    ? 'paused'
                    : 'pending'
            : node.status,
          progress: isRoot ? mission.progress : node.progress,
          selected: selectedNodeIdSet.has(node.id),
          agentIndex: agentIndex || index + 1,
          agentTemplateId: node.agentTemplateId,
          roleId: node.roleId,
          accentColor: visual.accent,
          kind,
          kindLabel: isRoot
            ? 'Missão'
            : kind === 'agent'
              ? 'Agent'
              : kind === 'automation'
                ? 'Nó'
                : kind === 'note'
                  ? 'Nota'
                  : getMissionToolNodeLabel(kind),
          nodeId: node.id,
          showLivePreview: isMissionToolNode(node),
          showAgentLive:
            kind === 'agent' && (Boolean(node.liveExpanded) || viewportZoom >= 0.85),
          livePeerCount: mission.edges.filter(
            (edge) =>
              edge.type === 'live' &&
              (edge.sourceNodeId === node.id || edge.targetNodeId === node.id),
          ).length,
          automationCategory: node.automation?.category,
          isMissionRoot: isRoot,
        };

        const toolSize = isMissionToolNode(node)
          ? getMissionToolNodeSize(node)
          : isMissionNoteNode(node)
            ? {
                width: node.size?.width ?? MISSION_NOTE_NODE_DEFAULT_WIDTH,
                height: node.size?.height ?? MISSION_NOTE_NODE_DEFAULT_HEIGHT,
              }
            : kind === 'agent' && (Boolean(node.liveExpanded) || viewportZoom >= 0.85)
              ? getMissionToolNodeSize(node)
              : null;

        return {
          id: node.id,
          type: 'missionAgent',
          position: { ...node.position },
          data,
          selected: selectedNodeIdSet.has(node.id),
          draggable: true,
          selectable: true,
          deletable: !isRoot,
          style: toolSize
            ? {
                width: toolSize.width,
                height: toolSize.height,
              }
            : isRoot
              ? {
                  width: MISSION_ROOT_NODE_SIZE,
                  height: MISSION_ROOT_NODE_SIZE,
                }
              : undefined,
        };
      }),
    );
  }, [mission, nodesSignature, roles, selectedNodeIdSet, setNodes, templates, viewportZoom]);

  useEffect(() => {
    if (!mission) {
      return;
    }

    const accentByNodeId = new Map(
      mission.nodes.map((node) => [
        node.id,
        getMissionAgentVisual({
          kind: getMissionNodeKind(node),
          agentTemplateId: node.agentTemplateId,
          roleId: node.roleId,
          automationCategory: node.automation?.category,
        }).accent,
      ]),
    );

    setEdges(
      mission.edges.map((edge) => {
        const accent =
          edge.type === 'live'
            ? '#34d399'
            : (accentByNodeId.get(edge.sourceNodeId) ?? '#60a5fa');
        const dashed = edge.type === 'validation' || edge.type === 'dependency';
        const live = edge.type === 'live';

        return {
          id: edge.id,
          source: edge.sourceNodeId,
          target: edge.targetNodeId,
          type: 'smoothstep',
          animated:
            mission.status === 'running' ||
            edge.type === 'handoff' ||
            edge.type === 'live',
          selected: edge.id === selectedEdgeId,
          label: edge.type,
          selectable: true,
          style: {
            stroke: accent,
            strokeWidth: live ? 2.75 : 2.25,
            strokeDasharray: dashed ? '7 5' : live ? '2 6' : undefined,
          },
          labelStyle: {
            fill: accent,
            fontSize: 10,
            fontWeight: 600,
          },
          labelBgStyle: {
              fill: 'rgba(7, 18, 36, 0.92)',
            },
            labelBgPadding: [6, 4] as [number, number],
            labelBgBorderRadius: 6,
          };
        }),
    );
  }, [edgesSignature, mission, selectedEdgeId, setEdges]);

  useEffect(() => {
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        const selected = selectedNodeIdSet.has(node.id);
        if (node.selected === selected && Boolean(node.data?.selected) === selected) {
          return node;
        }
        changed = true;
        return {
          ...node,
          selected,
          data: {
            ...node.data,
            selected,
          },
        };
      });
      return changed ? next : current;
    });
  }, [selectedNodeIdSet, setNodes]);

  useEffect(() => {
    setEdges((current) => {
      let changed = false;
      const next = current.map((edge) => {
        const selected = edge.id === selectedEdgeId;
        if (edge.selected === selected) {
          return edge;
        }
        changed = true;
        return { ...edge, selected };
      });
      return changed ? next : current;
    });
  }, [selectedEdgeId, setEdges]);

  useEffect(() => {
    if (!mission) {
      return;
    }
    if (didFitRef.current === mission.id) {
      return;
    }

    if (mission.viewport) {
      didFitRef.current = mission.id;
      setViewport(mission.viewport);
      setZoomLabel(Math.round(mission.viewport.zoom * 100));
      return;
    }

    if (mission.nodes.length === 0) {
      return;
    }

    didFitRef.current = mission.id;
    const frame = window.requestAnimationFrame(() => {
      void Promise.resolve(fitView({ padding: 0.24, duration: 200 })).then(() => {
        setZoomLabel(Math.round(getViewport().zoom * 100));
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitView, getViewport, mission, setViewport]);

  const persistViewport = useCallback(() => {
    if (!mission) {
      return;
    }
    const viewport = getViewport();
    void updateMission(mission.id, { viewport });
    setZoomLabel(Math.round(viewport.zoom * 100));
  }, [getViewport, mission, updateMission]);

  const handleFitView = useCallback(() => {
    void Promise.resolve(fitView({ padding: 0.24, duration: 200, maxZoom: 1.2 })).then(() => {
      persistViewport();
    });
  }, [fitView, persistViewport]);

  const handleZoomIn = useCallback(() => {
    void Promise.resolve(zoomIn({ duration: 120 })).then(() => {
      persistViewport();
    });
  }, [persistViewport, zoomIn]);

  const handleZoomOut = useCallback(() => {
    void Promise.resolve(zoomOut({ duration: 120 })).then(() => {
      persistViewport();
    });
  }, [persistViewport, zoomOut]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const dragging = changes.some(
        (change) => change.type === 'position' && 'dragging' in change && change.dragging,
      );
      if (dragging) {
        draggingRef.current = true;
      }
      onNodesChangeBase(changes);
    },
    [onNodesChangeBase],
  );

  const handleNodeClick = useCallback(
    (_event: ReactMouseEvent, node: Node) => {
      setNodeContextMenu(null);
      if (_event.metaKey) {
        return;
      }
      setSelectedDrawingIds([]);
      setSelectedNodeId(node.id);
    },
    [setSelectedNodeId],
  );

  const handleNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: Node) => {
      event.preventDefault();
      event.stopPropagation();
      setSelectedNodeId(node.id);
      setSelectedEdgeId(null);
      setNodeContextMenu({
        nodeId: node.id,
        x: event.clientX,
        y: event.clientY,
      });
    },
    [setSelectedEdgeId, setSelectedNodeId],
  );

  const handleDuplicateNode = useCallback(
    async (nodeId: string) => {
      if (!mission) {
        return;
      }

      const source = mission.nodes.find((entry) => entry.id === nodeId);
      if (!source || isMissionRootNode(source)) {
        return;
      }

      const nextNode = duplicateMissionNode(source);
      const kind = getMissionNodeKind(nextNode);

      if (kind !== 'agent' && kind !== 'automation' && kind !== 'mission' && kind !== 'note' && kind !== 'drawing') {
        const paneId = await addTabForProject(nextNode.projectId, kind);
        if (!paneId) {
          return;
        }
        nextNode.paneId = paneId;
      }

      await upsertNode(mission.id, nextNode);
      markMissionNodeJustPlaced(nextNode.id);
      setSelectedNodeId(nextNode.id);
    },
    [addTabForProject, mission, setSelectedNodeId, upsertNode],
  );

  const handleDeleteNode = useCallback(
    async (nodeId: string) => {
      if (!mission) {
        return;
      }

      const target = mission.nodes.find((entry) => entry.id === nodeId);
      if (target && isMissionRootNode(target)) {
        return;
      }

      await removeNode(mission.id, nodeId);
      clearMissionNodePlacementGrace(nodeId);
      const nextIds = selectedNodeIds.filter((id) => id !== nodeId);
      if (nextIds.length === 0) {
        clearSelectedNodeIds();
      } else {
        setSelectedNodeIds(nextIds);
      }
      setNodeContextMenu(null);
    },
    [clearSelectedNodeIds, mission, removeNode, selectedNodeIds, setSelectedNodeIds],
  );

  const handleDeleteSelection = useCallback(
    async (nodeIds: string[], drawingIds: string[]) => {
      if (!mission) {
        return;
      }

      const deletable = nodeIds.filter((id) => {
        const target = mission.nodes.find((entry) => entry.id === id);
        return target && !isMissionRootNode(target);
      });

      if (drawingIds.length > 0) {
        const removeDrawingIds = new Set(drawingIds);
        await updateMission(mission.id, {
          drawings: (mission.drawings ?? []).filter(
            (drawing) => !removeDrawingIds.has(drawing.id),
          ),
        });
      }

      for (const nodeId of deletable) {
        await removeNode(mission.id, nodeId);
        clearMissionNodePlacementGrace(nodeId);
      }

      clearCanvasSelection();
      setNodeContextMenu(null);
    },
    [clearCanvasSelection, mission, removeNode, updateMission],
  );

  const requestDeleteSelection = useCallback(
    (nodeIds: string[], drawingIds: string[]) => {
      const deletable = nodeIds.filter((id) => {
        const target = mission?.nodes.find((entry) => entry.id === id);
        return target && !isMissionRootNode(target);
      });

      if (deletable.length === 0 && drawingIds.length === 0) {
        return;
      }

      const needsConfirm = deletable.some((id) => !canDeleteMissionNodeWithoutConfirm(id));
      if (needsConfirm) {
        setPendingDelete({
          type: 'selection',
          nodeIds: deletable,
          drawingIds,
          count: deletable.length + drawingIds.length,
        });
        return;
      }

      void handleDeleteSelection(deletable, drawingIds);
    },
    [handleDeleteSelection, mission?.nodes],
  );

  const handleDeleteSelectedNodes = useCallback(
    async (nodeIds: string[]) => {
      await handleDeleteSelection(nodeIds, []);
    },
    [handleDeleteSelection],
  );

  const requestDeleteSelectedNodes = useCallback(
    (nodeIds: string[]) => {
      requestDeleteSelection(nodeIds, []);
    },
    [requestDeleteSelection],
  );

  const requestDeleteNode = useCallback(
    (node: MissionAgentNode) => {
      if (isMissionRootNode(node)) {
        return;
      }

      if (canDeleteMissionNodeWithoutConfirm(node.id)) {
        void handleDeleteNode(node.id);
        return;
      }

      const template =
        templates.find((entry) => entry.id === node.agentTemplateId) ??
        getBuiltinTemplateById(node.agentTemplateId);
      const target = resolveMissionDeleteNodeTarget(node, template?.name ?? 'Agent');
      setPendingDelete({
        type: 'node',
        nodeId: node.id,
        kind: target.kind,
        name: target.name,
      });
    },
    [handleDeleteNode, templates],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Backspace' && event.key !== 'Delete') {
        return;
      }
      if (pendingDelete || !mission) {
        return;
      }

      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
      }

      if (selectedEdgeId) {
        event.preventDefault();
        void removeEdge(mission.id, selectedEdgeId);
        setSelectedEdgeId(null);
        return;
      }

      const multiSelected = selectedNodeIds.filter((id) => {
        const node = mission.nodes.find((entry) => entry.id === id);
        return node && !isMissionRootNode(node);
      });

      if (multiSelected.length > 0 || selectedDrawingIds.length > 0) {
        event.preventDefault();
        requestDeleteSelection(multiSelected, selectedDrawingIds);
        return;
      }

      if (!selectedNodeId) {
        return;
      }

      const node = mission.nodes.find((entry) => entry.id === selectedNodeId);
      if (!node) {
        return;
      }

      event.preventDefault();
      requestDeleteNode(node);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    mission,
    pendingDelete,
    removeEdge,
    requestDeleteNode,
    requestDeleteSelection,
    selectedDrawingIds,
    selectedEdgeId,
    selectedNodeId,
    selectedNodeIds,
    setSelectedEdgeId,
  ]);

  const handleDeleteFlowInstance = useCallback(
    async (flowInstanceId: string) => {
      if (!mission || !flowInstanceId) {
        return;
      }

      const removeIds = new Set(
        mission.nodes
          .filter((node) => node.flowInstanceId === flowInstanceId)
          .map((node) => node.id),
      );
      if (removeIds.size === 0) {
        return;
      }

      await updateMission(mission.id, {
        nodes: mission.nodes.filter((node) => !removeIds.has(node.id)),
        edges: mission.edges.filter(
          (edge) => !removeIds.has(edge.sourceNodeId) && !removeIds.has(edge.targetNodeId),
        ),
      });

      if (selectedNodeIds.some((id) => removeIds.has(id))) {
        clearSelectedNodeIds();
      }
      setNodeContextMenu(null);
    },
    [clearSelectedNodeIds, mission, selectedNodeIds, updateMission],
  );

  const handleEdgeClick = useCallback(
    (_event: ReactMouseEvent, edge: Edge) => {
      setNodeContextMenu(null);
      setSelectedEdgeId(edge.id);
    },
    [setSelectedEdgeId],
  );

  const handlePaneClick = useCallback(() => {
    if (justMarqueedRef.current) {
      justMarqueedRef.current = false;
      return;
    }
    setNodeContextMenu(null);
    clearCanvasSelection();
    setSelectedEdgeId(null);
  }, [clearCanvasSelection, setSelectedEdgeId]);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!mission || !connection.source || !connection.target) {
        return;
      }
      const sourceNode = mission.nodes.find((entry) => entry.id === connection.source);
      const targetNode = mission.nodes.find((entry) => entry.id === connection.target);
      if (
        !sourceNode ||
        !targetNode ||
        isMissionRootNode(targetNode)
      ) {
        return;
      }
      const edge = createMissionEdge({
        sourceNodeId: connection.source,
        targetNodeId: connection.target,
        type:
          isMissionToolNode(sourceNode) ||
          isMissionToolNode(targetNode) ||
          isMissionNoteNode(sourceNode) ||
          isMissionNoteNode(targetNode)
            ? 'live'
            : 'handoff',
      });
      const accent = getMissionAgentVisual({
        agentTemplateId: sourceNode.agentTemplateId,
        roleId: sourceNode.roleId,
      }).accent;
      void upsertEdge(mission.id, edge);
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: edge.id,
            type: 'smoothstep',
            label: edge.type,
            style: {
              stroke: accent,
              strokeWidth: 2.25,
            },
            labelStyle: {
              fill: accent,
              fontSize: 10,
              fontWeight: 600,
            },
            labelBgStyle: {
              fill: 'rgba(7, 18, 36, 0.92)',
            },
          },
          current,
        ),
      );
      setSelectedEdgeId(edge.id);
    },
    [mission, setEdges, setSelectedEdgeId, upsertEdge],
  );

  const handleNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      draggingRef.current = false;
      setHelperHorizontal(null);
      setHelperVertical(null);
      setHelperSpacings([]);
      if (!mission) {
        return;
      }
      const current = mission.nodes.find((entry) => entry.id === node.id);
      if (!current) {
        return;
      }
      void upsertNode(mission.id, { ...current, position: node.position });
    },
    [mission, upsertNode],
  );

  const handleStart = useCallback(() => {
    if (!mission) {
      return;
    }
    void startMission({
      missionId: mission.id,
      addAgentTabForProject: launchForProject,
      activateAgentNode: async (nodeId) => {
        setSelectedNodeId(nodeId);
        setSelectedEdgeId(null);
      },
    });
  }, [launchForProject, mission, setSelectedEdgeId, setSelectedNodeId]);

  const runtimeAgentNodes = useMemo(() => {
    if (!mission) {
      return [];
    }

    return mission.nodes.filter((node) => {
      if (!isMissionAgentNode(node) || !node.paneId || !node.projectId) {
        return false;
      }
      const showOnCanvas = Boolean(node.liveExpanded) || viewportZoom >= 0.85;
      return !showOnCanvas;
    });
  }, [mission, viewportZoom]);

  const handleOpenAgent = useCallback(
    async (nodeId: string) => {
      if (!mission) {
        return;
      }

      const node = mission.nodes.find((entry) => entry.id === nodeId);
      if (!node) {
        return;
      }

      if (isMissionRootNode(node)) {
        setSelectedNodeId(nodeId);
        return;
      }

      if (getMissionNodeKind(node) !== 'agent') {
        setSelectedNodeId(nodeId);
        setConversationOpenKey((current) => current + 1);
        return;
      }

      const project = projects.find((entry) => entry.id === node.projectId);
      if (!project) {
        return;
      }

      const expectedProvider =
        node.aiProvider ?? useAppSettingsStore.getState().preferredAiProvider;
      const expectedCli = preferredAiProviderToCli(expectedProvider);

      let paneId = node.paneId;
      if (paneId) {
        const existingPane = findPaneTab(project.tabs, paneId);
        if (existingPane?.type !== 'agent') {
          paneId = null;
        } else if (resolveAgentTabCli(existingPane) !== expectedCli) {
          paneId = null;
        }
      }

      if (!paneId) {
        const command = await resolveAgentLaunchCommand(project.path, expectedProvider);
        const createdPaneId = await addAgentTabForProject(node.projectId, command);
        if (!createdPaneId) {
          return;
        }
        paneId = createdPaneId;
        await upsertNode(mission.id, { ...node, paneId });

        if (
          Array.isArray(node.transcriptTurns) &&
          node.transcriptTurns.length > 0 &&
          window.nexus
        ) {
          void updateAgentTab(createdPaneId, {
            turns: node.transcriptTurns as import('@/types').AgentTab['turns'],
            followUps:
              (node.transcriptFollowUps as import('@/types').AgentTab['followUps']) ?? [],
          });
        }
      }

      const model = node.model?.trim();
      if (model && model !== 'auto') {
        useTerminalSessionStore.getState().setLastCommand(paneId, `/model ${model}`);
      }

      setSelectedNodeId(nodeId);
      setConversationOpenKey((current) => current + 1);
    },
    [addAgentTabForProject, mission, projects, setSelectedNodeId, updateAgentTab, upsertNode],
  );

  const resolveDefaultProjectId = useCallback((): string | null => {
    if (!mission) {
      return null;
    }

    const rootNode = mission.nodes.find((node) => (node.kind ?? 'agent') === 'mission');
    if (rootNode?.projectId) {
      return rootNode.projectId;
    }

    if (mission.defaultProjectId) {
      return mission.defaultProjectId;
    }

    if (mission.nodes[0]?.projectId) {
      return mission.nodes[0].projectId;
    }

    if (mission.sourcePaneId) {
      for (const project of projects) {
        if (findPaneTab(project.tabs, mission.sourcePaneId)?.type === 'agent') {
          return project.id;
        }
      }
    }

    return projects[0]?.id ?? null;
  }, [mission, projects]);

  const getViewportFlowOrigin = useCallback(
    (chainSpanX: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return { x: 80, y: 160 };
      }

      const center = screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });

      return {
        x: center.x - chainSpanX / 2,
        y: center.y - 48,
      };
    },
    [screenToFlowPosition],
  );

  const handleAutoPropose = useCallback(async () => {
    if (!mission || autoProposeBusy) {
      return;
    }
    setAutoProposeBusy(true);
    const projectId = resolveDefaultProjectId();
    if (!projectId) {
      setAutoProposeBusy(false);
      return;
    }

    const existingNodes = mission.nodes;
    const chainSpanX = 640;
    const origin = getViewportFlowOrigin(chainSpanX);

    const proposed = createSequentialMissionNodes({
      projectId,
      title: mission.title,
      prompt: mission.description || mission.title,
      origin,
    });

    await updateMission(mission.id, {
      nodes: [...existingNodes, ...proposed.nodes],
      edges: [...mission.edges, ...proposed.edges],
    });
    setAutoProposeBusy(false);
  }, [autoProposeBusy, getViewportFlowOrigin, mission, resolveDefaultProjectId, updateMission]);

  const handleApplyFlowTemplate = useCallback(
    async (template: MissionFlowTemplate) => {
      if (!mission || autoProposeBusy) {
        return;
      }

      const projectId = resolveDefaultProjectId();
      if (!projectId) {
        return;
      }

      setAutoProposeBusy(true);
      const origin = getViewportFlowOrigin(640);
      const instantiated = instantiateFlowTemplate({
        template,
        projectId,
        missionPrompt: mission.description || mission.title,
        origin,
      });

      const nodesWithPanes = [];
      for (const node of instantiated.nodes) {
        const kind = getMissionNodeKind(node);
        if (
          kind === 'agent' ||
          kind === 'automation' ||
          kind === 'mission' ||
          kind === 'note' ||
          kind === 'drawing'
        ) {
          nodesWithPanes.push(node);
          continue;
        }

        const paneId = await addTabForProject(projectId, kind);
        nodesWithPanes.push({
          ...node,
          paneId: paneId ?? null,
        });
      }

      await updateMission(mission.id, {
        nodes: [...mission.nodes, ...nodesWithPanes],
        edges: [...mission.edges, ...instantiated.edges],
        drawings: [...(mission.drawings ?? []), ...((template.drawings ?? []).map((drawing) => ({
          ...drawing,
          id: crypto.randomUUID(),
        })))],
      });
      setAutoProposeBusy(false);
    },
    [
      addTabForProject,
      autoProposeBusy,
      getViewportFlowOrigin,
      mission,
      resolveDefaultProjectId,
      updateMission,
    ],
  );

  const handleAutoFlowSelect = useCallback(
    (value: string) => {
      if (!value) {
        return;
      }

      if (value === '__default__') {
        void handleAutoPropose();
        return;
      }

      if (value === '__new__') {
        setEditingFlowTemplate(null);
        setFlowEditorOpen(true);
        return;
      }

      if (value.startsWith('__edit__:')) {
        const templateId = value.slice('__edit__:'.length);
        const template = flowTemplates.find((entry) => entry.id === templateId) ?? null;
        if (template) {
          setEditingFlowTemplate(template);
          setFlowEditorOpen(true);
        }
        return;
      }

      const template = flowTemplates.find((entry) => entry.id === value);
      if (template) {
        void handleApplyFlowTemplate(template);
      }
    },
    [flowTemplates, handleApplyFlowTemplate, handleAutoPropose],
  );

  const autoFlowOptions = useMemo(() => {
    const custom = flowTemplates.map((template) => ({
      value: template.id,
      label: template.name,
      subtitle: `${template.nodes.length} nós`,
      icon: <Workflow size={14} strokeWidth={2.25} aria-hidden='true' />,
    }));

    return [
      {
        value: '__default__',
        label: 'Padrão',
        subtitle: 'Investigador → Engenheiro → QA',
        icon: <Workflow size={14} strokeWidth={2.25} aria-hidden='true' />,
      },
      ...custom,
      {
        value: '__new__',
        label: 'Adicionar novo',
        subtitle: 'Criar fluxo reutilizável',
        icon: <Plus size={14} strokeWidth={2.25} aria-hidden='true' />,
      },
    ];
  }, [flowTemplates]);

  const handleAutoFlowOptionContextMenu = useCallback(
    (value: string, event: ReactMouseEvent<HTMLButtonElement>) => {
      if (value === '__default__' || value === '__new__' || value.startsWith('__edit__:')) {
        return;
      }

      const template = flowTemplates.find((entry) => entry.id === value);
      if (!template) {
        return;
      }

      setFlowTemplateContextMenu({
        templateId: template.id,
        x: event.clientX,
        y: event.clientY,
      });
    },
    [flowTemplates],
  );

  const handleAddAutomationNode = useCallback(
    async (
      entry: MissionAutomationCatalogEntry,
      position?: { x: number; y: number },
    ) => {
      if (!mission) {
        return;
      }

      const projectId = resolveDefaultProjectId();
      if (!projectId) {
        return;
      }

      const origin = position ?? getViewportFlowOrigin(248);
      const stagger = position ? 0 : mission.nodes.length % 4;
      const defaultAction = entry.actions?.[0]?.value ?? entry.action;
      const nextNode = createMissionAutomationNode({
        projectId,
        catalogId: entry.id,
        label: entry.label,
        category: entry.category,
        nodeType: entry.nodeType,
        provider: entry.provider,
        action: defaultAction,
        defaultConfig: {
          ...entry.defaultConfig,
          ...(defaultAction ? { action: defaultAction } : {}),
        },
        position: {
          x: origin.x + stagger * 28,
          y: origin.y + stagger * 22,
        },
      });
      await upsertNode(mission.id, nextNode);
      markMissionNodeJustPlaced(nextNode.id);
      setSelectedNodeId(nextNode.id);
    },
    [
      getViewportFlowOrigin,
      mission,
      resolveDefaultProjectId,
      setSelectedNodeId,
      upsertNode,
    ],
  );

  const handleAddNode = useCallback(
    async (agentTemplateId: string, position?: { x: number; y: number }) => {
      if (!mission) {
        return;
      }

      const projectId = resolveDefaultProjectId();
      if (!projectId) {
        return;
      }

      const template =
        templates.find((entry) => entry.id === agentTemplateId) ??
        getBuiltinTemplateById(agentTemplateId);
      const missionContext = mission.description || mission.title;
      const origin = position ?? getViewportFlowOrigin(248);
      const stagger = position ? 0 : mission.nodes.length % 4;
      const nextNode = createMissionNode({
        agentTemplateId,
        projectId,
        roleId: template?.defaultRoleId ?? 'role-execution',
        name: template?.name,
        objective: resolveAgentTemplateObjective(template, missionContext),
        position: {
          x: origin.x + stagger * 28,
          y: origin.y + stagger * 22,
        },
      });
      await upsertNode(mission.id, nextNode);
      markMissionNodeJustPlaced(nextNode.id);
      setSelectedNodeId(nextNode.id);
    },
    [
      getViewportFlowOrigin,
      mission,
      resolveDefaultProjectId,
      setSelectedNodeId,
      templates,
      upsertNode,
    ],
  );

  const handleAddToolNode = useCallback(
    async (
      kind: Exclude<MissionNodeKind, 'agent' | 'automation' | 'mission' | 'note' | 'drawing'>,
      position?: { x: number; y: number },
    ) => {
      if (!mission) {
        return;
      }

      const projectId = resolveDefaultProjectId();
      if (!projectId) {
        return;
      }

      const paneId = await addTabForProject(projectId, kind);
      if (!paneId) {
        return;
      }

      const origin = position ?? getViewportFlowOrigin(248);
      const stagger = position ? 0 : mission.nodes.length % 4;
      const nextNode = createMissionToolNode({
        kind,
        projectId,
        paneId,
        position: {
          x: origin.x + stagger * 28,
          y: origin.y + stagger * 22,
        },
      });
      await upsertNode(mission.id, nextNode);
      markMissionNodeJustPlaced(nextNode.id);
      setSelectedNodeId(nextNode.id);
      setConversationOpenKey((current) => current + 1);
    },
    [
      addTabForProject,
      getViewportFlowOrigin,
      mission,
      resolveDefaultProjectId,
      setSelectedNodeId,
      upsertNode,
    ],
  );

  const handleAddNoteNode = useCallback(
    async (position?: { x: number; y: number }) => {
      if (!mission) {
        return;
      }

      setDrawingTool(null);
      const projectId = resolveDefaultProjectId() ?? mission.defaultProjectId ?? '';
      const origin = position ?? getViewportFlowOrigin(220);
      const nextNode = createMissionNoteNode({
        projectId,
        position: origin,
      });

      useMissionStore.setState((state) => ({
        missions: state.missions.map((entry) =>
          entry.id === mission.id
            ? { ...entry, nodes: [...entry.nodes, nextNode] }
            : entry,
        ),
        selectedNodeId: nextNode.id,
        selectedNodeIds: [nextNode.id],
        selectedEdgeId: null,
      }));
      markMissionNodeJustPlaced(nextNode.id);
      setSelectedNodeId(nextNode.id);

      const saved = await upsertNode(mission.id, nextNode);
      if (!saved) {
        useMissionStore.setState((state) => ({
          missions: state.missions.map((entry) =>
            entry.id === mission.id
              ? {
                  ...entry,
                  nodes: entry.nodes.filter((node) => node.id !== nextNode.id),
                }
              : entry,
          ),
        }));
        return;
      }

      window.requestAnimationFrame(() => {
        fitView({
          nodes: [{ id: nextNode.id }],
          padding: 0.35,
          duration: 280,
          maxZoom: 1.1,
        });
      });
    },
    [
      fitView,
      getViewportFlowOrigin,
      mission,
      resolveDefaultProjectId,
      setSelectedNodeId,
      upsertNode,
    ],
  );

  const handleLibraryDragOver = useCallback((event: ReactDragEvent) => {
    if (![...event.dataTransfer.types].includes(MISSION_LIBRARY_DRAG_MIME)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleLibraryDrop = useCallback(
    (event: ReactDragEvent) => {
      event.preventDefault();
      const payload = readMissionLibraryDragPayload(event.dataTransfer);
      if (!payload) {
        return;
      }

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      if (payload.source === 'agent') {
        void handleAddNode(payload.templateId, position);
        return;
      }

      if (payload.source === 'tool') {
        if (payload.toolKind === 'note') {
          void handleAddNoteNode(position);
          return;
        }
        void handleAddToolNode(payload.toolKind, position);
        return;
      }

      const entry = getMissionAutomationCatalogEntry(payload.catalogId);
      if (entry) {
        void handleAddAutomationNode(entry, position);
      }
    },
    [handleAddAutomationNode, handleAddNode, handleAddNoteNode, handleAddToolNode, screenToFlowPosition],
  );

  if (!mission) {
    return null;
  }

  const contextNode = nodeContextMenu
    ? (mission.nodes.find((entry) => entry.id === nodeContextMenu.nodeId) ?? null)
    : null;
  const agentCount = countMissionAgentNodes(mission.nodes);
  const hasBusyAgent = mission.nodes.some((node) => {
    if (isMissionRootNode(node) || node.status !== 'running' || !node.paneId) {
      return false;
    }
    const project = projects.find((entry) => entry.id === node.projectId);
    if (!project) {
      return false;
    }
    const pane = findPaneTab(project.tabs, node.paneId);
    if (pane?.type === 'agent' && pane.turns.some((turn) => turn.running)) {
      return true;
    }
    return false;
  });
  const showPause = mission.status === 'running' && hasBusyAgent;
  const canExecute = agentCount > 0 && !showPause;
  const canCancel = mission.status === 'running' || mission.status === 'paused';
  const startLabel =
    mission.status === 'paused' || (mission.status === 'running' && !hasBusyAgent)
      ? 'Continuar'
      : 'Executar';

  return (
    <div className='mission-graph-view'>
      <div className='mission-graph-view__top'>
        <div className='mission-graph-view__top-left'>
          <button
            type='button'
            className='mission-graph-view__icon-btn app-button app-button--enter'
            aria-label='Fechar missão'
            onClick={() => {
              persistViewport();
              onClose();
            }}
          >
            <X size={14} strokeWidth={2.25} aria-hidden='true' />
          </button>
          <div className='mission-graph-view__heading'>
            <h2 className='mission-graph-view__title'>{mission.title}</h2>
            <span className='mission-graph-view__status'>
              {getMissionStatusLabel(mission.status)} · {mission.progress}%
              {(() => {
                const usage = computeMissionTokenUsage(mission.id);
                const maxTokens = mission.budget.maxTokens ?? 0;
                return maxTokens
                  ? ` · ${Math.round(usage.tokens / 1000)}k / ${Math.round(maxTokens / 1000)}k tokens · ${usage.nodeCount} agents`
                  : ` · ${usage.nodeCount} agents`;
              })()}
            </span>
          </div>
        </div>

        <div className='mission-graph-view__top-tools'>
          <button
            type='button'
            className={`mission-graph-view__tool app-button app-button--enter${
              drawingTool === null ? ' mission-graph-view__tool--active' : ''
            }`}
            aria-label='Selecionar com o mouse'
            onClick={() => setDrawingTool(null)}
          >
            <MousePointer2 size={14} strokeWidth={2.25} aria-hidden='true' />
          </button>
          <button
            type='button'
            className={`mission-graph-view__tool app-button app-button--enter${
              drawingTool === 'path' ? ' mission-graph-view__tool--active' : ''
            }`}
            aria-label='Desenhar à mão livre'
            onClick={() => setDrawingTool((current) => (current === 'path' ? null : 'path'))}
          >
            <Pencil size={14} strokeWidth={2.25} aria-hidden='true' />
          </button>
          <button
            type='button'
            className={`mission-graph-view__tool app-button app-button--enter${
              drawingTool === 'arrow' ? ' mission-graph-view__tool--active' : ''
            }`}
            aria-label='Desenhar seta'
            onClick={() => setDrawingTool((current) => (current === 'arrow' ? null : 'arrow'))}
          >
            <MoveRight size={14} strokeWidth={2.25} aria-hidden='true' />
          </button>
          <button
            type='button'
            className={`mission-graph-view__tool app-button app-button--enter${
              drawingTool === 'rect' ? ' mission-graph-view__tool--active' : ''
            }`}
            aria-label='Desenhar retângulo'
            onClick={() => setDrawingTool((current) => (current === 'rect' ? null : 'rect'))}
          >
            <Square size={14} strokeWidth={2.25} aria-hidden='true' />
          </button>
          <button
            type='button'
            className='mission-graph-view__tool app-button app-button--enter'
            onClick={() => {
              void handleAddNoteNode();
            }}
          >
            <Plus size={14} strokeWidth={2.25} aria-hidden='true' />
            <span>Nota</span>
          </button>
          <AnchoredSelect
            value=''
            options={autoFlowOptions}
            onChange={(value) => {
              handleAutoFlowSelect(value);
            }}
            onOptionContextMenu={handleAutoFlowOptionContextMenu}
            placeholder='Auto fluxo'
            leadingIcon={<Workflow size={14} strokeWidth={2.25} aria-hidden='true' />}
            triggerClassName='mission-graph-view__tool mission-graph-view__add-agent'
            menuClassName='mission-graph-view__add-agent-menu'
            align='end'
            disabled={autoProposeBusy}
          />
        </div>

        <div className='mission-graph-view__top-actions'>
          {canCancel ? (
            <button
              type='button'
              className='mission-graph-view__tool app-button app-button--enter'
              onClick={() => {
                void cancelMission(mission.id);
              }}
            >
              <Square size={14} strokeWidth={2.25} aria-hidden='true' />
              <span>Cancelar</span>
            </button>
          ) : null}
          {showPause ? (
            <button
              type='button'
              className='mission-graph-view__tool mission-graph-view__tool--primary app-button app-button--enter'
              onClick={() => {
                void pauseMission(mission.id);
              }}
            >
              <Pause size={14} strokeWidth={2.25} aria-hidden='true' />
              <span>Pausar</span>
            </button>
          ) : (
            <button
              type='button'
              className='mission-graph-view__tool mission-graph-view__tool--nexus-go nexus-go-surface app-button app-button--enter'
              disabled={!canExecute}
              title={agentCount === 0 ? 'Adicione ao menos um agent para executar' : undefined}
              onClick={handleStart}
            >
              <Play size={14} strokeWidth={2.25} aria-hidden='true' />
              <span>{startLabel}</span>
            </button>
          )}
        </div>
      </div>

      {mission.result && (mission.status === 'completed' || mission.status === 'failed') ? (
        <div className='mission-graph-view__result'>
          Missão {mission.status === 'completed' ? 'concluída' : 'falhou'}:{' '}
          {mission.result.editedFileCount} arquivos · {mission.result.projectIds.length} projetos
          {mission.result.responseLead ? ` · ${mission.result.responseLead}` : ''}
        </div>
      ) : null}

      <div className='mission-graph-view__body'>
        <div ref={canvasRef} className='mission-graph-view__canvas'>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            onNodeClick={handleNodeClick}
            onNodeContextMenu={handleNodeContextMenu}
            onEdgeClick={handleEdgeClick}
            onMouseDown={(event: ReactMouseEvent) => {
              if (drawingTool || !event.metaKey) {
                return;
              }
              const target = event.target;
              if (!(target instanceof HTMLElement)) {
                return;
              }
              if (
                target.closest('.react-flow__node') ||
                target.closest('.mission-graph-view__map-dock') ||
                target.closest('.mission-drawing-layer-host')
              ) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              marqueeRef.current?.begin({
                clientX: event.clientX,
                clientY: event.clientY,
                pointerId:
                  'pointerId' in event.nativeEvent
                    ? Number(event.nativeEvent.pointerId)
                    : 1,
              });
            }}
            onPaneClick={handlePaneClick}
            onNodeDrag={(event, node) => {
              if (!(event.metaKey || event.ctrlKey)) {
                if (helperHorizontal || helperVertical || helperSpacings.length > 0) {
                  setHelperHorizontal(null);
                  setHelperVertical(null);
                  setHelperSpacings([]);
                }
                return;
              }

              const alignment = resolveMissionGraphAlignment(
                node,
                nodes,
                8 / Math.max(viewportZoom, 0.2),
              );
              setHelperHorizontal(alignment.horizontal);
              setHelperVertical(alignment.vertical);
              setHelperSpacings(alignment.spacings);

              if (
                alignment.snap.x === node.position.x &&
                alignment.snap.y === node.position.y
              ) {
                return;
              }

              setNodes((current) =>
                current.map((entry) =>
                  entry.id === node.id ? { ...entry, position: alignment.snap } : entry,
                ),
              );
            }}
            onNodeDragStop={handleNodeDragStop}
            onDragOver={handleLibraryDragOver}
            onDrop={handleLibraryDrop}
            onNodeDoubleClick={(_, node) => {
              void handleOpenAgent(node.id);
            }}
            onMoveEnd={persistViewport}
            nodesDraggable={!drawingTool}
            nodesConnectable={!drawingTool}
            elementsSelectable={!drawingTool}
            selectNodesOnDrag={false}
            panOnDrag={!drawingTool && !metaKeyDown}
            panOnScroll={!drawingTool}
            minZoom={0.2}
            maxZoom={1.8}
            defaultEdgeOptions={{ type: 'smoothstep' }}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={1.6}
              color='rgba(186,198,214,0.32)'
            />
            <MissionGraphHelperLines
              horizontal={helperHorizontal}
              vertical={helperVertical}
              spacings={helperSpacings}
            />
            <div className='mission-graph-view__map-dock'>
              <div className='mission-graph-view__map-toolbar'>
                <button
                  type='button'
                  className='mission-graph-view__icon-btn mission-graph-view__map-fit app-button app-button--enter'
                  aria-label='Centralizar'
                  title='Centralizar'
                  onClick={handleFitView}
                >
                  <Scan size={14} strokeWidth={2.25} aria-hidden='true' />
                </button>
                <div className='mission-graph-view__zoom-group'>
                  <button
                    type='button'
                    className='mission-graph-view__icon-btn app-button app-button--enter'
                    aria-label='Diminuir zoom'
                    onClick={handleZoomOut}
                  >
                    <ZoomOut size={14} strokeWidth={2.25} aria-hidden='true' />
                  </button>
                  <span className='mission-graph-view__zoom'>{zoomLabel}%</span>
                  <button
                    type='button'
                    className='mission-graph-view__icon-btn app-button app-button--enter'
                    aria-label='Aumentar zoom'
                    onClick={handleZoomIn}
                  >
                    <ZoomIn size={14} strokeWidth={2.25} aria-hidden='true' />
                  </button>
                </div>
              </div>
              <MiniMap
                pannable
                zoomable
                nodeStrokeWidth={1.5}
                maskColor='rgba(2, 8, 23, 0.52)'
                nodeColor={(node) => {
                  const accent = (node.data as MissionGraphNodeData | undefined)?.accentColor;
                  return accent || '#60a5fa';
                }}
                bgColor='transparent'
              />
            </div>
            <div
              className={`mission-drawing-layer-host${
                drawingTool ? ' mission-drawing-layer-host--active' : ''
              }`}
            >
              <MissionDrawingLayer
                missionId={mission.id}
                tool={drawingTool}
                selectedDrawingIds={selectedDrawingIds}
              />
            </div>
            <MissionMarqueeLayer
              ref={marqueeRef}
              enabled={!drawingTool}
              flowNodes={nodes}
              drawings={mission.drawings ?? []}
              onSelect={({ nodeIds, drawingIds }) => {
                setSelectedNodeIds(nodeIds);
                setSelectedDrawingIds(drawingIds);
              }}
              onMarqueeComplete={() => {
                justMarqueedRef.current = true;
              }}
            />
          </ReactFlow>
          {selectionCount > 0 ? (
            <div className='mission-graph-multiselect-bar overlay-popup--in'>
              <span>
                {selectionCount}{' '}
                {selectionCount === 1 ? 'item selecionado' : 'itens selecionados'}
              </span>
              <button
                type='button'
                className='app-button app-button--enter mission-graph-multiselect-bar__action'
                onClick={() => {
                  requestDeleteSelection(deletableSelectedNodeIds, selectedDrawingIds);
                }}
              >
                <Trash2 size={14} strokeWidth={2.25} aria-hidden='true' />
                Apagar
              </button>
              <button
                type='button'
                className='app-button app-button--enter mission-graph-multiselect-bar__action'
                onClick={clearCanvasSelection}
              >
                <X size={14} strokeWidth={2.25} aria-hidden='true' />
                Limpar
              </button>
            </div>
          ) : null}
          <MissionCompanionOverlay missionId={mission.id} />
        </div>
        <div className='mission-graph-view__agent-host' aria-hidden='true'>
          {runtimeAgentNodes.map((node) => {
            const project = projects.find((entry) => entry.id === node.projectId);
            if (!project || !node.paneId) {
              return null;
            }
            const pane = findPaneTab(project.tabs, node.paneId);
            if (!pane || pane.type !== 'agent') {
              return null;
            }
            return (
              <MissionAgentRuntimeHostItem
                key={node.id}
                node={node}
                projectId={project.id}
                projectPath={node.worktreePath || project.path}
                pane={pane}
                setTabPtyId={setTabPtyId}
                updateAgentTab={updateAgentTab}
              />
            );
          })}
        </div>
        <MissionInspector
          mission={mission}
          conversationOpenKey={conversationOpenKey}
          onOpenAgent={handleOpenAgent}
          agentRuntimeHosted
        />
        {libraryVisible ? (
          <MissionNodeLibrary
            templates={templates}
            onHide={() => setMissionLibraryVisible(false)}
            onAddAgent={(templateId) => {
              void handleAddNode(templateId);
            }}
            onAddTool={(kind) => {
              if (kind === 'note') {
                void handleAddNoteNode();
                return;
              }
              void handleAddToolNode(kind);
            }}
            onAddAutomation={(entry) => {
              void handleAddAutomationNode(entry);
            }}
          />
        ) : (
          <button
            type='button'
            className='mission-node-library-reopen app-button app-button--enter'
            aria-label='Mostrar biblioteca'
            title='Mostrar biblioteca'
            onClick={() => setMissionLibraryVisible(true)}
          >
            <LayoutGrid size={14} strokeWidth={2.25} aria-hidden='true' />
            <span>Biblioteca</span>
          </button>
        )}
      </div>
      {nodeContextMenu && contextNode ? (
        <MissionNodeContextMenu
          x={nodeContextMenu.x}
          y={nodeContextMenu.y}
          isToolNode={isMissionToolNode(contextNode)}
          isMissionRoot={isMissionRootNode(contextNode)}
          hasFlowInstance={Boolean(contextNode.flowInstanceId)}
          onClose={() => setNodeContextMenu(null)}
          onDuplicate={() => {
            void handleDuplicateNode(contextNode.id);
          }}
          onDelete={() => {
            setNodeContextMenu(null);
            requestDeleteNode(contextNode);
          }}
          onDeleteFlow={
            contextNode.flowInstanceId
              ? () => {
                  const flowInstanceId = contextNode.flowInstanceId;
                  if (!flowInstanceId) {
                    return;
                  }
                  setNodeContextMenu(null);
                  setPendingDelete({
                    type: 'flow',
                    flowInstanceId,
                    name: 'Auto fluxo',
                  });
                }
              : undefined
          }
        />
      ) : null}
      {flowTemplateContextMenu ? (
        <MissionFlowTemplateContextMenu
          x={flowTemplateContextMenu.x}
          y={flowTemplateContextMenu.y}
          onClose={() => setFlowTemplateContextMenu(null)}
          onEdit={() => {
            const template =
              flowTemplates.find((entry) => entry.id === flowTemplateContextMenu.templateId) ??
              null;
            setFlowTemplateContextMenu(null);
            if (!template) {
              return;
            }
            setEditingFlowTemplate(template);
            setFlowEditorOpen(true);
          }}
          onDelete={() => {
            const template =
              flowTemplates.find((entry) => entry.id === flowTemplateContextMenu.templateId) ??
              null;
            setFlowTemplateContextMenu(null);
            if (!template) {
              return;
            }
            setPendingDelete({
              type: 'flowTemplate',
              templateId: template.id,
              name: template.name,
            });
          }}
        />
      ) : null}
      {pendingDelete ? (
        pendingDelete.type === 'nodes' || pendingDelete.type === 'selection' ? (
          <AnimatedModal onClose={() => setPendingDelete(null)} panelClassName='project-dialog'>
            {(requestClose) => (
              <>
                <span className='project-dialog__title'>
                  {pendingDelete.type === 'selection'
                    ? 'Apagar seleção'
                    : 'Apagar nós selecionados'}
                </span>
                <p className='project-dialog__message'>
                  Tem certeza que deseja apagar <strong>{pendingDelete.count} itens</strong>?
                  Esta ação não pode ser desfeita.
                </p>
                <div className='project-dialog__actions'>
                  <button
                    type='button'
                    className='project-dialog__btn project-dialog__btn--ghost app-button'
                    onClick={requestClose}
                  >
                    Cancelar
                  </button>
                  <button
                    type='button'
                    className='project-dialog__btn project-dialog__btn--danger app-button app-button--enter'
                    onClick={() => {
                      if (pendingDelete.type === 'selection') {
                        void handleDeleteSelection(
                          pendingDelete.nodeIds,
                          pendingDelete.drawingIds,
                        );
                      } else {
                        void handleDeleteSelectedNodes(pendingDelete.nodeIds);
                      }
                      setPendingDelete(null);
                      requestClose();
                    }}
                  >
                    Apagar
                  </button>
                </div>
              </>
            )}
          </AnimatedModal>
        ) : (
          <MissionDeleteConfirmDialog
            kind={
              pendingDelete.type === 'flow' || pendingDelete.type === 'flowTemplate'
                ? 'flow'
                : pendingDelete.kind
            }
            name={pendingDelete.name}
            onConfirm={() => {
              if (pendingDelete.type === 'flow') {
                void handleDeleteFlowInstance(pendingDelete.flowInstanceId);
              } else if (pendingDelete.type === 'flowTemplate') {
                void removeFlowTemplate(pendingDelete.templateId);
              } else {
                void handleDeleteNode(pendingDelete.nodeId);
              }
              setPendingDelete(null);
            }}
            onClose={() => setPendingDelete(null)}
          />
        )
      ) : null}
      {flowEditorOpen ? (
        <FlowTemplateEditorDialog
          initialTemplate={editingFlowTemplate}
          onClose={() => {
            setFlowEditorOpen(false);
            setEditingFlowTemplate(null);
          }}
          onSaved={() => {
            setFlowEditorOpen(false);
            setEditingFlowTemplate(null);
          }}
        />
      ) : null}
    </div>
  );
}

function MissionGraphViewComponent(props: MissionGraphViewProps) {
  return (
    <section className='mission-graph-shell app-button--enter'>
      <ReactFlowProvider>
        <MissionGraphCanvas {...props} />
      </ReactFlowProvider>
    </section>
  );
}

export const MissionGraphView = memo(MissionGraphViewComponent);

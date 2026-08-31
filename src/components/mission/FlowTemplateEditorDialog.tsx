import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Trash2, Workflow, X } from 'lucide-react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { AppCheckbox } from '@/components/overlay/AppCheckbox';
import { EmptyState } from '@/components/overlay/EmptyState';
import { MissionGraphHelperLines } from '@/components/mission/MissionGraphHelperLines';
import {
  MissionNodeLibrary,
  MISSION_LIBRARY_DRAG_MIME,
  readMissionLibraryDragPayload,
} from '@/components/mission/MissionNodeLibrary';
import { MissionGraphNode, type MissionGraphNodeData } from '@/components/mission/MissionGraphNode';
import { MissionNodeContextMenu } from '@/components/mission/MissionNodeContextMenu';
import { MissionDeleteConfirmDialog } from '@/components/mission/MissionDeleteConfirmDialog';
import type { MissionAutomationCatalogEntry } from '@/constants/missionAutomationCatalog';
import {
  getMissionAutomationCatalogEntry,
  getMissionAutomationCategoryLabel,
} from '@/constants/missionAutomationCatalog';
import { getBuiltinRoleById } from '@/constants/agentRoles';
import { getBuiltinTemplateById, resolveAgentTemplateObjective } from '@/constants/agentTemplates';
import { useMissionStore } from '@/stores/useMissionStore';
import type {
  MissionAgentNode,
  MissionEdge,
  MissionFlowTemplate,
  MissionHandoffPayload,
  MissionNodeKind,
} from '@/types/mission';
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
  duplicateMissionNode,
  getMissionEdgeConditionDescription,
  getMissionEdgeTypeDescription,
  getMissionNodeDisplayName,
  getMissionNodeKind,
  getMissionToolNodeLabel,
  getMissionToolNodeSize,
  isMissionToolNode,
  missionEdgesToFlowTemplateEdges,
  missionNodesToFlowTemplateNodes,
  resolveMissionDeleteNodeTarget,
} from '@/utils/missionHelpers';

const nodeTypes = {
  missionAgent: MissionGraphNode,
};

const TEMPLATE_PROJECT_ID = '__flow-template__';

interface FlowTemplateEditorDialogProps {
  initialTemplate?: MissionFlowTemplate | null;
  onClose: () => void;
  onSaved: (template: MissionFlowTemplate) => void;
}

function FlowTemplateEditorCanvas({
  initialTemplate,
  onClose,
  onSaved,
}: FlowTemplateEditorDialogProps) {
  const getRoles = useMissionStore((state) => state.getRoles);
  const getTemplates = useMissionStore((state) => state.getTemplates);
  const saveFlowTemplate = useMissionStore((state) => state.saveFlowTemplate);
  const removeFlowTemplate = useMissionStore((state) => state.removeFlowTemplate);
  const roles = useMemo(() => getRoles(), [getRoles]);
  const templates = useMemo(() => getTemplates(), [getTemplates]);
  const { fitView, screenToFlowPosition } = useReactFlow();

  const [name, setName] = useState(initialTemplate?.name || 'Novo fluxo');
  const [saving, setSaving] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [draftNodes, setDraftNodes] = useState<MissionAgentNode[]>(() =>
    (initialTemplate?.nodes ?? []).map((node) => {
      const kind = node.kind ?? 'agent';
      const base = {
        ...createMissionNode({
          agentTemplateId: node.agentTemplateId,
          projectId: TEMPLATE_PROJECT_ID,
          roleId: node.roleId,
          name: node.name,
          objective: node.objective,
          kind: node.kind,
          position: node.position,
          paneId: null,
        }),
        id: node.id,
        identity: node.identity,
      };

      if (kind !== 'agent') {
        return {
          ...base,
          size: getMissionToolNodeSize(node),
        };
      }

      return base;
    }),
  );
  const [draftEdges, setDraftEdges] = useState<MissionEdge[]>(() =>
    (initialTemplate?.edges ?? []).map((edge) => ({
      ...createMissionEdge({
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        type: edge.type,
        condition: edge.condition,
        payload: edge.payload,
        label: edge.label,
      }),
      id: edge.id,
    })),
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [helperHorizontal, setHelperHorizontal] = useState<MissionGraphHelperLine | null>(null);
  const [helperVertical, setHelperVertical] = useState<MissionGraphHelperLine | null>(null);
  const [helperSpacings, setHelperSpacings] = useState<MissionGraphSpacingGuide[]>([]);
  const viewportZoom = useStore((state) => state.transform[2] || 1);
  const [contextMenu, setContextMenu] = useState<{
    nodeId: string;
    x: number;
    y: number;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<
    | { type: 'node'; nodeId: string; kind: 'agent' | 'node'; name: string }
    | { type: 'template' }
    | null
  >(null);

  const syncGraph = useCallback(() => {
    setNodes(
      draftNodes.map((node, index) => {
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
          automationCategory: node.automation?.category,
        });
        const fallbackName =
          kind === 'agent'
            ? (template?.name ?? 'Agent')
            : kind === 'automation'
              ? (node.name ?? 'Nó')
              : kind === 'mission'
                ? 'Missão'
                : getMissionToolNodeLabel(kind);
        const data: MissionGraphNodeData = {
          agentName: getMissionNodeDisplayName(node, fallbackName),
          roleName:
            kind === 'automation'
              ? getMissionAutomationCategoryLabel(node.automation?.category ?? 'flow')
              : kind === 'mission'
                ? 'Missão'
                : (role?.name ?? 'Papel'),
          objective: node.objective,
          status: node.status,
          progress: node.progress,
          selected: node.id === selectedNodeId,
          agentIndex: index + 1,
          agentTemplateId: node.agentTemplateId,
          roleId: node.roleId,
          accentColor: visual.accent,
          kind,
          kindLabel:
            kind === 'agent'
              ? 'Agent'
              : kind === 'automation'
                ? 'Nó'
                : kind === 'mission'
                  ? 'Missão'
                  : getMissionToolNodeLabel(kind),
          nodeId: node.id,
          showLivePreview: false,
          automationCategory: node.automation?.category,
          isMissionRoot: kind === 'mission',
          onResizeEnd:
            kind === 'agent' || kind === 'automation' || kind === 'mission'
              ? undefined
              : (size) => {
                  setDraftNodes((current) =>
                    current.map((entry) => (entry.id === node.id ? { ...entry, size } : entry)),
                  );
                },
        };

        const toolSize = isMissionToolNode(node) ? getMissionToolNodeSize(node) : null;

        return {
          id: node.id,
          type: 'missionAgent',
          position: { ...node.position },
          data,
          selected: node.id === selectedNodeId,
          style: toolSize
            ? {
                width: toolSize.width,
                height: toolSize.height,
              }
            : undefined,
        };
      }),
    );

    setEdges(
      draftEdges
        .filter((edge) => {
          const source = draftNodes.find((node) => node.id === edge.sourceNodeId);
          const target = draftNodes.find((node) => node.id === edge.targetNodeId);
          if (!source || !target) {
            return false;
          }
          return !isMissionToolNode(source) && !isMissionToolNode(target);
        })
        .map((edge) => {
          const source = draftNodes.find((node) => node.id === edge.sourceNodeId);
          const accent = getMissionAgentVisual({
            kind: source ? getMissionNodeKind(source) : 'agent',
            agentTemplateId: source?.agentTemplateId,
            roleId: source?.roleId,
          }).accent;
          const dashed = edge.type === 'validation' || edge.type === 'dependency';

          return {
            id: edge.id,
            source: edge.sourceNodeId,
            target: edge.targetNodeId,
            type: 'smoothstep',
            animated: edge.type === 'handoff',
            selected: edge.id === selectedEdgeId,
            label: edge.type,
            selectable: true,
            focusable: true,
            interactionWidth: 36,
            style: {
              stroke: accent,
              strokeWidth: 2.25,
              strokeDasharray: dashed ? '7 5' : undefined,
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
  }, [draftEdges, draftNodes, roles, selectedEdgeId, selectedNodeId, setEdges, setNodes, templates]);

  useEffect(() => {
    syncGraph();
  }, [syncGraph]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void fitView({ padding: 0.28, duration: 180 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitView]);

  const getOrigin = useCallback(() => {
    try {
      return screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
    } catch {
      return { x: 80, y: 80 };
    }
  }, [screenToFlowPosition]);

  const handleAddAgent = useCallback(
    (agentTemplateId: string, position?: { x: number; y: number }) => {
      const template =
        templates.find((entry) => entry.id === agentTemplateId) ??
        getBuiltinTemplateById(agentTemplateId);
      const origin = position ?? getOrigin();
      const stagger = position ? 0 : draftNodes.length % 4;
      const next = createMissionNode({
        agentTemplateId,
        projectId: TEMPLATE_PROJECT_ID,
        roleId: template?.defaultRoleId ?? 'role-execution',
        name: template?.name,
        objective: resolveAgentTemplateObjective(template, '{{mission}}'),
        position: {
          x: origin.x + stagger * 28,
          y: origin.y + stagger * 22,
        },
      });
      setDraftNodes((current) => [...current, next]);
      setSelectedNodeId(next.id);
    },
    [draftNodes.length, getOrigin, templates],
  );

  const handleAddTool = useCallback(
    (
      kind: Exclude<MissionNodeKind, 'agent' | 'automation' | 'mission'>,
      position?: { x: number; y: number },
    ) => {
      const origin = position ?? getOrigin();
      const stagger = position ? 0 : draftNodes.length % 4;
      const next = createMissionToolNode({
        kind,
        projectId: TEMPLATE_PROJECT_ID,
        paneId: null,
        position: {
          x: origin.x + stagger * 28,
          y: origin.y + stagger * 22,
        },
      });
      setDraftNodes((current) => [...current, next]);
      setSelectedNodeId(next.id);
    },
    [draftNodes.length, getOrigin],
  );

  const handleAddAutomation = useCallback(
    (entry: MissionAutomationCatalogEntry, position?: { x: number; y: number }) => {
      const origin = position ?? getOrigin();
      const stagger = position ? 0 : draftNodes.length % 4;
      const defaultAction = entry.actions?.[0]?.value ?? entry.action;
      const next = createMissionAutomationNode({
        projectId: TEMPLATE_PROJECT_ID,
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
      setDraftNodes((current) => [...current, next]);
      setSelectedNodeId(next.id);
    },
    [draftNodes.length, getOrigin],
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
        handleAddAgent(payload.templateId, position);
        return;
      }

      if (payload.source === 'tool') {
        handleAddTool(payload.toolKind, position);
        return;
      }

      const entry = getMissionAutomationCatalogEntry(payload.catalogId);
      if (entry) {
        handleAddAutomation(entry, position);
      }
    },
    [handleAddAgent, handleAddAutomation, handleAddTool, screenToFlowPosition],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }

      const sourceNode = draftNodes.find((entry) => entry.id === connection.source);
      const targetNode = draftNodes.find((entry) => entry.id === connection.target);
      if (
        !sourceNode ||
        !targetNode ||
        isMissionToolNode(sourceNode) ||
        isMissionToolNode(targetNode)
      ) {
        return;
      }

      const edge = createMissionEdge({
        sourceNodeId: connection.source,
        targetNodeId: connection.target,
      });
      const accent = getMissionAgentVisual({
        kind: getMissionNodeKind(sourceNode),
        agentTemplateId: sourceNode.agentTemplateId,
        roleId: sourceNode.roleId,
      }).accent;
      setDraftEdges((current) => [...current, edge]);
      setSelectedNodeId(null);
      setSelectedEdgeId(edge.id);
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: edge.id,
            type: 'smoothstep',
            animated: edge.type === 'handoff',
            selected: true,
            label: edge.type,
            selectable: true,
            focusable: true,
            interactionWidth: 36,
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
            labelBgPadding: [6, 4] as [number, number],
            labelBgBorderRadius: 6,
          },
          current,
        ),
      );
    },
    [draftNodes, setEdges],
  );

  const handleEdgeClick = useCallback((event: ReactMouseEvent, edge: Edge) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);
    setSelectedNodeId(null);
    setSelectedEdgeId(edge.id);
  }, []);

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removedIds = changes
        .filter((change) => change.type === 'remove')
        .map((change) => change.id);

      if (removedIds.length > 0) {
        setDraftEdges((current) =>
          current.filter((edge) => !removedIds.includes(edge.id)),
        );
        setSelectedEdgeId((current) =>
          current && removedIds.includes(current) ? null : current,
        );
      }

      onEdgesChange(changes);

      const selectedChange = changes.find(
        (change) => change.type === 'select' && change.selected,
      );
      if (selectedChange && selectedChange.type === 'select') {
        setContextMenu(null);
        setSelectedNodeId(null);
        setSelectedEdgeId(selectedChange.id);
        return;
      }

      const hasDeselect = changes.some(
        (change) => change.type === 'select' && !change.selected,
      );
      if (hasDeselect) {
        setSelectedEdgeId((current) => {
          if (!current) {
            return null;
          }
          const stillSelected = changes.some(
            (change) =>
              change.type === 'select' && change.id === current && change.selected,
          );
          if (stillSelected) {
            return current;
          }
          const deselectedCurrent = changes.some(
            (change) =>
              change.type === 'select' && change.id === current && !change.selected,
          );
          return deselectedCurrent ? null : current;
        });
      }
    },
    [onEdgesChange],
  );

  const handleDeleteSelectedEdge = useCallback(() => {
    if (!selectedEdgeId) {
      return;
    }
    const edgeId = selectedEdgeId;
    setDraftEdges((current) => current.filter((edge) => edge.id !== edgeId));
    setEdges((current) => current.filter((edge) => edge.id !== edgeId));
    setSelectedEdgeId(null);
  }, [selectedEdgeId, setEdges]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Backspace' && event.key !== 'Delete') {
        return;
      }
      if (pendingDelete || !selectedEdgeId) {
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

      event.preventDefault();
      handleDeleteSelectedEdge();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleDeleteSelectedEdge, pendingDelete, selectedEdgeId]);

  const updateDraftEdge = useCallback((edgeId: string, patch: Partial<MissionEdge>) => {
    setDraftEdges((current) =>
      current.map((entry) => (entry.id === edgeId ? { ...entry, ...patch } : entry)),
    );
  }, []);

  const handlePayloadToggle = useCallback(
    (edgeId: string, key: keyof MissionHandoffPayload, checked: boolean) => {
      setDraftEdges((current) =>
        current.map((entry) => {
          if (entry.id !== edgeId) {
            return entry;
          }
          return {
            ...entry,
            payload: {
              ...entry.payload,
              [key]: checked,
            },
          };
        }),
      );
    },
    [],
  );

  const handleDeleteNode = useCallback((nodeId: string) => {
    setDraftNodes((current) => current.filter((node) => node.id !== nodeId));
    setDraftEdges((current) =>
      current.filter((edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId),
    );
    setSelectedNodeId((current) => (current === nodeId ? null : current));
    setSelectedEdgeId((current) => {
      if (!current) {
        return null;
      }
      const edge = draftEdges.find((entry) => entry.id === current);
      if (!edge) {
        return null;
      }
      if (edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId) {
        return null;
      }
      return current;
    });
    setContextMenu(null);
  }, [draftEdges]);

  const handleDuplicateNode = useCallback((nodeId: string) => {
    setDraftNodes((current) => {
      const source = current.find((node) => node.id === nodeId);
      if (!source) {
        return current;
      }
      const next = duplicateMissionNode(source);
      setSelectedNodeId(next.id);
      return [...current, next];
    });
    setContextMenu(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (saving) {
      return;
    }

    setSaving(true);
    const now = new Date().toISOString();
    const template: MissionFlowTemplate = {
      id: initialTemplate?.id ?? crypto.randomUUID(),
      name: name.trim() || 'Novo fluxo',
      nodes: missionNodesToFlowTemplateNodes(draftNodes),
      edges: missionEdgesToFlowTemplateEdges(
        draftEdges.filter((edge) => {
          const source = draftNodes.find((node) => node.id === edge.sourceNodeId);
          const target = draftNodes.find((node) => node.id === edge.targetNodeId);
          if (!source || !target) {
            return false;
          }
          return !isMissionToolNode(source) && !isMissionToolNode(target);
        }),
      ),
      createdAt: initialTemplate?.createdAt ?? now,
      updatedAt: now,
    };

    const saved = await saveFlowTemplate(template);
    setSaving(false);

    if (saved) {
      onSaved(saved);
    }
  }, [
    draftEdges,
    draftNodes,
    initialTemplate?.createdAt,
    initialTemplate?.id,
    name,
    onSaved,
    saveFlowTemplate,
    saving,
  ]);

  const handleDeleteTemplate = useCallback(async () => {
    if (!initialTemplate?.id) {
      onClose();
      return;
    }

    await removeFlowTemplate(initialTemplate.id);
    onClose();
  }, [initialTemplate?.id, onClose, removeFlowTemplate]);

  const contextNode = contextMenu
    ? (draftNodes.find((node) => node.id === contextMenu.nodeId) ?? null)
    : null;
  const selectedEdge = selectedEdgeId
    ? (draftEdges.find((edge) => edge.id === selectedEdgeId) ?? null)
    : null;
  const selectedEdgeSource = selectedEdge
    ? (draftNodes.find((node) => node.id === selectedEdge.sourceNodeId) ?? null)
    : null;
  const selectedEdgeTarget = selectedEdge
    ? (draftNodes.find((node) => node.id === selectedEdge.targetNodeId) ?? null)
    : null;
  const selectedEdgeSourceTemplate = selectedEdgeSource
    ? (templates.find((entry) => entry.id === selectedEdgeSource.agentTemplateId) ??
      getBuiltinTemplateById(selectedEdgeSource.agentTemplateId))
    : null;
  const selectedEdgeTargetTemplate = selectedEdgeTarget
    ? (templates.find((entry) => entry.id === selectedEdgeTarget.agentTemplateId) ??
      getBuiltinTemplateById(selectedEdgeTarget.agentTemplateId))
    : null;

  return (
    <>
      <div className='mission-flow-template-dialog__toolbar'>
        <div className='mission-flow-template-dialog__title-wrap'>
          <Workflow size={16} strokeWidth={2.25} aria-hidden='true' />
          <input
            className='project-dialog__input mission-flow-template-dialog__name'
            value={name}
            aria-label='Nome do fluxo'
            placeholder='Nome do fluxo'
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className='mission-flow-template-dialog__actions'>
          {initialTemplate ? (
            <button
              type='button'
              className='mission-inspector__delete app-button app-button--enter'
              aria-label='Apagar fluxo'
              title='Apagar fluxo'
              onClick={() => setPendingDelete({ type: 'template' })}
            >
              <Trash2 size={14} strokeWidth={2.25} aria-hidden='true' />
            </button>
          ) : null}
          <button
            type='button'
            className='mission-graph-view__tool app-button app-button--enter'
            onClick={onClose}
          >
            <span>Cancelar</span>
          </button>
          <button
            type='button'
            className='mission-graph-view__tool mission-graph-view__tool--primary app-button app-button--enter'
            disabled={saving || draftNodes.length === 0}
            onClick={() => {
              void handleSave();
            }}
          >
            <span>{saving ? 'Salvando...' : 'Salvar fluxo'}</span>
          </button>
        </div>
      </div>

      <div className='mission-flow-template-dialog__body'>
        <div
          className='mission-flow-template-dialog__canvas'
          onDragOver={handleLibraryDragOver}
          onDrop={handleLibraryDrop}
        >
          {draftNodes.length === 0 ? (
            <EmptyState
              icon={Workflow}
              title='Monte o fluxo'
              message='Use a biblioteca à esquerda. Depois use este fluxo em qualquer missão.'
            />
          ) : null}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onNodeClick={(_, node) => {
              setContextMenu(null);
              setSelectedEdgeId(null);
              setSelectedNodeId(node.id);
            }}
            onNodeContextMenu={(event, node) => {
              event.preventDefault();
              event.stopPropagation();
              setSelectedEdgeId(null);
              setSelectedNodeId(node.id);
              setContextMenu({
                nodeId: node.id,
                x: event.clientX,
                y: event.clientY,
              });
            }}
            onEdgeClick={handleEdgeClick}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
              setContextMenu(null);
            }}
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
            onNodeDragStop={(_event, node) => {
              setHelperHorizontal(null);
              setHelperVertical(null);
              setHelperSpacings([]);
              setDraftNodes((current) =>
                current.map((entry) =>
                  entry.id === node.id ? { ...entry, position: { ...node.position } } : entry,
                ),
              );
            }}
            fitView
            nodesDraggable
            nodesConnectable
            elementsSelectable
            edgesFocusable
            edgesReconnectable={false}
            selectNodesOnDrag={false}
            panOnDrag
            panOnScroll
            minZoom={0.2}
            maxZoom={1.8}
            defaultEdgeOptions={{
              type: 'smoothstep',
              selectable: true,
              focusable: true,
              interactionWidth: 36,
            }}
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
          </ReactFlow>
        </div>
          {selectedEdge ? (
            <aside className='mission-inspector mission-flow-template-dialog__edge-inspector overlay-popup--in app-button--enter'>
              <div className='mission-inspector__header'>
                <div className='mission-inspector__header-top'>
                  <span className='mission-inspector__eyebrow'>Relação</span>
                  <button
                    type='button'
                    className='mission-inspector__close app-button app-button--enter'
                    aria-label='Fechar inspector'
                    onClick={() => setSelectedEdgeId(null)}
                  >
                    <X size={14} strokeWidth={2.25} aria-hidden='true' />
                  </button>
                </div>
                <h3 className='mission-inspector__title'>Ligação</h3>
                <div className='mission-inspector__edge-ends'>
                  <div className='mission-inspector__edge-end'>
                    <span className='mission-inspector__edge-end-label'>Origem</span>
                    <span className='mission-inspector__edge-end-name'>
                      {selectedEdgeSource
                        ? getMissionNodeDisplayName(
                            selectedEdgeSource,
                            selectedEdgeSourceTemplate?.name ?? 'Origem',
                          )
                        : 'Desconhecida'}
                    </span>
                  </div>
                  <span className='mission-inspector__edge-arrow' aria-hidden='true'>
                    →
                  </span>
                  <div className='mission-inspector__edge-end'>
                    <span className='mission-inspector__edge-end-label'>Destino</span>
                    <span className='mission-inspector__edge-end-name'>
                      {selectedEdgeTarget
                        ? getMissionNodeDisplayName(
                            selectedEdgeTarget,
                            selectedEdgeTargetTemplate?.name ?? 'Destino',
                          )
                        : 'Desconhecido'}
                    </span>
                  </div>
                </div>
                <button
                  type='button'
                  className='mission-inspector__delete-edge app-button'
                  onClick={handleDeleteSelectedEdge}
                >
                  <Trash2 size={14} strokeWidth={2.25} aria-hidden='true' />
                  <span>Apagar ligação</span>
                </button>
              </div>
              <div className='mission-inspector__body'>
                <div className='mission-inspector__section'>
                  <label className='mission-inspector__label'>Tipo</label>
                  <AnchoredSelect
                    value={selectedEdge.type}
                    options={[
                      { value: 'handoff', label: 'Handoff' },
                      { value: 'dependency', label: 'Dependência' },
                      { value: 'parallel', label: 'Paralelo' },
                      { value: 'validation', label: 'Validação' },
                      { value: 'trigger', label: 'Trigger' },
                      { value: 'shared_discovery', label: 'Descoberta compartilhada' },
                    ]}
                    onChange={(value) => {
                      updateDraftEdge(selectedEdge.id, {
                        type: value as MissionEdge['type'],
                      });
                    }}
                  />
                  <p className='mission-inspector__hint'>
                    {getMissionEdgeTypeDescription(selectedEdge.type)}
                  </p>
                </div>
                <div className='mission-inspector__section'>
                  <label className='mission-inspector__label'>Condição</label>
                  <AnchoredSelect
                    value={selectedEdge.condition}
                    options={[
                      { value: 'on_success', label: 'Após sucesso' },
                      { value: 'on_completion', label: 'Após conclusão' },
                      { value: 'on_failure', label: 'Após falha' },
                      { value: 'always', label: 'Sempre' },
                      { value: 'after_approval', label: 'Após aprovação' },
                    ]}
                    onChange={(value) => {
                      updateDraftEdge(selectedEdge.id, {
                        condition: value as MissionEdge['condition'],
                      });
                    }}
                  />
                  <p className='mission-inspector__hint'>
                    {getMissionEdgeConditionDescription(selectedEdge.condition)}
                  </p>
                </div>
                <div className='mission-inspector__section'>
                  <label className='mission-inspector__label'>Compartilha</label>
                  {(
                    [
                      ['summary', 'Resumo'],
                      ['discoveries', 'Descobertas'],
                      ['changedFiles', 'Arquivos alterados'],
                      ['diff', 'Diff'],
                      ['commands', 'Comandos'],
                      ['testResults', 'Testes'],
                      ['conversation', 'Conversa'],
                    ] as Array<[keyof MissionHandoffPayload, string]>
                  ).map(([key, label]) => (
                    <label key={key} className='mission-inspector__check-row'>
                      <AppCheckbox
                        checked={Boolean(selectedEdge.payload[key])}
                        onChange={(checked) => {
                          handlePayloadToggle(selectedEdge.id, key, checked);
                        }}
                        aria-label={label}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </aside>
          ) : null}
        <MissionNodeLibrary
          templates={templates}
          onAddAgent={handleAddAgent}
          onAddTool={handleAddTool}
          onAddAutomation={handleAddAutomation}
        />
      </div>

      {contextMenu && contextNode ? (
        <MissionNodeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          isToolNode={isMissionToolNode(contextNode)}
          onClose={() => setContextMenu(null)}
          onDuplicate={() => handleDuplicateNode(contextNode.id)}
          onDelete={() => {
            const template =
              templates.find((entry) => entry.id === contextNode.agentTemplateId) ??
              getBuiltinTemplateById(contextNode.agentTemplateId);
            const target = resolveMissionDeleteNodeTarget(contextNode, template?.name ?? 'Agent');
            setContextMenu(null);
            setPendingDelete({
              type: 'node',
              nodeId: contextNode.id,
              kind: target.kind,
              name: target.name,
            });
          }}
        />
      ) : null}
      {pendingDelete ? (
        <MissionDeleteConfirmDialog
          kind={pendingDelete.type === 'template' ? 'flow' : pendingDelete.kind}
          name={
            pendingDelete.type === 'template' ? name.trim() || 'Novo fluxo' : pendingDelete.name
          }
          onConfirm={() => {
            if (pendingDelete.type === 'template') {
              void handleDeleteTemplate();
            } else {
              handleDeleteNode(pendingDelete.nodeId);
            }
            setPendingDelete(null);
          }}
          onClose={() => setPendingDelete(null)}
        />
      ) : null}
    </>
  );
}

function FlowTemplateEditorDialogComponent(props: FlowTemplateEditorDialogProps) {
  return (
    <AnimatedModal
      panelClassName='project-dialog mission-flow-template-dialog'
      onClose={props.onClose}
    >
      {() => (
        <ReactFlowProvider>
          <FlowTemplateEditorCanvas {...props} />
        </ReactFlowProvider>
      )}
    </AnimatedModal>
  );
}

export const FlowTemplateEditorDialog = memo(FlowTemplateEditorDialogComponent);

import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
} from 'react';
import {
  Check,
  Circle,
  FileCode2,
  FileIcon,
  Flag,
  FlaskConical,
  GitBranch,
  ListChecks,
  LoaderCircle,
  MessageSquare,
  Network,
  Paperclip,
  Target,
  Terminal,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AgentExecutionStepStatus,
  Mission,
  MissionAutomationConfig,
  MissionEdge,
  MissionHandoffPayload,
  MissionQaEvidence,
} from '@/types/mission';
import type {
  AgentFollowUp,
  AgentTab,
  AgentTurnSummaryCommandRef,
  AgentTurnSummaryFileRef,
} from '@/types';
import { AppCheckbox } from '@/components/overlay/AppCheckbox';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { EmptyState } from '@/components/overlay/EmptyState';
import { MissionAutomationConfigForm } from '@/components/mission/MissionAutomationConfigForm';
import { MissionDeleteConfirmDialog } from '@/components/mission/MissionDeleteConfirmDialog';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import { getBuiltinRoleById } from '@/constants/agentRoles';
import { getBuiltinTemplateById } from '@/constants/agentTemplates';
import {
  ASK_AI_PROVIDER_OPTIONS,
  DEFAULT_AI_PROVIDER,
  type AiProviderId,
} from '@/constants/aiProviders';
import { getMissionAutomationCategoryLabel } from '@/constants/missionAutomationCatalog';
import { useAppSettingsStore } from '@/stores/useAppSettingsStore';
import { useMissionStore } from '@/stores/useMissionStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTabActions } from '@/stores/useTabStore';
import {
  createMissionEdge,
  getMissionEdgeConditionDescription,
  getMissionEdgeTypeDescription,
  getMissionNodeDisplayName,
  getMissionNodeKind,
  getMissionNodeStatusLabel,
  getMissionToolNodeLabel,
  isMissionAutomationNode,
  isMissionRootNode,
  isMissionToolNode,
  canDeleteMissionNodeWithoutConfirm,
  clearMissionNodePlacementGrace,
  resolveMissionDeleteNodeTarget,
} from '@/utils/missionHelpers';
import { findPaneTab } from '@/utils/tabGroups';
import { getMissionAgentVisual } from '@/utils/missionAgentVisuals';
import { getAgentPaneLiveTranscript } from '@/utils/agentPaneRegistry';
import {
  captureGitSnapshot,
  diffGitSnapshots,
  diffGitSnapshotsLoose,
  resolveRepoPathForAgentTurn,
} from '@/utils/agentGitDiff';
import {
  selectAgentGitGroupsForProject,
  useAgentGitChangeStore,
} from '@/stores/useAgentGitChangeStore';
import { buildEditedFilesFromActivities } from '@/utils/agentTurnSummary';
import {
  collectMissionQaEvidences,
  enrichMissionQaEvidencesWithFolders,
  isMissionQaNode,
} from '@/utils/missionQaEvidence';
import { blobToDataUrl } from '@/utils/terminalClipboardImage';

const LazyAgentView = lazy(() =>
  import('@/components/agent/AgentView').then((module) => ({
    default: module.AgentView,
  })),
);

type InspectorTabId =
  'overview' | 'identity' | 'conversation' | 'changes' | 'terminal' | 'context' | 'evidence';

interface MissionInspectorProps {
  mission: Mission;
  onOpenAgent: (nodeId: string) => Promise<void> | void;
  conversationOpenKey?: number;
  agentRuntimeHosted?: boolean;
}

interface MissionProjectThumbProps {
  logo?: string | null;
  icon: string;
  color: string;
}

function MissionProjectThumbComponent({ logo, icon, color }: MissionProjectThumbProps) {
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setLogoSrc(null);
    setLogoFailed(false);

    if (!logo || !window.nexus) {
      return;
    }

    void window.nexus.files.readImageAsDataUrl(logo).then((dataUrl) => {
      if (cancelled) {
        return;
      }

      if (dataUrl) {
        setLogoSrc(dataUrl);
        return;
      }

      setLogoFailed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [logo]);

  const handleLogoError = useCallback(() => {
    setLogoFailed(true);
    setLogoSrc(null);
  }, []);

  if (logoSrc && !logoFailed) {
    return (
      <img
        key={logo}
        src={logoSrc}
        alt=''
        className='mission-inspector__project-logo'
        onError={handleLogoError}
      />
    );
  }

  return (
    <span className='mission-inspector__project-icon' style={{ background: color }}>
      <ProjectIconMark icon={icon} size={12} />
    </span>
  );
}

const MissionProjectThumb = memo(MissionProjectThumbComponent);

function MissionEvidenceThumbComponent({
  path,
  kind,
  name,
}: {
  path: string;
  kind: 'image' | 'file';
  name: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (kind !== 'image' || !window.nexus?.files?.readImageAsDataUrl) {
      setSrc(null);
      return;
    }

    void window.nexus.files.readImageAsDataUrl(path).then((dataUrl) => {
      if (cancelled || !dataUrl) {
        return;
      }
      setSrc(dataUrl);
    });

    return () => {
      cancelled = true;
    };
  }, [kind, path]);

  if (src) {
    return <img src={src} alt={name} className='mission-inspector__attachment-thumb' />;
  }

  return <FileIcon size={14} strokeWidth={2} aria-hidden='true' />;
}

const MissionEvidenceThumb = memo(MissionEvidenceThumbComponent);

function MissionQaMediaPreviewComponent({
  path,
  kind,
  title,
}: {
  path: string;
  kind: 'image' | 'video';
  title: string;
}) {
  const localUrl = window.nexus?.files?.toLocalUrl?.(path) || null;
  const [src, setSrc] = useState<string | null>(localUrl);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setSrc(window.nexus?.files?.toLocalUrl?.(path) || null);

    if (kind !== 'image' || !window.nexus?.files?.readImageAsDataUrl) {
      return;
    }

    void window.nexus.files.readImageAsDataUrl(path).then((dataUrl) => {
      if (cancelled || !dataUrl) {
        return;
      }
      setSrc(dataUrl);
    });

    return () => {
      cancelled = true;
    };
  }, [kind, path]);

  if (failed || !src) {
    return (
      <div className='mission-inspector__evidence-media-fallback'>
        <FileIcon size={16} strokeWidth={2} aria-hidden='true' />
        <span>{title}</span>
      </div>
    );
  }

  if (kind === 'video') {
    return (
      <video
        className='mission-inspector__evidence-video'
        src={src}
        controls
        preload='metadata'
        onError={() => setFailed(true)}
      >
        <track kind='captions' />
      </video>
    );
  }

  return (
    <img
      src={src}
      alt={title}
      className='mission-inspector__evidence-image'
      onError={() => {
        if (src.startsWith('data:')) {
          setFailed(true);
          return;
        }
        const fallback = window.nexus?.files?.toLocalUrl?.(path) || null;
        if (fallback && fallback !== src) {
          setSrc(fallback);
          return;
        }
        setFailed(true);
      }}
    />
  );
}

const MissionQaMediaPreview = memo(MissionQaMediaPreviewComponent);

function getChecklistStepMeta(status: AgentExecutionStepStatus): {
  label: string;
  Icon: typeof Check;
} {
  switch (status) {
    case 'completed':
      return { label: 'Concluído', Icon: Check };
    case 'running':
      return { label: 'Em andamento', Icon: LoaderCircle };
    case 'failed':
      return { label: 'Falhou', Icon: XCircle };
    default:
      return { label: 'Pendente', Icon: Circle };
  }
}

function MissionInspectorComponent({
  mission,
  onOpenAgent,
  conversationOpenKey = 0,
  agentRuntimeHosted = false,
}: MissionInspectorProps) {
  const selectedNodeId = useMissionStore((state) => state.selectedNodeId);
  const selectedEdgeId = useMissionStore((state) => state.selectedEdgeId);
  const setSelectedNodeId = useMissionStore((state) => state.setSelectedNodeId);
  const setSelectedEdgeId = useMissionStore((state) => state.setSelectedEdgeId);
  const upsertEdge = useMissionStore((state) => state.upsertEdge);
  const removeEdge = useMissionStore((state) => state.removeEdge);
  const upsertNode = useMissionStore((state) => state.upsertNode);
  const removeNode = useMissionStore((state) => state.removeNode);
  const updateMission = useMissionStore((state) => state.updateMission);
  const getRoles = useMissionStore((state) => state.getRoles);
  const getTemplates = useMissionStore((state) => state.getTemplates);
  const projects = useProjectStore((state) => state.projects);
  const setTabPtyId = useProjectStore((state) => state.setTabPtyId);
  const { updateAgentTab } = useTabActions();
  const preferredAiProvider = useAppSettingsStore((state) => state.preferredAiProvider);
  const [tab, setTab] = useState<InspectorTabId>('overview');
  const [nameDraft, setNameDraft] = useState('');
  const [objectiveDraft, setObjectiveDraft] = useState('');
  const [identityDraft, setIdentityDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [missionObjectiveDraft, setMissionObjectiveDraft] = useState('');
  const [projectIdDraft, setProjectIdDraft] = useState('');
  const [aiProviderDraft, setAiProviderDraft] =
    useState<Exclude<AiProviderId, 'nexus'>>(DEFAULT_AI_PROVIDER);
  const [modelDraft, setModelDraft] = useState('');
  const [templateIdDraft, setTemplateIdDraft] = useState('');
  const [roleIdDraft, setRoleIdDraft] = useState('');
  const [incomingDraft, setIncomingDraft] = useState('');
  const [outgoingDraft, setOutgoingDraft] = useState('');
  const [agentLive, setAgentLive] = useState(false);
  const [openingAgent, setOpeningAgent] = useState(false);
  const [savingAgent, setSavingAgent] = useState(false);
  const [savingMissionRoot, setSavingMissionRoot] = useState(false);
  const [attachingMission, setAttachingMission] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [liveConversationTurns, setLiveConversationTurns] = useState<AgentTab['turns'] | null>(
    null,
  );
  const [liveConversationFollowUps, setLiveConversationFollowUps] = useState<
    AgentFollowUp[] | null
  >(null);
  const [gitChangedFiles, setGitChangedFiles] = useState<AgentTurnSummaryFileRef[]>([]);
  const [qaEvidences, setQaEvidences] = useState<MissionQaEvidence[]>([]);
  const [agentModelOptions, setAgentModelOptions] = useState<Array<{ id: string; label: string }>>(
    [],
  );
  const lastConversationOpenKey = useRef(0);

  const roles = useMemo(() => getRoles(), [getRoles]);
  const templates = useMemo(() => getTemplates(), [getTemplates]);

  const selectedNode = mission.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge = mission.edges.find((edge) => edge.id === selectedEdgeId) ?? null;

  const draftProjectId = selectedNode ? projectIdDraft || selectedNode.projectId : '';
  const project = draftProjectId ? projects.find((entry) => entry.id === draftProjectId) : null;
  const pane =
    selectedNode?.paneId && selectedNode.projectId === draftProjectId && project
      ? findPaneTab(project.tabs, selectedNode.paneId)
      : selectedNode?.paneId && project
        ? findPaneTab(project.tabs, selectedNode.paneId)
        : null;

  const draftTemplateId = selectedNode ? templateIdDraft || selectedNode.agentTemplateId : '';
  const draftRoleId = selectedNode ? roleIdDraft || selectedNode.roleId : '';

  const template = draftTemplateId
    ? (templates.find((entry) => entry.id === draftTemplateId) ??
      getBuiltinTemplateById(draftTemplateId))
    : null;
  const role = draftRoleId
    ? (roles.find((entry) => entry.id === draftRoleId) ?? getBuiltinRoleById(draftRoleId))
    : null;

  useEffect(() => {
    if (!selectedNode) {
      setNameDraft('');
      setObjectiveDraft('');
      setIdentityDraft('');
      setDescriptionDraft('');
      setMissionObjectiveDraft('');
      setProjectIdDraft('');
      setAiProviderDraft(DEFAULT_AI_PROVIDER);
      setModelDraft('');
      setTemplateIdDraft('');
      setRoleIdDraft('');
      setIncomingDraft('');
      setOutgoingDraft('');
      return;
    }

    if (isMissionRootNode(selectedNode)) {
      setNameDraft(mission.title);
      setDescriptionDraft(mission.description ?? '');
      setMissionObjectiveDraft(mission.objective ?? '');
      setObjectiveDraft(mission.objective ?? '');
      setIdentityDraft('');
      return;
    }

    const nodeTemplate =
      templates.find((entry) => entry.id === selectedNode.agentTemplateId) ??
      getBuiltinTemplateById(selectedNode.agentTemplateId);

    setNameDraft(getMissionNodeDisplayName(selectedNode, nodeTemplate?.name ?? 'Agent'));
    setObjectiveDraft(selectedNode.objective);
    setIdentityDraft(selectedNode.identity?.trim() || nodeTemplate?.instructions || '');
    setProjectIdDraft(selectedNode.projectId);
    setAiProviderDraft(selectedNode.aiProvider ?? preferredAiProvider ?? DEFAULT_AI_PROVIDER);
    setModelDraft(selectedNode.model ?? '');
    setTemplateIdDraft(selectedNode.agentTemplateId);
    setRoleIdDraft(selectedNode.roleId);
    setIncomingDraft(
      mission.edges.find((edge) => edge.targetNodeId === selectedNode.id)?.sourceNodeId ?? '',
    );
    setOutgoingDraft(
      mission.edges.find((edge) => edge.sourceNodeId === selectedNode.id)?.targetNodeId ?? '',
    );
  }, [
    mission.description,
    mission.edges,
    mission.objective,
    mission.title,
    preferredAiProvider,
    selectedNode?.id,
    selectedNode?.name,
    selectedNode?.objective,
    selectedNode?.identity,
    selectedNode?.agentTemplateId,
    selectedNode?.roleId,
    selectedNode?.projectId,
    selectedNode?.aiProvider,
    selectedNode?.model,
    selectedNode?.kind,
    templates,
  ]);

  useEffect(() => {
    setTab('overview');
    const node = mission.nodes.find((entry) => entry.id === selectedNodeId) ?? null;
    setAgentLive(Boolean(node && isMissionToolNode(node)));
  }, [selectedNodeId]);

  useEffect(() => {
    setDeleteConfirmOpen(false);
  }, [selectedNodeId, selectedEdgeId]);

  useEffect(() => {
    if (conversationOpenKey <= 0 || conversationOpenKey === lastConversationOpenKey.current) {
      return;
    }
    lastConversationOpenKey.current = conversationOpenKey;
    setTab('conversation');
    setAgentLive(true);
  }, [conversationOpenKey]);

  useEffect(() => {
    if (tab === 'conversation' && pane?.type === 'agent') {
      setAgentLive(true);
    }
  }, [pane?.type, tab]);

  useEffect(() => {
    const shouldMirrorLive =
      agentRuntimeHosted &&
      Boolean(selectedNode?.paneId) &&
      (tab === 'conversation' || tab === 'changes' || tab === 'terminal' || tab === 'evidence');

    if (!shouldMirrorLive || !selectedNode?.paneId) {
      setLiveConversationTurns(null);
      setLiveConversationFollowUps(null);
      return;
    }

    const paneId = selectedNode.paneId;
    const syncLive = () => {
      const live = getAgentPaneLiveTranscript(paneId);
      if (!live) {
        return;
      }
      setLiveConversationTurns(live.turns);
      setLiveConversationFollowUps(live.followUps);
    };

    syncLive();
    const intervalId = window.setInterval(syncLive, 400);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [agentRuntimeHosted, selectedNode?.paneId, tab]);

  useEffect(() => {
    if (!selectedNode || !isMissionQaNode(selectedNode)) {
      if (tab === 'evidence') {
        setTab('overview');
      }
      setQaEvidences([]);
      return;
    }

    if (tab !== 'evidence') {
      return;
    }

    let cancelled = false;
    const rootPath = selectedNode.worktreePath || project?.path || '';
    const turns =
      liveConversationTurns ??
      (pane?.type === 'agent' ? pane.turns : undefined) ??
      (Array.isArray(selectedNode.transcriptTurns)
        ? (selectedNode.transcriptTurns as AgentTab['turns'])
        : undefined) ??
      [];

    const syncEvidences = async () => {
      const base = collectMissionQaEvidences({
        mission,
        node: selectedNode,
        turns,
        projectPath: rootPath,
      });
      const enriched = await enrichMissionQaEvidencesWithFolders(base, rootPath);
      if (!cancelled) {
        setQaEvidences(enriched);
      }
    };

    void syncEvidences();
    const shouldPoll =
      selectedNode.status === 'running' ||
      mission.status === 'running' ||
      mission.status === 'paused';
    const intervalId = shouldPoll ? window.setInterval(() => void syncEvidences(), 1500) : null;

    return () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [liveConversationTurns, mission, pane, project?.path, selectedNode, tab]);

  useEffect(() => {
    if (tab !== 'changes' || !selectedNode || !project) {
      setGitChangedFiles([]);
      return;
    }

    let cancelled = false;
    const rootPath = selectedNode.worktreePath || project.path;
    const paneId = selectedNode.paneId;
    const projectId = project.id;
    const preferLiveGit =
      selectedNode.status === 'running' ||
      selectedNode.status === 'waiting' ||
      mission.status === 'running' ||
      mission.status === 'paused';

    const syncGitChanges = async () => {
      const filesByPath = new Map<string, AgentTurnSummaryFileRef>();
      const pushFile = (file: AgentTurnSummaryFileRef) => {
        const key = file.path.toLowerCase();
        if (!key || filesByPath.has(key)) {
          return;
        }
        filesByPath.set(key, { ...file });
      };

      for (const group of selectAgentGitGroupsForProject(
        useAgentGitChangeStore.getState(),
        projectId,
      )) {
        if (paneId && group.paneId !== paneId) {
          continue;
        }
        for (const file of group.files) {
          pushFile({
            path: file.path,
            ...(file.additions > 0 ? { additions: file.additions } : {}),
            ...(file.deletions > 0 ? { deletions: file.deletions } : {}),
          });
        }
      }

      if (window.nexus?.git) {
        try {
          const repoPath =
            (await resolveRepoPathForAgentTurn(rootPath, paneId)) ??
            (selectedNode.worktreePath ? rootPath : null);
          if (repoPath) {
            const pending =
              paneId != null
                ? useAgentGitChangeStore.getState().pendingTurnByPane[paneId]
                : undefined;
            const afterSnapshot =
              preferLiveGit || (pending?.repoPath === repoPath && pending.snapshot)
                ? await captureGitSnapshot(repoPath)
                : null;

            if (afterSnapshot) {
              const beforeSnapshot =
                pending?.repoPath === repoPath && pending.snapshot ? pending.snapshot : null;
              const delta = beforeSnapshot
                ? (() => {
                    const strict = diffGitSnapshots(beforeSnapshot, afterSnapshot);
                    if (strict.fileCount > 0) {
                      return strict.files;
                    }
                    return diffGitSnapshotsLoose(beforeSnapshot, afterSnapshot).files;
                  })()
                : preferLiveGit
                  ? afterSnapshot
                  : [];

              for (const change of delta) {
                pushFile({
                  path: change.path,
                  ...(change.additions > 0 ? { additions: change.additions } : {}),
                  ...(change.deletions > 0 ? { deletions: change.deletions } : {}),
                });
              }
            }
          }
        } catch {
          // keep previously merged group files
        }
      }

      if (!cancelled) {
        setGitChangedFiles([...filesByPath.values()]);
      }
    };

    void syncGitChanges();
    const intervalId = preferLiveGit ? window.setInterval(() => void syncGitChanges(), 1500) : null;

    return () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [
    mission.status,
    project,
    selectedNode,
    selectedNode?.paneId,
    selectedNode?.status,
    selectedNode?.worktreePath,
    tab,
  ]);

  const incoming = selectedNode
    ? mission.edges.filter((edge) => {
        if (edge.targetNodeId !== selectedNode.id) {
          return false;
        }
        const source = mission.nodes.find((node) => node.id === edge.sourceNodeId);
        return source != null && !isMissionToolNode(source);
      })
    : [];
  const outgoing = selectedNode
    ? mission.edges.filter((edge) => {
        if (edge.sourceNodeId !== selectedNode.id) {
          return false;
        }
        const target = mission.nodes.find((node) => node.id === edge.targetNodeId);
        return target != null && !isMissionToolNode(target);
      })
    : [];

  const handleOpenAgentClick = useCallback(async () => {
    if (!selectedNode || openingAgent) {
      return;
    }
    setOpeningAgent(true);
    try {
      await onOpenAgent(selectedNode.id);
      setTab('conversation');
      setAgentLive(true);
    } finally {
      setOpeningAgent(false);
    }
  }, [onOpenAgent, openingAgent, selectedNode]);

  const handleDeleteNode = useCallback(async () => {
    if (!selectedNode || isMissionRootNode(selectedNode)) {
      return;
    }

    const nodeId = selectedNode.id;
    await removeNode(mission.id, nodeId);
    clearMissionNodePlacementGrace(nodeId);
    setDeleteConfirmOpen(false);
    setSelectedNodeId(null);
  }, [mission.id, removeNode, selectedNode, setSelectedNodeId]);

  const requestDeleteSelectedNode = useCallback(() => {
    if (!selectedNode || isMissionRootNode(selectedNode)) {
      return;
    }
    if (canDeleteMissionNodeWithoutConfirm(selectedNode.id)) {
      void handleDeleteNode();
      return;
    }
    setDeleteConfirmOpen(true);
  }, [handleDeleteNode, selectedNode]);

  const persistMissionRootFields = useCallback(async () => {
    if (!selectedNode || !isMissionRootNode(selectedNode)) {
      return;
    }

    const nextTitle = nameDraft.trim() || 'Nova missão';
    const nextDescription = descriptionDraft.trim() || undefined;
    const nextObjective = missionObjectiveDraft.trim() || undefined;

    const missionChanged =
      nextTitle !== mission.title ||
      (nextDescription ?? '') !== (mission.description ?? '') ||
      (nextObjective ?? '') !== (mission.objective ?? '');

    if (missionChanged) {
      await updateMission(mission.id, {
        title: nextTitle,
        description: nextDescription,
        objective: nextObjective,
      });
    }

    const nodeName = nextTitle;
    const nodeObjective = nextObjective || nextTitle;
    if (selectedNode.name !== nodeName || selectedNode.objective !== nodeObjective) {
      await upsertNode(mission.id, {
        ...selectedNode,
        name: nodeName,
        objective: nodeObjective,
      });
    }
  }, [
    descriptionDraft,
    mission.description,
    mission.id,
    mission.objective,
    mission.title,
    missionObjectiveDraft,
    nameDraft,
    selectedNode,
    updateMission,
    upsertNode,
  ]);

  const isMissionRootDirty = useMemo(() => {
    if (!selectedNode || !isMissionRootNode(selectedNode)) {
      return false;
    }

    const nextTitle = nameDraft.trim() || 'Nova missão';
    const nextDescription = descriptionDraft.trim();
    const nextObjective = missionObjectiveDraft.trim();

    return (
      nextTitle !== mission.title ||
      nextDescription !== (mission.description ?? '') ||
      nextObjective !== (mission.objective ?? '')
    );
  }, [
    descriptionDraft,
    mission.description,
    mission.objective,
    mission.title,
    missionObjectiveDraft,
    nameDraft,
    selectedNode,
  ]);

  const handleSaveMissionRoot = useCallback(async () => {
    if (!isMissionRootDirty || savingMissionRoot) {
      return;
    }

    setSavingMissionRoot(true);
    try {
      await persistMissionRootFields();
    } finally {
      setSavingMissionRoot(false);
    }
  }, [isMissionRootDirty, persistMissionRootFields, savingMissionRoot]);

  const missionAttachments = mission.attachments ?? [];

  const handleAddMissionAttachments = useCallback(async () => {
    if (
      attachingMission ||
      !window.nexus?.dialog?.openFiles ||
      !window.nexus.missions?.saveAttachment
    ) {
      return;
    }

    const paths = await window.nexus.dialog.openFiles();
    if (!paths || paths.length === 0) {
      return;
    }

    setAttachingMission(true);
    try {
      const existingPaths = new Set(missionAttachments.map((item) => item.path));

      for (const sourcePath of paths) {
        if (existingPaths.has(sourcePath)) {
          continue;
        }
        const attachment = await window.nexus.missions.saveAttachment(mission.id, sourcePath);
        if (attachment) {
          existingPaths.add(attachment.path);
        }
      }
    } finally {
      setAttachingMission(false);
    }
  }, [attachingMission, mission.id, missionAttachments]);

  const handleRemoveMissionAttachment = useCallback(
    async (attachmentId: string) => {
      const next = missionAttachments.filter((item) => item.id !== attachmentId);
      await updateMission(mission.id, { attachments: next });
    },
    [mission.id, missionAttachments, updateMission],
  );

  const handleRevealMissionAttachment = useCallback((attachmentPath: string) => {
    void window.nexus?.files?.revealInFolder(attachmentPath);
  }, []);

  const handlePasteMissionImages = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      const items = event.clipboardData?.items;
      if (
        !items ||
        attachingMission ||
        !window.nexus?.missions?.savePendingAttachmentFromDataUrl ||
        !window.nexus.missions?.saveAttachment
      ) {
        return;
      }

      const imageFiles: File[] = [];
      for (const item of items) {
        if (!item.type.startsWith('image/')) {
          continue;
        }
        const file = item.getAsFile();
        if (file) {
          imageFiles.push(file);
        }
      }

      if (imageFiles.length === 0) {
        return;
      }

      event.preventDefault();

      void (async () => {
        setAttachingMission(true);
        try {
          const existingPaths = new Set(missionAttachments.map((item) => item.path));

          for (const file of imageFiles) {
            try {
              const dataUrl = await blobToDataUrl(file);
              const pending = await window.nexus.missions.savePendingAttachmentFromDataUrl(
                dataUrl,
                file.name || undefined,
              );
              if (!pending || existingPaths.has(pending.sourcePath)) {
                continue;
              }
              const attachment = await window.nexus.missions.saveAttachment(
                mission.id,
                pending.sourcePath,
              );
              if (attachment) {
                existingPaths.add(attachment.path);
              }
            } catch {
              continue;
            }
          }
        } finally {
          setAttachingMission(false);
        }
      })();
    },
    [attachingMission, mission.id, missionAttachments],
  );

  const deleteTarget = selectedNode
    ? resolveMissionDeleteNodeTarget(selectedNode, template?.name ?? 'Agent')
    : null;

  const deleteConfirmDialog =
    deleteConfirmOpen && selectedNode && deleteTarget ? (
      <MissionDeleteConfirmDialog
        kind={deleteTarget.kind}
        name={nameDraft.trim() || deleteTarget.name}
        onConfirm={() => {
          void handleDeleteNode();
        }}
        onClose={() => setDeleteConfirmOpen(false)}
      />
    ) : null;

  const handlePayloadToggle = useCallback(
    async (key: keyof MissionHandoffPayload, checked: boolean) => {
      if (!selectedEdge) {
        return;
      }

      const next: MissionEdge = {
        ...selectedEdge,
        payload: {
          ...selectedEdge.payload,
          [key]: checked,
        },
      };
      await upsertEdge(mission.id, next);
    },
    [mission.id, selectedEdge, upsertEdge],
  );

  const persistName = useCallback(async () => {
    if (!selectedNode) {
      return;
    }

    if (isMissionRootNode(selectedNode)) {
      await persistMissionRootFields();
      return;
    }

    if (!isMissionToolNode(selectedNode) && !isMissionAutomationNode(selectedNode)) {
      return;
    }

    const fallback = template?.name ?? 'Agent';
    const nextName = nameDraft.trim() || fallback;
    const nextStored = nextName === fallback ? undefined : nextName;
    const currentStored = selectedNode.name?.trim() || undefined;
    if (currentStored === nextStored) {
      setNameDraft(nextName);
      return;
    }

    await upsertNode(mission.id, {
      ...selectedNode,
      name: nextStored,
    });
  }, [mission.id, nameDraft, persistMissionRootFields, selectedNode, template?.name, upsertNode]);

  const persistObjective = useCallback(async () => {
    if (!selectedNode || !isMissionRootNode(selectedNode)) {
      return;
    }

    await persistMissionRootFields();
  }, [persistMissionRootFields, selectedNode]);

  const projectOptions = useMemo(
    () =>
      projects.map((entry) => ({
        value: entry.id,
        label: entry.name,
        icon: <MissionProjectThumb logo={entry.logo} icon={entry.icon} color={entry.color} />,
      })),
    [projects],
  );

  const projectLeadingIcon = useMemo(() => {
    if (!project) {
      return null;
    }

    return <MissionProjectThumb logo={project.logo} icon={project.icon} color={project.color} />;
  }, [project]);

  const handleProjectChange = useCallback(
    async (projectId: string) => {
      if (!selectedNode || !projectId) {
        return;
      }

      if (
        !isMissionRootNode(selectedNode) &&
        !isMissionToolNode(selectedNode) &&
        !isMissionAutomationNode(selectedNode)
      ) {
        setProjectIdDraft(projectId);
        return;
      }

      if (projectId === selectedNode.projectId) {
        return;
      }

      await upsertNode(mission.id, {
        ...selectedNode,
        projectId,
        paneId: null,
        worktreePath: null,
        worktreeBranch: null,
      });
    },
    [mission.id, selectedNode, upsertNode],
  );

  const selectedAiProvider = aiProviderDraft;

  useEffect(() => {
    if (!window.nexus?.files?.getAgentModels) {
      setAgentModelOptions([]);
      return;
    }

    let cancelled = false;

    void window.nexus.files.getAgentModels(selectedAiProvider).then((models) => {
      if (cancelled) {
        return;
      }

      setAgentModelOptions(
        models
          .map((model) => ({
            id: model.id.trim(),
            label: model.label.trim() || model.id.trim(),
          }))
          .filter((entry) => entry.id.length > 0),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [selectedAiProvider]);

  const aiProviderOptions = useMemo(
    () => ASK_AI_PROVIDER_OPTIONS.map((option) => ({ value: option.id, label: option.label })),
    [],
  );

  const modelSelectOptions = useMemo(
    () => agentModelOptions.map((model) => ({ value: model.id, label: model.label })),
    [agentModelOptions],
  );

  const handleAiProviderChange = useCallback((value: string) => {
    const nextProvider = (value || DEFAULT_AI_PROVIDER) as Exclude<AiProviderId, 'nexus'>;
    setAiProviderDraft(nextProvider);
    setModelDraft('');
  }, []);

  const handleModelChange = useCallback((value: string) => {
    setModelDraft(value);
  }, []);

  const templateOptions = useMemo(
    () =>
      templates.map((entry) => ({
        value: entry.id,
        label: entry.name,
      })),
    [templates],
  );

  const roleOptions = useMemo(
    () =>
      roles.map((entry) => ({
        value: entry.id,
        label: entry.name,
      })),
    [roles],
  );

  const handleTemplateChange = useCallback(
    (agentTemplateId: string) => {
      if (!agentTemplateId) {
        return;
      }

      const nextTemplate =
        templates.find((entry) => entry.id === agentTemplateId) ??
        getBuiltinTemplateById(agentTemplateId);
      const keepCustomIdentity = Boolean(
        selectedNode?.identity?.trim() &&
        identityDraft.trim() &&
        identityDraft.trim() !== (template?.instructions?.trim() || ''),
      );

      setTemplateIdDraft(agentTemplateId);
      if (nextTemplate?.defaultRoleId) {
        setRoleIdDraft(nextTemplate.defaultRoleId);
      }
      if (!keepCustomIdentity) {
        setIdentityDraft(nextTemplate?.instructions || '');
      }
    },
    [identityDraft, selectedNode?.identity, template?.instructions, templates],
  );

  const handleRoleChange = useCallback((roleId: string) => {
    if (!roleId) {
      return;
    }
    setRoleIdDraft(roleId);
  }, []);

  const agentLinkOptions = useMemo(() => {
    if (!selectedNode) {
      return [];
    }

    return mission.nodes
      .filter((node) => node.id !== selectedNode.id && !isMissionToolNode(node))
      .map((node, index) => {
        const nodeTemplate =
          templates.find((entry) => entry.id === node.agentTemplateId) ??
          getBuiltinTemplateById(node.agentTemplateId);
        return {
          value: node.id,
          label: getMissionNodeDisplayName(node, nodeTemplate?.name ?? `Agent ${index + 1}`),
        };
      });
  }, [mission.nodes, selectedNode, templates]);

  const handleIncomingAgentChange = useCallback((sourceNodeId: string) => {
    setIncomingDraft(sourceNodeId);
  }, []);

  const handleOutgoingAgentChange = useCallback((targetNodeId: string) => {
    setOutgoingDraft(targetNodeId);
  }, []);

  const savedIncomingId = incoming[0]?.sourceNodeId ?? '';
  const savedOutgoingId = outgoing[0]?.targetNodeId ?? '';

  const isAgentDirty = useMemo(() => {
    if (
      !selectedNode ||
      isMissionRootNode(selectedNode) ||
      isMissionToolNode(selectedNode) ||
      isMissionAutomationNode(selectedNode) ||
      !projectIdDraft ||
      !templateIdDraft ||
      !roleIdDraft
    ) {
      return false;
    }

    const savedTemplate =
      templates.find((entry) => entry.id === selectedNode.agentTemplateId) ??
      getBuiltinTemplateById(selectedNode.agentTemplateId);
    const nameFallback = savedTemplate?.name ?? 'Agent';
    const nextName = nameDraft.trim() || nameFallback;
    const nextNameStored = nextName === nameFallback ? undefined : nextName;
    const currentNameStored = selectedNode.name?.trim() || undefined;

    const draftTemplate =
      templates.find((entry) => entry.id === templateIdDraft) ??
      getBuiltinTemplateById(templateIdDraft);
    const templateInstructions = draftTemplate?.instructions?.trim() || '';
    const nextIdentity = identityDraft.trim();
    const nextIdentityStored =
      !nextIdentity || nextIdentity === templateInstructions ? undefined : nextIdentity;
    const currentIdentityStored = selectedNode.identity?.trim() || undefined;

    const savedProvider = selectedNode.aiProvider ?? preferredAiProvider ?? DEFAULT_AI_PROVIDER;

    return (
      nextNameStored !== currentNameStored ||
      objectiveDraft.trim() !== selectedNode.objective ||
      nextIdentityStored !== currentIdentityStored ||
      projectIdDraft !== selectedNode.projectId ||
      aiProviderDraft !== savedProvider ||
      (modelDraft || undefined) !== (selectedNode.model || undefined) ||
      templateIdDraft !== selectedNode.agentTemplateId ||
      roleIdDraft !== selectedNode.roleId ||
      incomingDraft !== savedIncomingId ||
      outgoingDraft !== savedOutgoingId
    );
  }, [
    aiProviderDraft,
    identityDraft,
    incomingDraft,
    modelDraft,
    nameDraft,
    objectiveDraft,
    outgoingDraft,
    preferredAiProvider,
    projectIdDraft,
    roleIdDraft,
    savedIncomingId,
    savedOutgoingId,
    selectedNode,
    templateIdDraft,
    templates,
  ]);

  const handleSaveAgent = useCallback(async () => {
    if (!selectedNode || savingAgent || !isAgentDirty) {
      return;
    }

    if (
      isMissionRootNode(selectedNode) ||
      isMissionToolNode(selectedNode) ||
      isMissionAutomationNode(selectedNode)
    ) {
      return;
    }

    setSavingAgent(true);
    try {
      const draftTemplate =
        templates.find((entry) => entry.id === templateIdDraft) ??
        getBuiltinTemplateById(templateIdDraft);
      const nameFallback = draftTemplate?.name ?? 'Agent';
      const nextName = nameDraft.trim() || nameFallback;
      const nextNameStored = nextName === nameFallback ? undefined : nextName;
      const templateInstructions = draftTemplate?.instructions?.trim() || '';
      const nextIdentity = identityDraft.trim();
      const nextIdentityStored =
        !nextIdentity || nextIdentity === templateInstructions ? undefined : nextIdentity;
      const nextObjective = objectiveDraft.trim();
      const projectChanged = projectIdDraft !== selectedNode.projectId;
      const savedProvider = selectedNode.aiProvider ?? preferredAiProvider ?? DEFAULT_AI_PROVIDER;
      const providerChanged = aiProviderDraft !== savedProvider;

      await upsertNode(mission.id, {
        ...selectedNode,
        name: nextNameStored,
        objective: nextObjective,
        identity: nextIdentityStored,
        projectId: projectIdDraft || selectedNode.projectId,
        aiProvider: aiProviderDraft,
        model: modelDraft || undefined,
        agentTemplateId: templateIdDraft || selectedNode.agentTemplateId,
        roleId: roleIdDraft || selectedNode.roleId,
        ...(projectChanged
          ? { paneId: null, worktreePath: null, worktreeBranch: null }
          : providerChanged
            ? { paneId: null }
            : {}),
      });

      if (incomingDraft !== savedIncomingId) {
        for (const edge of incoming) {
          await removeEdge(mission.id, edge.id);
        }
        if (incomingDraft) {
          await upsertEdge(
            mission.id,
            createMissionEdge({
              sourceNodeId: incomingDraft,
              targetNodeId: selectedNode.id,
              type: 'handoff',
              condition: 'on_success',
            }),
          );
        }
      }

      if (outgoingDraft !== savedOutgoingId) {
        for (const edge of outgoing) {
          await removeEdge(mission.id, edge.id);
        }
        if (outgoingDraft) {
          await upsertEdge(
            mission.id,
            createMissionEdge({
              sourceNodeId: selectedNode.id,
              targetNodeId: outgoingDraft,
              type: 'handoff',
              condition: 'on_success',
            }),
          );
        }
      }
    } finally {
      setSavingAgent(false);
    }
  }, [
    aiProviderDraft,
    identityDraft,
    incoming,
    incomingDraft,
    isAgentDirty,
    mission.id,
    modelDraft,
    nameDraft,
    objectiveDraft,
    outgoing,
    outgoingDraft,
    preferredAiProvider,
    projectIdDraft,
    removeEdge,
    roleIdDraft,
    savedIncomingId,
    savedOutgoingId,
    savingAgent,
    selectedNode,
    templateIdDraft,
    templates,
    upsertEdge,
    upsertNode,
  ]);

  const conversationPaneId = selectedNode?.paneId;
  const conversationProjectId = project?.id;
  const handleConversationPtyCreated = useCallback(
    (ptyId: string) => {
      if (!conversationPaneId || !conversationProjectId) {
        return;
      }
      setTabPtyId(conversationProjectId, conversationPaneId, ptyId);
    },
    [conversationPaneId, conversationProjectId, setTabPtyId],
  );
  const handleConversationPtyLost = useCallback(() => {
    if (!conversationPaneId || !conversationProjectId) {
      return;
    }
    setTabPtyId(conversationProjectId, conversationPaneId, null);
  }, [conversationPaneId, conversationProjectId, setTabPtyId]);
  const handleConversationUpdateTab = useCallback(
    (
      patch: Partial<Pick<AgentTab, 'turns' | 'followUps' | 'workingDirectory' | 'restoreCommand'>>,
    ) => {
      if (!conversationPaneId) {
        return;
      }
      void updateAgentTab(conversationPaneId, patch);
    },
    [conversationPaneId, updateAgentTab],
  );
  const handleConversationFocusPane = useCallback(() => undefined, []);

  if (selectedEdge) {
    const source = mission.nodes.find((node) => node.id === selectedEdge.sourceNodeId);
    const target = mission.nodes.find((node) => node.id === selectedEdge.targetNodeId);
    const sourceTemplate = source
      ? (templates.find((entry) => entry.id === source.agentTemplateId) ??
        getBuiltinTemplateById(source.agentTemplateId))
      : null;
    const targetTemplate = target
      ? (templates.find((entry) => entry.id === target.agentTemplateId) ??
        getBuiltinTemplateById(target.agentTemplateId))
      : null;

    return (
      <aside className='mission-inspector overlay-popup--in app-button--enter'>
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
                {source
                  ? getMissionNodeDisplayName(source, sourceTemplate?.name ?? 'Origem')
                  : 'Desconhecida'}
              </span>
            </div>
            <span className='mission-inspector__edge-arrow' aria-hidden='true'>
              →
            </span>
            <div className='mission-inspector__edge-end'>
              <span className='mission-inspector__edge-end-label'>Destino</span>
              <span className='mission-inspector__edge-end-name'>
                {target
                  ? getMissionNodeDisplayName(target, targetTemplate?.name ?? 'Destino')
                  : 'Desconhecido'}
              </span>
            </div>
          </div>
          <button
            type='button'
            className='mission-inspector__delete-edge app-button'
            onClick={() => {
              void removeEdge(mission.id, selectedEdge.id);
              setSelectedEdgeId(null);
            }}
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
                void upsertEdge(mission.id, {
                  ...selectedEdge,
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
                void upsertEdge(mission.id, {
                  ...selectedEdge,
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
                    void handlePayloadToggle(key, checked);
                  }}
                  aria-label={label}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      </aside>
    );
  }

  if (!selectedNode) {
    return null;
  }

  if (isMissionRootNode(selectedNode)) {
    return (
      <aside
        className='mission-inspector mission-inspector--root overlay-popup--in app-button--enter'
        style={
          {
            '--mission-node-accent': '#22d3ee',
            '--mission-node-accent-soft': 'rgba(34, 211, 238, 0.18)',
            '--mission-node-accent-border': 'rgba(139, 92, 246, 0.7)',
          } as CSSProperties
        }
      >
        <div className='mission-inspector__header'>
          <div className='mission-inspector__header-top'>
            <span className='mission-inspector__eyebrow'>Missão</span>
            <button
              type='button'
              className='mission-inspector__close app-button app-button--enter'
              aria-label='Fechar inspector'
              onClick={() => setSelectedNodeId(null)}
            >
              <X size={14} strokeWidth={2.25} aria-hidden='true' />
            </button>
          </div>
          <span
            className='mission-inspector__avatar mission-inspector__avatar--root'
            aria-hidden='true'
          >
            <Flag size={22} strokeWidth={2.2} />
          </span>
          <h3 className='mission-inspector__title'>Núcleo da missão</h3>
          <p className='mission-inspector__subtitle'>
            {getMissionNodeStatusLabel(
              mission.status === 'running' ? 'running' : selectedNode.status,
            )}{' '}
            · {mission.progress}%
          </p>
        </div>

        <div className='mission-inspector__body'>
          <div className='mission-inspector__section'>
            <label className='mission-inspector__label' htmlFor='mission-root-title'>
              Nome
            </label>
            <input
              id='mission-root-title'
              className='mission-inspector__input'
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
              }}
            />
          </div>
          <div className='mission-inspector__section'>
            <label className='mission-inspector__label' htmlFor='mission-root-description'>
              Descrição
            </label>
            <textarea
              id='mission-root-description'
              className='mission-inspector__textarea'
              value={descriptionDraft}
              rows={4}
              onChange={(event) => setDescriptionDraft(event.target.value)}
              onPaste={handlePasteMissionImages}
              placeholder='Contexto geral da missão...'
            />
          </div>
          <div className='mission-inspector__section'>
            <label className='mission-inspector__label' htmlFor='mission-root-objective'>
              Objetivo
            </label>
            <textarea
              id='mission-root-objective'
              className='mission-inspector__textarea'
              value={missionObjectiveDraft}
              rows={4}
              onChange={(event) => setMissionObjectiveDraft(event.target.value)}
              onPaste={handlePasteMissionImages}
              placeholder='O que a missão precisa entregar...'
            />
          </div>
          <div className='mission-inspector__section'>
            <div className='mission-inspector__attachments-header'>
              <span className='mission-inspector__label'>Anexos</span>
              <button
                type='button'
                className='mission-inspector__add-attachment app-button app-button--enter'
                disabled={attachingMission}
                onClick={() => {
                  void handleAddMissionAttachments();
                }}
              >
                <Paperclip size={14} strokeWidth={2} aria-hidden='true' />
                <span className='app-button__label'>Adicionar</span>
              </button>
            </div>
            {missionAttachments.length > 0 ? (
              <ul className='mission-inspector__attachment-list'>
                {missionAttachments.map((attachment) => (
                  <li key={attachment.id} className='mission-inspector__attachment-item'>
                    <MissionEvidenceThumb
                      path={attachment.path}
                      kind={attachment.kind}
                      name={attachment.name}
                    />
                    <button
                      type='button'
                      className='mission-inspector__attachment-name app-button'
                      title={attachment.path}
                      onClick={() => handleRevealMissionAttachment(attachment.path)}
                    >
                      {attachment.name}
                    </button>
                    <button
                      type='button'
                      className='mission-inspector__attachment-remove app-button'
                      aria-label={`Remover ${attachment.name}`}
                      disabled={attachingMission}
                      onClick={() => {
                        void handleRemoveMissionAttachment(attachment.id);
                      }}
                    >
                      <Trash2 size={12} strokeWidth={2} aria-hidden='true' />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className='mission-inspector__hint'>
                Nenhum anexo. Adicione arquivos ou cole imagens com ⌘V na descrição/objetivo.
              </p>
            )}
          </div>
        </div>

        {isMissionRootDirty ? (
          <div className='mission-inspector__footer'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--primary app-button mission-inspector__open-agent'
              disabled={savingMissionRoot}
              onClick={() => {
                void handleSaveMissionRoot();
              }}
            >
              {savingMissionRoot ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        ) : null}
      </aside>
    );
  }

  if (isMissionAutomationNode(selectedNode) && selectedNode.automation) {
    const categoryLabel = getMissionAutomationCategoryLabel(
      selectedNode.automation.category ?? 'flow',
    );

    return (
      <>
        <aside className='mission-inspector overlay-popup--in app-button--enter'>
          <div className='mission-inspector__header'>
            <div className='mission-inspector__header-top'>
              <span className='mission-inspector__eyebrow'>Nó</span>
              <button
                type='button'
                className='mission-inspector__close app-button app-button--enter'
                aria-label='Fechar inspector'
                onClick={() => setSelectedNodeId(null)}
              >
                <X size={14} strokeWidth={2.25} aria-hidden='true' />
              </button>
            </div>
            <h3 className='mission-inspector__title'>
              <input
                className='mission-inspector__title-input'
                value={nameDraft}
                aria-label='Nome do nó'
                placeholder='Nó'
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={() => {
                  void persistName();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  }
                }}
              />
            </h3>
            <p className='mission-inspector__subtitle'>
              {categoryLabel} · {selectedNode.automation.nodeType}
            </p>
            <div className='mission-inspector__section'>
              <label className='mission-inspector__label'>Projeto</label>
              <AnchoredSelect
                value={selectedNode.projectId}
                options={projectOptions}
                disabled={projectOptions.length === 0}
                leadingIcon={projectLeadingIcon}
                onChange={(value) => {
                  void handleProjectChange(value);
                }}
                triggerClassName='mission-inspector__select'
              />
            </div>
          </div>

          <div className='mission-inspector__body'>
            {selectedNode.lastError ? (
              <div className='mission-inspector__section'>
                <label className='mission-inspector__label'>Erro</label>
                <p className='mission-inspector__text'>{selectedNode.lastError}</p>
              </div>
            ) : null}
            <MissionAutomationConfigForm
              automation={selectedNode.automation}
              onChange={(next: MissionAutomationConfig) => {
                void upsertNode(mission.id, {
                  ...selectedNode,
                  automation: next,
                });
              }}
            />
          </div>

          <div className='mission-inspector__footer'>
            <button
              type='button'
              className='mission-inspector__delete app-button app-button--enter'
              aria-label='Apagar nó'
              title='Apagar nó'
              onClick={requestDeleteSelectedNode}
            >
              <Trash2 size={14} strokeWidth={2.25} aria-hidden='true' />
            </button>
          </div>
        </aside>
        {deleteConfirmDialog}
      </>
    );
  }

  if (isMissionToolNode(selectedNode)) {
    const kind = getMissionNodeKind(selectedNode);
    if (kind !== 'browser' && kind !== 'emulator' && kind !== 'terminal' && kind !== 'api') {
      return null;
    }

    return (
      <>
        <aside
          className={`mission-inspector overlay-popup--in app-button--enter${
            agentLive ? ' mission-inspector--agent-open' : ''
          }`}
        >
          <div className='mission-inspector__header'>
            <div className='mission-inspector__header-top'>
              <span className='mission-inspector__eyebrow'>Display Node</span>
              <button
                type='button'
                className='mission-inspector__close app-button app-button--enter'
                aria-label='Fechar inspector'
                onClick={() => setSelectedNodeId(null)}
              >
                <X size={14} strokeWidth={2.25} aria-hidden='true' />
              </button>
            </div>
            <h3 className='mission-inspector__title'>
              <input
                className='mission-inspector__title-input'
                value={nameDraft}
                aria-label='Nome do nó'
                placeholder={getMissionToolNodeLabel(kind)}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={() => {
                  void persistName();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  }
                }}
              />
            </h3>
            <p className='mission-inspector__subtitle'>
              {getMissionToolNodeLabel(kind)} · {project?.name ?? selectedNode.projectId}
            </p>
            <div className='mission-inspector__section'>
              <label className='mission-inspector__label'>Projeto</label>
              <AnchoredSelect
                value={selectedNode.projectId}
                options={projectOptions}
                disabled={projectOptions.length === 0}
                leadingIcon={projectLeadingIcon}
                onChange={(value) => {
                  void handleProjectChange(value);
                }}
                triggerClassName='mission-inspector__select'
              />
            </div>
          </div>

          <div className='mission-inspector__body'>
            <EmptyState
              icon={Network}
              message='A pré-visualização já aparece no nó do grafo'
              compact
            />
          </div>

          <div className='mission-inspector__footer'>
            <button
              type='button'
              className='mission-inspector__delete app-button app-button--enter'
              aria-label='Apagar nó'
              title='Apagar nó'
              onClick={requestDeleteSelectedNode}
            >
              <Trash2 size={14} strokeWidth={2.25} aria-hidden='true' />
            </button>
          </div>
        </aside>
        {deleteConfirmDialog}
      </>
    );
  }

  const conversationPane =
    pane?.type === 'agent'
      ? liveConversationTurns
        ? {
            ...pane,
            turns: liveConversationTurns,
            followUps: liveConversationFollowUps ?? pane.followUps,
          }
        : pane
      : selectedNode.transcriptTurns && selectedNode.transcriptTurns.length > 0
        ? ({
            id: selectedNode.paneId ?? `mission-transcript-${selectedNode.id}`,
            title: selectedNode.name ?? 'Agent',
            type: 'agent' as const,
            cliAgent: 'agent',
            ptyId: null,
            messages: [],
            turns: selectedNode.transcriptTurns as AgentTab['turns'],
            followUps: (selectedNode.transcriptFollowUps as AgentFollowUp[] | undefined) ?? [],
            restoreCommand: 'agent',
            workingDirectory: selectedNode.worktreePath || project?.path || '',
            badgeColorIndex: 0,
          } as AgentTab)
        : null;
  const activityTurns = conversationPane?.turns ?? (pane?.type === 'agent' ? pane.turns : []);
  const changedFilesByPath = new Map<string, AgentTurnSummaryFileRef>();
  const mergeChangedFile = (file: AgentTurnSummaryFileRef) => {
    const key = file.path.toLowerCase();
    if (!key) {
      return;
    }
    const existing = changedFilesByPath.get(key);
    if (!existing) {
      changedFilesByPath.set(key, { ...file });
      return;
    }
    existing.additions = (existing.additions ?? 0) + (file.additions ?? 0);
    existing.deletions = (existing.deletions ?? 0) + (file.deletions ?? 0);
  };
  for (const turn of activityTurns) {
    for (const file of [
      ...buildEditedFilesFromActivities(turn.activities),
      ...(turn.summary?.editedFiles ?? []),
    ]) {
      mergeChangedFile(file);
    }
  }
  for (const file of gitChangedFiles) {
    mergeChangedFile(file);
  }
  if (changedFilesByPath.size === 0) {
    for (const turn of activityTurns) {
      for (const file of turn.summary?.exploredFiles ?? []) {
        mergeChangedFile(file);
      }
      for (const activity of turn.activities) {
        if (activity.kind !== 'file_read' || !activity.filePath?.trim()) {
          continue;
        }
        mergeChangedFile({ path: activity.filePath.trim() });
      }
    }
  }
  const changedFiles = [...changedFilesByPath.values()];
  const evidenceTexts = qaEvidences.filter((item) => item.kind === 'text');
  const evidenceImages = qaEvidences.filter((item) => item.kind === 'image' && item.path);
  const evidenceVideos = qaEvidences.filter((item) => item.kind === 'video' && item.path);
  const terminalCommands: AgentTurnSummaryCommandRef[] = [];
  const seenCommands = new Set<string>();
  for (const turn of activityTurns) {
    for (const command of turn.summary?.commands ?? []) {
      const value = command.command.trim();
      if (!value || seenCommands.has(value)) {
        continue;
      }
      seenCommands.add(value);
      terminalCommands.push({ command: value });
    }
    for (const activity of turn.activities) {
      if (activity.kind !== 'tool_run' || !activity.toolCommand?.trim()) {
        continue;
      }
      const value = activity.toolCommand.trim();
      if (seenCommands.has(value)) {
        continue;
      }
      seenCommands.add(value);
      terminalCommands.push({ command: value });
    }
  }

  const agentVisual = getMissionAgentVisual({
    kind: getMissionNodeKind(selectedNode),
    agentTemplateId: selectedNode.agentTemplateId,
    roleId: selectedNode.roleId,
  });
  const AgentIcon = agentVisual.icon;

  return (
    <>
      <aside
        className={`mission-inspector overlay-popup--in app-button--enter${
          tab === 'conversation' && agentLive ? ' mission-inspector--agent-open' : ''
        }`}
        style={
          {
            '--mission-node-accent': agentVisual.accent,
            '--mission-node-accent-soft': agentVisual.accentSoft,
            '--mission-node-accent-border': agentVisual.accentBorder,
          } as CSSProperties
        }
      >
        <div className='mission-inspector__header'>
          <div className='mission-inspector__header-top'>
            <span className='mission-inspector__eyebrow'>Agent</span>
            <button
              type='button'
              className='mission-inspector__close app-button app-button--enter'
              aria-label='Fechar inspector'
              onClick={() => setSelectedNodeId(null)}
            >
              <X size={14} strokeWidth={2.25} aria-hidden='true' />
            </button>
          </div>
          <span className='mission-inspector__avatar' aria-hidden='true'>
            <AgentIcon size={22} strokeWidth={2.2} />
          </span>
          <h3 className='mission-inspector__title'>
            <input
              className='mission-inspector__title-input'
              value={nameDraft}
              aria-label='Nome do agent'
              placeholder={template?.name ?? 'Agent'}
              onChange={(event) => setNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
              }}
            />
          </h3>
          <p className='mission-inspector__subtitle'>
            {role?.name} · {getMissionNodeStatusLabel(selectedNode.status)} ·{' '}
            {selectedNode.progress}%
          </p>
        </div>

        <div className='mission-inspector__tabs'>
          {(
            [
              ['overview', 'Visão geral', Network],
              ['identity', 'Objetivo/Identidade', Target],
              ['conversation', 'Conversa', MessageSquare],
              ['changes', 'Alterações', FileCode2],
              ['terminal', 'Terminal', Terminal],
              ['context', 'Contexto', GitBranch],
              ...(isMissionQaNode(selectedNode)
                ? ([['evidence', 'Evidências', FlaskConical]] as const)
                : []),
            ] as Array<[InspectorTabId, string, typeof Network]>
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type='button'
              className={`mission-inspector__tab app-button${
                tab === id ? ' mission-inspector__tab--active' : ''
              }`}
              onClick={() => setTab(id)}
            >
              <Icon size={13} strokeWidth={2.25} aria-hidden='true' />
              {label}
            </button>
          ))}
        </div>

        <div className='mission-inspector__body'>
          {tab === 'overview' ? (
            <>
              <div className='mission-inspector__section'>
                <label className='mission-inspector__label'>Projeto</label>
                <AnchoredSelect
                  value={projectIdDraft || selectedNode.projectId}
                  options={projectOptions}
                  disabled={projectOptions.length === 0}
                  leadingIcon={projectLeadingIcon}
                  onChange={(value) => {
                    void handleProjectChange(value);
                  }}
                  triggerClassName='mission-inspector__select'
                />
              </div>
              <div className='mission-inspector__section'>
                <label className='mission-inspector__label'>IA</label>
                <AnchoredSelect
                  value={selectedAiProvider}
                  options={aiProviderOptions}
                  onChange={(value) => {
                    handleAiProviderChange(value);
                  }}
                  triggerClassName='mission-inspector__select'
                />
              </div>
              <div className='mission-inspector__section'>
                <label className='mission-inspector__label'>Modelo</label>
                <AnchoredSelect
                  value={modelDraft}
                  options={modelSelectOptions}
                  allowEmpty
                  emptyLabel='Padrão'
                  disabled={modelSelectOptions.length === 0}
                  onChange={(value) => {
                    handleModelChange(value);
                  }}
                  triggerClassName='mission-inspector__select'
                />
              </div>
              <div className='mission-inspector__section'>
                <label className='mission-inspector__label'>Iteração</label>
                <p className='mission-inspector__text'>
                  {selectedNode.iteration} de {selectedNode.maxIterations}
                </p>
              </div>
              {selectedNode.currentStep ? (
                <div className='mission-inspector__section'>
                  <label className='mission-inspector__label'>Etapa atual</label>
                  <p className='mission-inspector__text'>{selectedNode.currentStep.label}</p>
                </div>
              ) : null}
              <div className='mission-inspector__section'>
                <label className='mission-inspector__label'>Checklist</label>
                {selectedNode.checklist.length === 0 ? (
                  <EmptyState icon={ListChecks} message='Nenhuma etapa registrada' compact />
                ) : (
                  <ul className='mission-inspector__steps'>
                    {selectedNode.checklist.map((step, index) => {
                      const meta = getChecklistStepMeta(step.status);
                      const StepIcon = meta.Icon;
                      return (
                        <li
                          key={step.id}
                          className={`mission-inspector__step mission-inspector__step--${step.status}`}
                        >
                          <span className='mission-inspector__step-rail' aria-hidden='true'>
                            <span className='mission-inspector__step-icon'>
                              <StepIcon
                                size={14}
                                strokeWidth={2.4}
                                className={
                                  step.status === 'running'
                                    ? 'mission-inspector__step-icon-spin'
                                    : undefined
                                }
                              />
                            </span>
                            {index < selectedNode.checklist.length - 1 ? (
                              <span className='mission-inspector__step-line' />
                            ) : null}
                          </span>
                          <div className='mission-inspector__step-copy'>
                            <span className='mission-inspector__step-label'>{step.label}</span>
                            <span className='mission-inspector__step-status'>{meta.label}</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div className='mission-inspector__section'>
                <label className='mission-inspector__label'>Recebeu de</label>
                <AnchoredSelect
                  value={incomingDraft}
                  options={agentLinkOptions}
                  allowEmpty
                  emptyLabel='Nenhum'
                  disabled={agentLinkOptions.length === 0}
                  onChange={(value) => {
                    handleIncomingAgentChange(value);
                  }}
                  triggerClassName='mission-inspector__select'
                />
              </div>
              <div className='mission-inspector__section'>
                <label className='mission-inspector__label'>Envia para</label>
                <AnchoredSelect
                  value={outgoingDraft}
                  options={agentLinkOptions}
                  allowEmpty
                  emptyLabel='Nenhum'
                  disabled={agentLinkOptions.length === 0}
                  onChange={(value) => {
                    handleOutgoingAgentChange(value);
                  }}
                  triggerClassName='mission-inspector__select'
                />
              </div>
            </>
          ) : null}

          {tab === 'identity' ? (
            <>
              <div className='mission-inspector__section'>
                <label className='mission-inspector__label'>Tipo</label>
                <AnchoredSelect
                  value={templateIdDraft || selectedNode.agentTemplateId}
                  options={templateOptions}
                  disabled={templateOptions.length === 0}
                  onChange={(value) => {
                    handleTemplateChange(value);
                  }}
                  triggerClassName='mission-inspector__select'
                />
              </div>
              <div className='mission-inspector__section'>
                <label className='mission-inspector__label'>Papel</label>
                <AnchoredSelect
                  value={roleIdDraft || selectedNode.roleId}
                  options={roleOptions}
                  disabled={roleOptions.length === 0}
                  onChange={(value) => {
                    handleRoleChange(value);
                  }}
                  triggerClassName='mission-inspector__select'
                />
              </div>
              <div className='mission-inspector__section mission-inspector__objective'>
                <label
                  className='mission-inspector__label'
                  htmlFor={`mission-node-objective-${selectedNode.id}`}
                >
                  Objetivo
                </label>
                <textarea
                  id={`mission-node-objective-${selectedNode.id}`}
                  className='mission-inspector__textarea'
                  value={objectiveDraft}
                  rows={4}
                  placeholder='Descreva o objetivo deste agent'
                  onChange={(event) => setObjectiveDraft(event.target.value)}
                  onPaste={handlePasteMissionImages}
                />
              </div>
              <div className='mission-inspector__section'>
                <div className='mission-inspector__attachments-header'>
                  <span className='mission-inspector__label'>Evidências</span>
                  <button
                    type='button'
                    className='mission-inspector__add-attachment app-button app-button--enter'
                    disabled={attachingMission}
                    onClick={() => {
                      void handleAddMissionAttachments();
                    }}
                  >
                    <Paperclip size={14} strokeWidth={2} aria-hidden='true' />
                    <span className='app-button__label'>Adicionar</span>
                  </button>
                </div>
                {missionAttachments.length > 0 ? (
                  <ul className='mission-inspector__attachment-list'>
                    {missionAttachments.map((attachment) => (
                      <li key={attachment.id} className='mission-inspector__attachment-item'>
                        <MissionEvidenceThumb
                          path={attachment.path}
                          kind={attachment.kind}
                          name={attachment.name}
                        />
                        <button
                          type='button'
                          className='mission-inspector__attachment-name app-button'
                          title={attachment.path}
                          onClick={() => handleRevealMissionAttachment(attachment.path)}
                        >
                          {attachment.name}
                        </button>
                        <button
                          type='button'
                          className='mission-inspector__attachment-remove app-button'
                          aria-label={`Remover ${attachment.name}`}
                          disabled={attachingMission}
                          onClick={() => {
                            void handleRemoveMissionAttachment(attachment.id);
                          }}
                        >
                          <Trash2 size={12} strokeWidth={2} aria-hidden='true' />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className='mission-inspector__hint'>
                    Evidências do objetivo da missão. Adicione arquivos ou cole imagens com ⌘V no
                    objetivo.
                  </p>
                )}
              </div>
              <div className='mission-inspector__section mission-inspector__objective'>
                <label
                  className='mission-inspector__label'
                  htmlFor={`mission-node-identity-${selectedNode.id}`}
                >
                  Identidade
                </label>
                <textarea
                  id={`mission-node-identity-${selectedNode.id}`}
                  className='mission-inspector__textarea'
                  value={identityDraft}
                  rows={8}
                  placeholder='Quem é este agent e como ele deve se comportar'
                  onChange={(event) => setIdentityDraft(event.target.value)}
                />
                <p className='mission-inspector__hint'>
                  Define a persona e as regras de comportamento usadas no prompt do agent.
                </p>
              </div>
            </>
          ) : null}

          {tab === 'conversation' ? (
            conversationPane && project ? (
              <Suspense fallback={<div className='mission-inspector__text'>Carregando...</div>}>
                <div className='mission-inspector__agent-embed'>
                  <LazyAgentView
                    tab={conversationPane}
                    projectId={project.id}
                    projectPath={selectedNode.worktreePath || project.path}
                    isVisible
                    isRuntimeActive={!agentRuntimeHosted}
                    eagerSession
                    isFocused={agentLive || agentRuntimeHosted}
                    disableStickyPrompt
                    onFocusPane={handleConversationFocusPane}
                    onPtyCreated={handleConversationPtyCreated}
                    onPtyLost={handleConversationPtyLost}
                    onUpdateTab={handleConversationUpdateTab}
                  />
                </div>
              </Suspense>
            ) : (
              <EmptyState
                icon={MessageSquare}
                message={openingAgent ? 'Abrindo agent...' : 'Nenhuma conversa neste nó'}
                compact
              />
            )
          ) : null}

          {tab === 'changes' ? (
            changedFiles.length > 0 ? (
              <ul className='mission-inspector__file-list'>
                {changedFiles.map((file) => (
                  <li key={file.path}>
                    <span>{file.path}</span>
                    <span>
                      +{file.additions ?? 0} -{file.deletions ?? 0}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={FileCode2} message='Nenhuma alteração ainda' compact />
            )
          ) : null}

          {tab === 'terminal' ? (
            terminalCommands.length > 0 ? (
              <ul className='mission-inspector__command-list'>
                {terminalCommands.map((command, index) => (
                  <li key={`${command.command}-${index}`}>$ {command.command}</li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Terminal} message='Nenhum comando executado' compact />
            )
          ) : null}

          {tab === 'context' ? (
            <div className='mission-inspector__section'>
              <label className='mission-inspector__label'>Contexto injetado</label>
              <pre className='mission-inspector__pre'>
                {selectedNode.injectedContext?.trim() || 'Nenhum contexto injetado ainda.'}
              </pre>
              <label className='mission-inspector__label'>Descobertas da missão</label>
              <ul className='mission-inspector__checklist'>
                {mission.discoveries.length === 0 ? (
                  <li>Nenhuma descoberta</li>
                ) : (
                  mission.discoveries.map((discovery) => (
                    <li key={discovery.id}>{discovery.content}</li>
                  ))
                )}
              </ul>
              <label className='mission-inspector__label'>Cápsulas</label>
              <ul className='mission-inspector__checklist'>
                {mission.capsules.length === 0 ? (
                  <li>Nenhuma cápsula</li>
                ) : (
                  mission.capsules.map((capsule) => (
                    <li key={capsule.id}>
                      <strong>{capsule.title}</strong>: {capsule.content}
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}

          {tab === 'evidence' ? (
            qaEvidences.length === 0 ? (
              <EmptyState icon={FlaskConical} message='Nenhuma evidência ainda' compact />
            ) : (
              <div className='mission-inspector__evidence'>
                {evidenceTexts.length > 0 ? (
                  <div className='mission-inspector__section'>
                    <label className='mission-inspector__label'>Texto</label>
                    <ul className='mission-inspector__evidence-text-list'>
                      {evidenceTexts.map((item) => (
                        <li key={item.id} className='mission-inspector__evidence-text-item'>
                          <strong>{item.title}</strong>
                          <pre className='mission-inspector__pre'>{item.content}</pre>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {evidenceImages.length > 0 ? (
                  <div className='mission-inspector__section'>
                    <label className='mission-inspector__label'>Imagens</label>
                    <div className='mission-inspector__evidence-media-grid'>
                      {evidenceImages.map((item) => (
                        <figure key={item.id} className='mission-inspector__evidence-card'>
                          <MissionQaMediaPreview
                            path={item.path!}
                            kind='image'
                            title={item.title}
                          />
                          <figcaption title={item.path}>{item.title}</figcaption>
                        </figure>
                      ))}
                    </div>
                  </div>
                ) : null}
                {evidenceVideos.length > 0 ? (
                  <div className='mission-inspector__section'>
                    <label className='mission-inspector__label'>Vídeos</label>
                    <div className='mission-inspector__evidence-media-grid mission-inspector__evidence-media-grid--video'>
                      {evidenceVideos.map((item) => (
                        <figure key={item.id} className='mission-inspector__evidence-card'>
                          <MissionQaMediaPreview
                            path={item.path!}
                            kind='video'
                            title={item.title}
                          />
                          <figcaption title={item.path}>{item.title}</figcaption>
                        </figure>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )
          ) : null}
        </div>

        <div className='mission-inspector__footer'>
          <button
            type='button'
            className='mission-inspector__delete app-button app-button--enter'
            aria-label='Apagar agent'
            title='Apagar agent'
            onClick={requestDeleteSelectedNode}
          >
            <Trash2 size={14} strokeWidth={2.25} aria-hidden='true' />
          </button>
          <button
            type='button'
            className='project-dialog__btn project-dialog__btn--primary app-button mission-inspector__open-agent'
            disabled={isAgentDirty ? savingAgent : openingAgent}
            onClick={() => {
              if (isAgentDirty) {
                void handleSaveAgent();
                return;
              }
              void handleOpenAgentClick();
            }}
          >
            {isAgentDirty
              ? savingAgent
                ? 'Salvando...'
                : 'Salvar'
              : openingAgent
                ? 'Abrindo...'
                : agentLive && tab === 'conversation'
                  ? 'Agent aberto'
                  : 'Abrir Agent'}
          </button>
        </div>
      </aside>
      {deleteConfirmDialog}
    </>
  );
}

export const MissionInspector = memo(MissionInspectorComponent);

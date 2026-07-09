import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, CirclePlay, Mail, Music, PanelLeft, Plus } from 'lucide-react';
import { useProjectIndexShortcuts } from '@/hooks/useProjectIndexShortcuts';
import { useGlobalSearchStore } from '@/stores/useGlobalSearchStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useProjectNotificationStore } from '@/stores/useProjectNotificationStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { useAutomationExecutionStore } from '@/stores/useAutomationExecutionStore';
import { useAgentComposerDraftStore } from '@/stores/useAgentComposerDraftStore';
import { ProjectListItem } from '@/components/sidebar/ProjectListItem';
import { WorkspaceMark } from '@/components/sidebar/WorkspaceMark';
import { useDailyGeneration } from '@/components/home/DailyGenerationProvider';
import { ProjectContextMenu } from '@/components/sidebar/ProjectContextMenu';
import { ProjectPromptDialog } from '@/components/sidebar/ProjectPromptDialog';
import { ProjectColorPicker } from '@/components/sidebar/ProjectColorPicker';
import { ProjectLogoCropDialog } from '@/components/sidebar/ProjectLogoCropDialog';
import { ProjectDeleteDialog } from '@/components/sidebar/ProjectDeleteDialog';
import { ProjectFlagCreateDialog } from '@/components/sidebar/ProjectFlagCreateDialog';
import { ProjectFlagWarningDialog } from '@/components/sidebar/ProjectFlagWarningDialog';
import { SidebarVideoLinkPopup } from '@/components/sidebar/SidebarVideoLinkPopup';
import { SidebarVideoPiP } from '@/components/sidebar/SidebarVideoPiP';
import { SidebarMusicPlayer } from '@/components/sidebar/SidebarMusicPlayer';
import { SidebarWhatsAppIcon } from '@/components/sidebar/SidebarWhatsAppIcon';
import { SidebarWhatsAppLinkPopup } from '@/components/sidebar/SidebarWhatsAppLinkPopup';
import { SidebarMailInboxPopup } from '@/components/sidebar/SidebarMailInboxPopup';
import { SidebarMailPanel } from '@/components/sidebar/SidebarMailPanel';
import { SidebarCalendarEvents } from '@/components/sidebar/SidebarCalendarEvents';
import { SidebarVercelDeployCard } from '@/components/sidebar/SidebarVercelDeployCard';
import { SidebarMobileReleaseCard } from '@/components/sidebar/SidebarMobileReleaseCard';
import { SidebarVercelIcon } from '@/components/sidebar/SidebarVercelIcon';
import { SidebarVercelTokenPopup } from '@/components/sidebar/SidebarVercelTokenPopup';
import { WorkspaceMenu } from '@/components/sidebar/WorkspaceMenu';
import { WorkspaceContextMenu } from '@/components/sidebar/WorkspaceContextMenu';
import { useVercelDeployments } from '@/hooks/useVercelDeployments';
import { useMobileReleases } from '@/hooks/useMobileReleases';
import {
  fetchSidebarVideoTitle,
  isYouTubeLiveUrl,
  type SidebarVideoSession,
} from '@/utils/sidebarVideoProviders';
import { openSidebarWhatsAppLink } from '@/utils/sidebarWhatsAppLink';
import { ProjectMoveWorkspaceMenu } from '@/components/sidebar/ProjectMoveWorkspaceMenu';
import { WorkspaceDeleteDialog } from '@/components/sidebar/WorkspaceDeleteDialog';
import type {
  ContextMenuState,
  MailMailboxRef,
  ProjectPromptMode,
  Workspace,
  WorkspaceContextMenuState,
} from '@/types';
import { buildRunningAgentProjectIdSet } from '@/utils/projectAgentStatus';
import { buildRunningAutomationProjectIdSet } from '@/utils/projectAutomationStatus';
import {
  buildSidebarProjects,
  getHiddenNotifiedProjects,
  getNotifiedWorkspaceIds,
  getRunningAgentWorkspaceIds,
} from '@/utils/projectNotificationVisibility';
import { getProjectPingTone } from '@/utils/projectPingTone';

function ProjectSidebarComponent() {
  const projects = useProjectStore((state) => state.projects);
  const workspaces = useProjectStore((state) => state.workspaces);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const selectingProjectId = useProjectStore((state) => state.selectingProjectId);
  const activeWorkspaceId = useProjectStore((state) => state.activeWorkspaceId);
  const addProject = useProjectStore((state) => state.addProject);
  const selectProject = useProjectStore((state) => state.selectProject);
  const leaveActiveProject = useProjectStore((state) => state.leaveActiveProject);
  const updateProject = useProjectStore((state) => state.updateProject);
  const removeProject = useProjectStore((state) => state.removeProject);
  const stopProject = useProjectStore((state) => state.stopProject);
  const createWorkspace = useProjectStore((state) => state.createWorkspace);
  const updateWorkspace = useProjectStore((state) => state.updateWorkspace);
  const selectWorkspace = useProjectStore((state) => state.selectWorkspace);
  const removeWorkspace = useProjectStore((state) => state.removeWorkspace);
  const moveProjectToWorkspace = useProjectStore((state) => state.moveProjectToWorkspace);
  const toggleSidebar = useProjectStore((state) => state.toggleSidebar);
  const sidebarCollapsed = useProjectStore((state) => state.sidebarCollapsed);
  const activeVideoSession = useProjectStore((state) => state.sidebarVideoSession);
  const sidebarVideoLastLink = useProjectStore((state) => state.sidebarVideoLastLink);
  const setSidebarVideoLastLink = useProjectStore((state) => state.setSidebarVideoLastLink);
  const startSidebarVideoSession = useProjectStore((state) => state.startSidebarVideoSession);
  const closeSidebarVideoSession = useProjectStore((state) => state.closeSidebarVideoSession);
  const activeProjectWhatsAppLink = useProjectStore((state) => {
    const project = state.projects.find((item) => item.id === state.activeProjectId);
    return project?.whatsappLink ?? null;
  });
  const setActiveProjectWhatsAppLink = useProjectStore((state) => state.setActiveProjectWhatsAppLink);
  const activeProjectMailInbox = useProjectStore((state) => {
    const project = state.projects.find((item) => item.id === state.activeProjectId);
    return project?.mailInbox ?? null;
  });
  const setActiveProjectMailInbox = useProjectStore((state) => state.setActiveProjectMailInbox);
  const initialized = useProjectStore((state) => state.initialized);
  const notifiedAgentPaneByProject = useProjectNotificationStore(
    (state) => state.notifiedAgentPaneByProject,
  );
  const awaitingResponseByPane = useTerminalSessionStore((state) => state.awaitingResponseByPane);
  const activeAgentByPane = useTerminalSessionStore((state) => state.activeAgentByPane);
  const agentBusyByPane = useTerminalSessionStore((state) => state.agentBusyByPane);
  const runningAgentProjectIds = useMemo(
    () => buildRunningAgentProjectIdSet(projects, awaitingResponseByPane, activeAgentByPane, agentBusyByPane),
    [activeAgentByPane, agentBusyByPane, awaitingResponseByPane, projects],
  );
  const executingAutomationByProject = useAutomationExecutionStore(
    (state) => state.executingAutomationByProject,
  );
  const runningAutomationProjectIds = useMemo(
    () => buildRunningAutomationProjectIdSet(executingAutomationByProject),
    [executingAutomationByProject],
  );
  const projectIdsWithDraft = useAgentComposerDraftStore((state) => state.projectIdsWithDraft);

  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const videoButtonRef = useRef<HTMLButtonElement>(null);
  const whatsappButtonRef = useRef<HTMLButtonElement>(null);
  const mailButtonRef = useRef<HTMLButtonElement>(null);
  const vercelButtonRef = useRef<HTMLButtonElement>(null);
  const skipWorkspaceListAnimationRef = useRef(true);
  const flagStartupCheckedRef = useRef(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceMenuRect, setWorkspaceMenuRect] = useState<DOMRect | null>(null);
  const [videoPopupOpen, setVideoPopupOpen] = useState(false);
  const [videoPopupAnchor, setVideoPopupAnchor] = useState<DOMRect | null>(null);
  const [whatsappPopupOpen, setWhatsappPopupOpen] = useState(false);
  const [whatsappPopupAnchor, setWhatsappPopupAnchor] = useState<DOMRect | null>(null);
  const [whatsappPopupOpensOnSave, setWhatsappPopupOpensOnSave] = useState(true);
  const [mailPanelOpen, setMailPanelOpen] = useState(false);
  const [mailPopupOpen, setMailPopupOpen] = useState(false);
  const [mailPopupAnchor, setMailPopupAnchor] = useState<DOMRect | null>(null);
  const [mailPopupOpensOnSave, setMailPopupOpensOnSave] = useState(true);
  const [vercelPopupOpen, setVercelPopupOpen] = useState(false);
  const [vercelPopupAnchor, setVercelPopupAnchor] = useState<DOMRect | null>(null);
  const [musicPlayerOpen, setMusicPlayerOpen] = useState(false);
  const musicPlayerOpenTick = useGlobalSearchStore((state) => state.musicPlayerOpenTick);
  const [projectListAnimationKey, setProjectListAnimationKey] = useState(0);
  const {
    tokenConfigured: vercelTokenConfigured,
    activeDeployment: vercelActiveDeployment,
    refresh: refreshVercelDeployments,
    refreshTokenConfigured: refreshVercelTokenConfigured,
    dismiss: dismissVercelDeployCard,
  } = useVercelDeployments(true);
  const { visibleReleases: visibleMobileReleases, dismissRelease: dismissMobileRelease } =
    useMobileReleases();

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [workspaceContextMenu, setWorkspaceContextMenu] = useState<WorkspaceContextMenuState | null>(
    null,
  );
  const { openDailyDateMenu, viewCached, hasCachedResult, selectedSkill, isSkillAvailableForProject, runningProjectId } =
    useDailyGeneration();
  const [promptMode, setPromptMode] = useState<ProjectPromptMode | null>(null);
  const [promptProjectId, setPromptProjectId] = useState<string | null>(null);
  const [promptWorkspaceId, setPromptWorkspaceId] = useState<string | null>(null);
  const [colorProjectId, setColorProjectId] = useState<string | null>(null);
  const [logoCrop, setLogoCrop] = useState<{
    projectId?: string;
    workspaceId?: string;
    sourcePath: string;
  } | null>(null);
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);
  const [moveProjectId, setMoveProjectId] = useState<string | null>(null);
  const [moveMenuPosition, setMoveMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [deleteWorkspaceId, setDeleteWorkspaceId] = useState<string | null>(null);
  const [flagCreateProjectId, setFlagCreateProjectId] = useState<string | null>(null);
  const [flagCreateWorkspaceId, setFlagCreateWorkspaceId] = useState<string | null>(null);
  const [pendingFlagAccess, setPendingFlagAccess] = useState<{
    projectId: string;
    previousProjectId: string | null;
  } | null>(null);

  const filteredProjects = useMemo(() => {
    if (activeWorkspaceId === null) {
      return projects;
    }

    return projects.filter((project) => project.workspaceId === activeWorkspaceId);
  }, [activeWorkspaceId, projects]);

  const sidebarProjects = useMemo(
    () =>
      buildSidebarProjects(
        projects,
        filteredProjects,
        activeProjectId,
        notifiedAgentPaneByProject,
        selectingProjectId,
      ),
    [activeProjectId, filteredProjects, notifiedAgentPaneByProject, projects, selectingProjectId],
  );

  const hiddenNotifiedProjects = useMemo(
    () => getHiddenNotifiedProjects(projects, sidebarProjects, notifiedAgentPaneByProject),
    [sidebarProjects, notifiedAgentPaneByProject, projects],
  );

  const notifiedWorkspaceIds = useMemo(
    () => getNotifiedWorkspaceIds(projects, notifiedAgentPaneByProject),
    [notifiedAgentPaneByProject, projects],
  );

  const runningAgentWorkspaceIds = useMemo(
    () => getRunningAgentWorkspaceIds(projects, runningAgentProjectIds),
    [projects, runningAgentProjectIds],
  );

  const workspaceFilterHasRunningAgent = useMemo(() => {
    if (activeWorkspaceId === null) {
      return runningAgentProjectIds.size > 0;
    }

    return projects.some(
      (project) =>
        project.workspaceId !== activeWorkspaceId && runningAgentProjectIds.has(project.id),
    );
  }, [activeWorkspaceId, projects, runningAgentProjectIds]);

  const workspaceFilterHasNotification = useMemo(() => {
    if (activeWorkspaceId === null) {
      return Object.keys(notifiedAgentPaneByProject).length > 0;
    }

    return projects.some(
      (project) =>
        project.workspaceId === activeWorkspaceId && Boolean(notifiedAgentPaneByProject[project.id]),
    );
  }, [activeWorkspaceId, notifiedAgentPaneByProject, projects]);

  const filterPingTone = useMemo(() => {
    const notifiedProject =
      hiddenNotifiedProjects[0] ??
      projects.find((project) => {
        if (!notifiedAgentPaneByProject[project.id]) {
          return false;
        }

        if (activeWorkspaceId === null) {
          return true;
        }

        return project.workspaceId === activeWorkspaceId;
      });

    return notifiedProject ? getProjectPingTone(notifiedProject.color) : null;
  }, [activeWorkspaceId, hiddenNotifiedProjects, notifiedAgentPaneByProject, projects]);

  const workspaceFilterLabel = useMemo(() => {
    if (activeWorkspaceId === null) {
      return 'Todos os projetos';
    }

    return workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.name ?? 'Todos os projetos';
  }, [activeWorkspaceId, workspaces]);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  );

  const canMoveProject = workspaces.length > 1;
  const canDeleteWorkspace = workspaces.length > 1;

  useEffect(() => {
    if (skipWorkspaceListAnimationRef.current) {
      skipWorkspaceListAnimationRef.current = false;
      return;
    }

    setProjectListAnimationKey((key) => key + 1);
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (musicPlayerOpenTick > 0) {
      setMusicPlayerOpen(true);
    }
  }, [musicPlayerOpenTick]);

  const contextProject = useMemo(
    () => projects.find((project) => project.id === contextMenu?.projectId) ?? null,
    [contextMenu?.projectId, projects],
  );

  const workspaceContextTarget = useMemo(
    () => workspaces.find((workspace) => workspace.id === workspaceContextMenu?.workspaceId) ?? null,
    [workspaceContextMenu?.workspaceId, workspaces],
  );

  const promptProject = useMemo(
    () => projects.find((project) => project.id === promptProjectId) ?? null,
    [promptProjectId, projects],
  );

  const promptWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === promptWorkspaceId) ?? null,
    [promptWorkspaceId, workspaces],
  );

  const colorProject = useMemo(
    () => projects.find((project) => project.id === colorProjectId) ?? null,
    [colorProjectId, projects],
  );

  const logoCropProject = useMemo(
    () => projects.find((project) => project.id === logoCrop?.projectId) ?? null,
    [logoCrop?.projectId, projects],
  );

  const logoCropWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === logoCrop?.workspaceId) ?? null,
    [logoCrop?.workspaceId, workspaces],
  );

  const projectToDelete = useMemo(
    () => projects.find((project) => project.id === deleteProjectId) ?? null,
    [deleteProjectId, projects],
  );

  const moveProject = useMemo(
    () => projects.find((project) => project.id === moveProjectId) ?? null,
    [moveProjectId, projects],
  );

  const workspaceToDelete = useMemo(
    () => workspaces.find((workspace) => workspace.id === deleteWorkspaceId) ?? null,
    [deleteWorkspaceId, workspaces],
  );

  const flagCreateProject = useMemo(
    () => projects.find((project) => project.id === flagCreateProjectId) ?? null,
    [flagCreateProjectId, projects],
  );

  const flagCreateWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === flagCreateWorkspaceId) ?? null,
    [flagCreateWorkspaceId, workspaces],
  );

  const pendingFlagProject = useMemo(
    () => projects.find((project) => project.id === pendingFlagAccess?.projectId) ?? null,
    [pendingFlagAccess?.projectId, projects],
  );

  useEffect(() => {
    if (!initialized || flagStartupCheckedRef.current) {
      return;
    }

    flagStartupCheckedRef.current = true;

    const activeProject = projects.find((project) => project.id === activeProjectId);

    if (activeProject?.flag) {
      setPendingFlagAccess({ projectId: activeProject.id, previousProjectId: null });
    }
  }, [activeProjectId, initialized, projects]);

  const handleAddProject = useCallback(() => {
    void addProject();
  }, [addProject]);

  const handleOpenVideoPopup = useCallback(() => {
    const rect = videoButtonRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setVideoPopupAnchor(rect);
    setVideoPopupOpen(true);
  }, []);

  const handleCloseVideoPopup = useCallback(() => {
    setVideoPopupOpen(false);
    setVideoPopupAnchor(null);
  }, []);

  const handleStartVideoSession = useCallback(
    async (session: SidebarVideoSession, lastLink: string) => {
      const rememberedLink = lastLink.trim() || session.sourceUrl;
      const isLive = isYouTubeLiveUrl(lastLink) || session.isLive === true;

      await setSidebarVideoLastLink(rememberedLink);

      const title = await fetchSidebarVideoTitle(session.sourceUrl, session.provider);
      await startSidebarVideoSession(
        {
          ...session,
          title,
          isLive,
          useEmbed: session.provider === 'youtube' ? false : isLive ? false : session.useEmbed,
        },
        rememberedLink,
      );
    },
    [setSidebarVideoLastLink, startSidebarVideoSession],
  );

  const handleCloseVideoSession = useCallback(() => {
    void closeSidebarVideoSession();
  }, [closeSidebarVideoSession]);

  const videoPopupInitialLink = sidebarVideoLastLink ?? activeVideoSession?.sourceUrl ?? '';

  const handleToggleMusicPlayer = useCallback(() => {
    setMusicPlayerOpen((current) => !current);
  }, []);

  const openWhatsappPopup = useCallback((opensOnSave: boolean) => {
    const rect = whatsappButtonRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setWhatsappPopupOpensOnSave(opensOnSave);
    setWhatsappPopupAnchor(rect);
    setWhatsappPopupOpen(true);
  }, []);

  const handleCloseWhatsappPopup = useCallback(() => {
    setWhatsappPopupOpen(false);
    setWhatsappPopupAnchor(null);
  }, []);

  const handleWhatsappClick = useCallback(() => {
    if (!activeProjectId) {
      return;
    }

    if (activeProjectWhatsAppLink) {
      void openSidebarWhatsAppLink(activeProjectWhatsAppLink);
      return;
    }

    openWhatsappPopup(true);
  }, [activeProjectId, activeProjectWhatsAppLink, openWhatsappPopup]);

  const handleWhatsappContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!activeProjectId || !activeProjectWhatsAppLink) {
        return;
      }

      event.preventDefault();
      openWhatsappPopup(false);
    },
    [activeProjectId, activeProjectWhatsAppLink, openWhatsappPopup],
  );

  const handleSaveWhatsappLink = useCallback(
    async (link: string) => {
      await setActiveProjectWhatsAppLink(link);

      if (whatsappPopupOpensOnSave) {
        void openSidebarWhatsAppLink(link);
      }
    },
    [setActiveProjectWhatsAppLink, whatsappPopupOpensOnSave],
  );

  const openMailPopup = useCallback((opensOnSave: boolean) => {
    const rect = mailButtonRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setMailPopupOpensOnSave(opensOnSave);
    setMailPopupAnchor(rect);
    setMailPopupOpen(true);
  }, []);

  const handleCloseMailPopup = useCallback(() => {
    setMailPopupOpen(false);
    setMailPopupAnchor(null);
  }, []);

  const handleMailClick = useCallback(() => {
    if (!activeProjectId) {
      return;
    }

    if (activeProjectMailInbox) {
      setMailPanelOpen((current) => !current);
      return;
    }

    openMailPopup(true);
  }, [activeProjectId, activeProjectMailInbox, openMailPopup]);

  const handleMailContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!activeProjectId) {
        return;
      }

      event.preventDefault();
      openMailPopup(false);
    },
    [activeProjectId, openMailPopup],
  );

  const handleSaveMailInbox = useCallback(
    async (mailbox: MailMailboxRef) => {
      await setActiveProjectMailInbox(mailbox);

      if (mailPopupOpensOnSave) {
        setMailPanelOpen(true);
      }
    },
    [mailPopupOpensOnSave, setActiveProjectMailInbox],
  );

  const openVercelPopup = useCallback(() => {
    const rect = vercelButtonRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setVercelPopupAnchor(rect);
    setVercelPopupOpen(true);
  }, []);

  const handleCloseVercelPopup = useCallback(() => {
    setVercelPopupOpen(false);
    setVercelPopupAnchor(null);
  }, []);

  const handleVercelClick = useCallback(() => {
    openVercelPopup();
  }, [openVercelPopup]);

  const handleVercelContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!vercelTokenConfigured) {
        return;
      }

      event.preventDefault();
      openVercelPopup();
    },
    [openVercelPopup, vercelTokenConfigured],
  );

  const handleVercelTokenSaved = useCallback(() => {
    void refreshVercelTokenConfigured();
    void refreshVercelDeployments();
  }, [refreshVercelDeployments, refreshVercelTokenConfigured]);

  const handleVercelTokenCleared = useCallback(() => {
    void refreshVercelTokenConfigured();
    void refreshVercelDeployments();
  }, [refreshVercelDeployments, refreshVercelTokenConfigured]);

  useEffect(() => {
    setMailPanelOpen(false);
  }, [activeProjectId]);

  const handleToggleSidebar = useCallback(() => {
    void toggleSidebar();
  }, [toggleSidebar]);

  const handleOpenWorkspaceMenu = useCallback(() => {
    const rect = filterButtonRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setWorkspaceMenuRect(rect);
    setWorkspaceMenuOpen(true);
  }, []);

  const handleCloseWorkspaceMenu = useCallback(() => {
    setWorkspaceMenuOpen(false);
    setWorkspaceMenuRect(null);
    setWorkspaceContextMenu(null);
  }, []);

  const handleSelectWorkspace = useCallback(
    (workspaceId: string | null) => {
      void selectWorkspace(workspaceId);
    },
    [selectWorkspace],
  );

  const handleCreateWorkspace = useCallback(() => {
    setPromptProjectId(null);
    setPromptMode('workspace');
  }, []);

  const closeWorkspaceMenusForAction = useCallback(() => {
    setWorkspaceContextMenu(null);
    setWorkspaceMenuOpen(false);
    setWorkspaceMenuRect(null);
  }, []);

  const handleDeleteWorkspace = useCallback(
    (workspaceId: string) => {
      closeWorkspaceMenusForAction();
      setDeleteWorkspaceId(workspaceId);
    },
    [closeWorkspaceMenusForAction],
  );

  const handleWorkspaceContextMenu = useCallback((workspace: Workspace, x: number, y: number) => {
    setWorkspaceContextMenu({ workspaceId: workspace.id, x, y });
  }, []);

  const handleCloseWorkspaceContextMenu = useCallback(() => {
    setWorkspaceContextMenu(null);
  }, []);

  const handleSetWorkspaceLogo = useCallback(
    async (workspaceId: string) => {
      closeWorkspaceMenusForAction();

      try {
        const sourcePath = await window.nexus.dialog.openImage();

        if (!sourcePath) {
          return;
        }

        setLogoCrop({ workspaceId, sourcePath });
      } catch {
        return;
      }
    },
    [closeWorkspaceMenusForAction],
  );

  const handleRemoveWorkspaceLogo = useCallback(
    async (workspaceId: string) => {
      closeWorkspaceMenusForAction();
      const workspace = workspaces.find((item) => item.id === workspaceId);

      if (!workspace?.logo) {
        return;
      }

      await window.nexus.projects.removeLogo(workspace.logo);
      await updateWorkspace(workspaceId, { logo: null });
    },
    [closeWorkspaceMenusForAction, updateWorkspace, workspaces],
  );

  const handleSetWorkspaceIcon = useCallback(
    (workspaceId: string) => {
      closeWorkspaceMenusForAction();
      setPromptWorkspaceId(workspaceId);
      setPromptMode('workspace-icon');
    },
    [closeWorkspaceMenusForAction],
  );

  const handleRenameWorkspace = useCallback(
    (workspaceId: string) => {
      closeWorkspaceMenusForAction();
      setPromptWorkspaceId(workspaceId);
      setPromptMode('workspace-rename');
    },
    [closeWorkspaceMenusForAction],
  );

  const handleCreateWorkspaceFlag = useCallback(
    (workspaceId: string) => {
      closeWorkspaceMenusForAction();
      setFlagCreateWorkspaceId(workspaceId);
    },
    [closeWorkspaceMenusForAction],
  );

  const handleDeleteWorkspaceClose = useCallback(() => {
    setDeleteWorkspaceId(null);
  }, []);

  const handleDeleteWorkspaceConfirm = useCallback(() => {
    if (!deleteWorkspaceId) {
      return;
    }

    void removeWorkspace(deleteWorkspaceId);
    setDeleteWorkspaceId(null);
  }, [deleteWorkspaceId, removeWorkspace]);

  const handleSelectProject = useCallback(
    (id: string) => {
      if (id === activeProjectId) {
        void leaveActiveProject();
        return;
      }

      const project = projects.find((item) => item.id === id);

      if (project?.flag) {
        setPendingFlagAccess({ projectId: id, previousProjectId: activeProjectId });
        return;
      }

      void selectProject(id);
    },
    [activeProjectId, leaveActiveProject, projects, selectProject],
  );

  const handleCreateFlag = useCallback((projectId: string) => {
    setFlagCreateProjectId(projectId);
  }, []);

  const handleFlagCreateClose = useCallback(() => {
    setFlagCreateProjectId(null);
    setFlagCreateWorkspaceId(null);
  }, []);

  const handleFlagCreateConfirm = useCallback(
    (reason: string) => {
      if (flagCreateWorkspaceId) {
        void updateWorkspace(flagCreateWorkspaceId, {
          flag: { reason, createdAt: Date.now() },
        });
        setFlagCreateWorkspaceId(null);
        return;
      }

      if (!flagCreateProjectId) {
        return;
      }

      void updateProject(flagCreateProjectId, {
        flag: { reason, createdAt: Date.now() },
      });
      setFlagCreateProjectId(null);
    },
    [flagCreateProjectId, flagCreateWorkspaceId, updateProject, updateWorkspace],
  );

  const handleFlagAccessDismiss = useCallback(() => {
    if (!pendingFlagAccess) {
      return;
    }

    const { projectId } = pendingFlagAccess;
    setPendingFlagAccess(null);

    if (projectId !== activeProjectId) {
      void selectProject(projectId);
    }
  }, [activeProjectId, pendingFlagAccess, selectProject]);

  const handleFlagAccessRemove = useCallback(() => {
    if (!pendingFlagAccess) {
      return;
    }

    const { projectId, previousProjectId } = pendingFlagAccess;
    setPendingFlagAccess(null);

    void (async () => {
      await updateProject(projectId, { flag: null });

      if (previousProjectId !== null && projectId !== activeProjectId) {
        await selectProject(projectId);
      }
    })();
  }, [activeProjectId, pendingFlagAccess, selectProject, updateProject]);

  useProjectIndexShortcuts({ filteredProjects: sidebarProjects, onSelectProject: handleSelectProject });

  const handleContextMenu = useCallback((project: { id: string }, x: number, y: number) => {
    setContextMenu({ projectId: project.id, x, y });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleViewDaily = useCallback(
    (projectId: string) => {
      viewCached(projectId);
      handleCloseContextMenu();
    },
    [handleCloseContextMenu, viewCached],
  );

  const handleGenerateDaily = useCallback(
    (projectId: string) => {
      if (!contextMenu) {
        return;
      }

      openDailyDateMenu(projectId, contextMenu.x, contextMenu.y);
      handleCloseContextMenu();
    },
    [contextMenu, handleCloseContextMenu, openDailyDateMenu],
  );

  const canGenerateDailyForProject = useCallback(
    (projectId: string) => {
      const project = projects.find((entry) => entry.id === projectId);

      if (!project || !selectedSkill) {
        return false;
      }

      return isSkillAvailableForProject(project.path);
    },
    [isSkillAvailableForProject, projects, selectedSkill],
  );

  const handleSetLogo = useCallback(async (projectId: string) => {
    try {
      const sourcePath = await window.nexus.dialog.openImage();

      if (!sourcePath) {
        return;
      }

      setLogoCrop({ projectId, sourcePath });
    } catch {
      return;
    }
  }, []);

  const handleLogoCropClose = useCallback(() => {
    setLogoCrop(null);
  }, []);

  const handleLogoCropConfirm = useCallback(
    async (dataUrl: string) => {
      if (!logoCrop) {
        return;
      }

      try {
        if (logoCrop.workspaceId) {
          await window.nexus.projects.saveWorkspaceLogoFromDataUrl(logoCrop.workspaceId, dataUrl);
        } else if (logoCrop.projectId) {
          await window.nexus.projects.saveLogoFromDataUrl(logoCrop.projectId, dataUrl);
        } else {
          return;
        }

        const appState = await window.nexus.projects.list();
        useProjectStore.setState({
          projects: appState.projects,
          workspaces: appState.workspaces,
          activeProjectId: appState.activeProjectId,
          activeWorkspaceId: appState.activeWorkspaceId,
        });
        setLogoCrop(null);
      } catch {
        return;
      }
    },
    [logoCrop],
  );

  const handleRemoveLogo = useCallback(
    async (projectId: string) => {
      const project = projects.find((item) => item.id === projectId);

      if (!project?.logo) {
        return;
      }

      await window.nexus.projects.removeLogo(project.logo);
      await updateProject(projectId, { logo: null });
    },
    [projects, updateProject],
  );

  const handleSetIcon = useCallback((projectId: string) => {
    setPromptProjectId(projectId);
    setPromptMode('icon');
  }, []);

  const handleSetIconColor = useCallback((projectId: string) => {
    setColorProjectId(projectId);
  }, []);

  const handleRename = useCallback((projectId: string) => {
    setPromptProjectId(projectId);
    setPromptMode('rename');
  }, []);

  const handleDelete = useCallback((projectId: string) => {
    setDeleteProjectId(projectId);
  }, []);

  const handleStopAll = useCallback(
    (projectId: string) => {
      void stopProject(projectId);
    },
    [stopProject],
  );

  const handleMove = useCallback((projectId: string, anchorRect: DOMRect) => {
    setContextMenu(null);
    setMoveProjectId(projectId);
    setMoveMenuPosition({
      x: anchorRect.left,
      y: anchorRect.top,
    });
  }, []);

  const handleMoveClose = useCallback(() => {
    setMoveProjectId(null);
    setMoveMenuPosition(null);
  }, []);

  const handleMoveSelect = useCallback(
    (workspaceId: string) => {
      if (!moveProjectId) {
        return;
      }

      void moveProjectToWorkspace(moveProjectId, workspaceId);
      setMoveProjectId(null);
      setMoveMenuPosition(null);
    },
    [moveProjectId, moveProjectToWorkspace],
  );

  const handleDeleteClose = useCallback(() => {
    setDeleteProjectId(null);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (!deleteProjectId) {
      return;
    }

    void removeProject(deleteProjectId);
    setDeleteProjectId(null);
  }, [deleteProjectId, removeProject]);

  const handlePromptClose = useCallback(() => {
    setPromptMode(null);
    setPromptProjectId(null);
    setPromptWorkspaceId(null);
  }, []);

  const handlePromptConfirm = useCallback(
    async (value: string) => {
      if (promptMode === 'workspace') {
        await createWorkspace(value);
        setPromptMode(null);
        setPromptProjectId(null);
        setPromptWorkspaceId(null);
        return;
      }

      if (promptMode === 'workspace-rename' && promptWorkspaceId) {
        await updateWorkspace(promptWorkspaceId, { name: value });
        setPromptMode(null);
        setPromptWorkspaceId(null);
        return;
      }

      if (promptMode === 'workspace-icon' && promptWorkspaceId) {
        await updateWorkspace(promptWorkspaceId, { icon: value, iconCustomized: true });
        setPromptMode(null);
        setPromptWorkspaceId(null);
        return;
      }

      if (!promptProjectId || !promptMode) {
        return;
      }

      if (promptMode === 'rename') {
        await updateProject(promptProjectId, { name: value });
        return;
      }

      await updateProject(promptProjectId, { icon: value, iconCustomized: true });
    },
    [createWorkspace, promptMode, promptProjectId, promptWorkspaceId, updateProject, updateWorkspace],
  );

  const handleColorClose = useCallback(() => {
    setColorProjectId(null);
  }, []);

  const handleColorSelect = useCallback(
    async (color: string) => {
      if (!colorProjectId) {
        return;
      }

      await updateProject(colorProjectId, { color });
    },
    [colorProjectId, updateProject],
  );

  return (
    <aside className={`sidebar${sidebarCollapsed ? ' sidebar--collapsed' : ''}`}>
      <div className='sidebar__header'>
        <button
          type='button'
          className='sidebar__toggle tool-btn'
          aria-label='Alternar barra lateral'
          title={sidebarCollapsed ? 'Expandir barra lateral' : 'Ocultar barra lateral'}
          onClick={handleToggleSidebar}
        >
          <PanelLeft size={15} />
        </button>
        <button
          ref={filterButtonRef}
          type='button'
          className={`sidebar__filter${workspaceFilterHasNotification ? ' sidebar__filter--notified' : ''}`}
          title={workspaceFilterLabel}
          onClick={handleOpenWorkspaceMenu}
        >
          <span className='sidebar__filter-label'>
            <span className='sidebar__filter-icon-wrap'>
              {activeWorkspace ? (
                <WorkspaceMark workspace={activeWorkspace} size='filter' />
              ) : (
                <span className='sidebar__filter-dot' aria-hidden='true' />
              )}
              {filterPingTone ? (
                <span
                  className={`project-item__ping project-item__ping--${filterPingTone} sidebar__filter-ping`}
                  aria-hidden='true'
                />
              ) : null}
            </span>
            <span className='sidebar__filter-text'>{workspaceFilterLabel}</span>
            {workspaceFilterHasRunningAgent ? (
              <span
                className='project-item__agent project-item__agent--loading sidebar__filter-agent'
                aria-label='Agent em execução'
              />
            ) : null}
          </span>
          <ChevronDown size={14} />
        </button>
      </div>

      <div className='sidebar__list'>
        {sidebarProjects.map((project, index) => (
          <ProjectListItem
            key={project.id}
            project={project}
            isActive={project.id === activeProjectId}
            isFlagged={Boolean(project.flag)}
            hasNotification={Boolean(notifiedAgentPaneByProject[project.id])}
            isAgentRunning={runningAgentProjectIds.has(project.id)}
            isAutomationRunning={runningAutomationProjectIds.has(project.id)}
            hasAgentDraft={Boolean(projectIdsWithDraft[project.id])}
            enterIndex={index}
            enterAnimationKey={projectListAnimationKey}
            onSelect={handleSelectProject}
            onContextMenu={handleContextMenu}
          />
        ))}
      </div>

      <div className='sidebar__footer'>
        {activeVideoSession ? (
          <div className='sidebar-video-pip-anchor'>
            <SidebarVideoPiP session={activeVideoSession} onClose={handleCloseVideoSession} />
          </div>
        ) : null}

        {musicPlayerOpen ? <SidebarMusicPlayer /> : null}

        {mailPanelOpen && activeProjectMailInbox ? (
          <SidebarMailPanel mailbox={activeProjectMailInbox} />
        ) : null}

        {visibleMobileReleases.map((release) => (
          <SidebarMobileReleaseCard
            key={release.uid}
            release={release}
            onDismiss={() => dismissMobileRelease(release.uid)}
          />
        ))}

        {vercelActiveDeployment ? (
          <SidebarVercelDeployCard deployment={vercelActiveDeployment} onDismiss={dismissVercelDeployCard} />
        ) : null}

        <SidebarCalendarEvents />

        <button type='button' className='sidebar__add app-button app-button--enter' title='Adicionar projeto' onClick={handleAddProject}>
          <Plus size={14} />
          <span className='app-button__label'>Adicionar projeto</span>
        </button>

        <div className='sidebar__actions'>
          <button
            ref={videoButtonRef}
            type='button'
            className={`sidebar__action-btn app-button app-button--enter${activeVideoSession ? ' sidebar__action-btn--active' : ''}`}
            aria-label='Reproduzir vídeo'
            title='Reproduzir vídeo'
            onClick={handleOpenVideoPopup}
          >
            <CirclePlay size={14} />
          </button>
          <button
            type='button'
            className={`sidebar__action-btn app-button app-button--enter${musicPlayerOpen ? ' sidebar__action-btn--active' : ''}`}
            aria-label='Player de música'
            title='Player de música'
            onClick={handleToggleMusicPlayer}
          >
            <Music size={14} />
          </button>
          <button
            ref={whatsappButtonRef}
            type='button'
            className={`sidebar__action-btn app-button app-button--enter${whatsappPopupOpen ? ' sidebar__action-btn--active' : ''}`}
            aria-label='WhatsApp'
            title='WhatsApp'
            onClick={handleWhatsappClick}
            onContextMenu={handleWhatsappContextMenu}
          >
            <SidebarWhatsAppIcon size={14} />
          </button>
          <button
            ref={mailButtonRef}
            type='button'
            className={`sidebar__action-btn app-button app-button--enter${mailPanelOpen || mailPopupOpen ? ' sidebar__action-btn--active' : ''}`}
            aria-label='E-mail'
            title='E-mail'
            onClick={handleMailClick}
            onContextMenu={handleMailContextMenu}
          >
            <Mail size={14} />
          </button>
          <button
            ref={vercelButtonRef}
            type='button'
            className={`sidebar__action-btn app-button app-button--enter${vercelPopupOpen || vercelTokenConfigured ? ' sidebar__action-btn--active' : ''}`}
            aria-label='Vercel'
            title='Vercel'
            onClick={handleVercelClick}
            onContextMenu={handleVercelContextMenu}
          >
            <SidebarVercelIcon size={14} />
          </button>
        </div>
      </div>

      {videoPopupOpen && videoPopupAnchor ? (
        <SidebarVideoLinkPopup
          key={videoPopupInitialLink || 'sidebar-video-popup'}
          anchorRect={videoPopupAnchor}
          initialLink={videoPopupInitialLink}
          onClose={handleCloseVideoPopup}
          onStart={handleStartVideoSession}
        />
      ) : null}

      {whatsappPopupOpen && whatsappPopupAnchor && activeProjectId ? (
        <SidebarWhatsAppLinkPopup
          key={activeProjectId}
          anchorRect={whatsappPopupAnchor}
          initialLink={activeProjectWhatsAppLink ?? ''}
          submitOpensLink={whatsappPopupOpensOnSave}
          onClose={handleCloseWhatsappPopup}
          onSave={(link) => void handleSaveWhatsappLink(link)}
        />
      ) : null}

      {mailPopupOpen && mailPopupAnchor && activeProjectId ? (
        <SidebarMailInboxPopup
          key={activeProjectId}
          anchorRect={mailPopupAnchor}
          initialMailbox={activeProjectMailInbox}
          submitOpensPanel={mailPopupOpensOnSave}
          onClose={handleCloseMailPopup}
          onSave={(mailbox) => void handleSaveMailInbox(mailbox)}
        />
      ) : null}

      {vercelPopupOpen && vercelPopupAnchor ? (
        <SidebarVercelTokenPopup
          anchorRect={vercelPopupAnchor}
          tokenConfigured={vercelTokenConfigured}
          onClose={handleCloseVercelPopup}
          onSaved={handleVercelTokenSaved}
          onCleared={handleVercelTokenCleared}
        />
      ) : null}

      {workspaceMenuOpen && workspaceMenuRect ? (
        <WorkspaceMenu
          anchorRect={workspaceMenuRect}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          hasHiddenNotifications={notifiedWorkspaceIds.size > 0}
          notifiedWorkspaceIds={notifiedWorkspaceIds}
          hasRunningAgent={runningAgentProjectIds.size > 0}
          runningAgentWorkspaceIds={runningAgentWorkspaceIds}
          onClose={handleCloseWorkspaceMenu}
          onSelect={handleSelectWorkspace}
          onCreate={handleCreateWorkspace}
          onContextMenu={handleWorkspaceContextMenu}
        />
      ) : null}

      {workspaceContextMenu && workspaceContextTarget ? (
        <WorkspaceContextMenu
          workspace={workspaceContextTarget}
          x={workspaceContextMenu.x}
          y={workspaceContextMenu.y}
          canDelete={canDeleteWorkspace}
          onClose={handleCloseWorkspaceContextMenu}
          onSetLogo={(workspaceId) => void handleSetWorkspaceLogo(workspaceId)}
          onRemoveLogo={(workspaceId) => void handleRemoveWorkspaceLogo(workspaceId)}
          onSetIcon={handleSetWorkspaceIcon}
          onRename={handleRenameWorkspace}
          onCreateFlag={handleCreateWorkspaceFlag}
          onDelete={handleDeleteWorkspace}
        />
      ) : null}

      {contextMenu && contextProject ? (
        <ProjectContextMenu
          project={contextProject}
          x={contextMenu.x}
          y={contextMenu.y}
          canMoveWorkspace={canMoveProject}
          canGenerateDaily={
            canGenerateDailyForProject(contextProject.id) && runningProjectId === null
          }
          hasCachedDaily={hasCachedResult(contextProject.id)}
          onClose={handleCloseContextMenu}
          onSetLogo={(projectId) => void handleSetLogo(projectId)}
          onRemoveLogo={(projectId) => void handleRemoveLogo(projectId)}
          onSetIcon={handleSetIcon}
          onSetIconColor={handleSetIconColor}
          onRename={handleRename}
          onCreateFlag={handleCreateFlag}
          onMove={handleMove}
          onGenerateDaily={handleGenerateDaily}
          onViewDaily={handleViewDaily}
          onStopAll={handleStopAll}
          onDelete={handleDelete}
        />
      ) : null}

      {moveProject && moveMenuPosition ? (
        <ProjectMoveWorkspaceMenu
          x={moveMenuPosition.x}
          y={moveMenuPosition.y}
          workspaces={workspaces}
          currentWorkspaceId={moveProject.workspaceId}
          onClose={handleMoveClose}
          onSelect={handleMoveSelect}
        />
      ) : null}

      {promptMode &&
      (promptMode === 'workspace' ||
        promptMode === 'workspace-rename' ||
        promptMode === 'workspace-icon' ||
        promptProject) ? (
        <ProjectPromptDialog
          mode={promptMode}
          initialValue={
            promptMode === 'rename' && promptProject
              ? promptProject.name
              : promptMode === 'workspace-rename' && promptWorkspace
                ? promptWorkspace.name
                : promptMode === 'workspace-icon' && promptWorkspace
                  ? promptWorkspace.icon
                  : (promptProject?.icon ?? '')
          }
          onConfirm={(value) => void handlePromptConfirm(value)}
          onClose={handlePromptClose}
        />
      ) : null}

      {colorProject ? (
        <ProjectColorPicker
          selectedColor={colorProject.color}
          onSelect={(color) => void handleColorSelect(color)}
          onClose={handleColorClose}
        />
      ) : null}

      {logoCrop && (logoCropProject || logoCropWorkspace) ? (
        <ProjectLogoCropDialog
          sourcePath={logoCrop.sourcePath}
          projectName={logoCropProject?.name ?? logoCropWorkspace?.name ?? ''}
          onConfirm={(dataUrl) => void handleLogoCropConfirm(dataUrl)}
          onClose={handleLogoCropClose}
        />
      ) : null}

      {projectToDelete ? (
        <ProjectDeleteDialog
          projectName={projectToDelete.name}
          onConfirm={handleDeleteConfirm}
          onClose={handleDeleteClose}
        />
      ) : null}

      {flagCreateProject || flagCreateWorkspace ? (
        <ProjectFlagCreateDialog
          projectName={flagCreateProject?.name ?? flagCreateWorkspace?.name ?? ''}
          entityLabel={flagCreateWorkspace ? 'workspace' : 'projeto'}
          onConfirm={handleFlagCreateConfirm}
          onClose={handleFlagCreateClose}
        />
      ) : null}

      {pendingFlagProject?.flag ? (
        <ProjectFlagWarningDialog
          projectName={pendingFlagProject.name}
          reason={pendingFlagProject.flag.reason}
          onDismiss={handleFlagAccessDismiss}
          onRemoveFlag={handleFlagAccessRemove}
          onClose={handleFlagAccessDismiss}
        />
      ) : null}

      {workspaceToDelete ? (
        <WorkspaceDeleteDialog
          workspaceName={workspaceToDelete.name}
          onConfirm={handleDeleteWorkspaceConfirm}
          onClose={handleDeleteWorkspaceClose}
        />
      ) : null}
    </aside>
  );
}

export const ProjectSidebar = memo(ProjectSidebarComponent);

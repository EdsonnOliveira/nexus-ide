import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, CirclePlay, Music, PanelLeft, Plus } from 'lucide-react';
import { useProjectIndexShortcuts } from '@/hooks/useProjectIndexShortcuts';
import { useProjectStore } from '@/stores/useProjectStore';
import { useProjectNotificationStore } from '@/stores/useProjectNotificationStore';
import { ProjectListItem } from '@/components/sidebar/ProjectListItem';
import { ProjectContextMenu } from '@/components/sidebar/ProjectContextMenu';
import { ProjectPromptDialog } from '@/components/sidebar/ProjectPromptDialog';
import { ProjectColorPicker } from '@/components/sidebar/ProjectColorPicker';
import { ProjectLogoCropDialog } from '@/components/sidebar/ProjectLogoCropDialog';
import { ProjectDeleteDialog } from '@/components/sidebar/ProjectDeleteDialog';
import { SidebarVideoLinkPopup } from '@/components/sidebar/SidebarVideoLinkPopup';
import { SidebarVideoPiP } from '@/components/sidebar/SidebarVideoPiP';
import { SidebarMusicPlayer } from '@/components/sidebar/SidebarMusicPlayer';
import { WorkspaceMenu } from '@/components/sidebar/WorkspaceMenu';
import type { SidebarVideoSession } from '@/utils/sidebarVideoProviders';
import { ProjectMoveWorkspaceMenu } from '@/components/sidebar/ProjectMoveWorkspaceMenu';
import { WorkspaceDeleteDialog } from '@/components/sidebar/WorkspaceDeleteDialog';
import type { ContextMenuState, ProjectPromptMode } from '@/types';

function ProjectSidebarComponent() {
  const projects = useProjectStore((state) => state.projects);
  const workspaces = useProjectStore((state) => state.workspaces);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeWorkspaceId = useProjectStore((state) => state.activeWorkspaceId);
  const addProject = useProjectStore((state) => state.addProject);
  const selectProject = useProjectStore((state) => state.selectProject);
  const updateProject = useProjectStore((state) => state.updateProject);
  const removeProject = useProjectStore((state) => state.removeProject);
  const createWorkspace = useProjectStore((state) => state.createWorkspace);
  const selectWorkspace = useProjectStore((state) => state.selectWorkspace);
  const removeWorkspace = useProjectStore((state) => state.removeWorkspace);
  const moveProjectToWorkspace = useProjectStore((state) => state.moveProjectToWorkspace);
  const toggleSidebar = useProjectStore((state) => state.toggleSidebar);
  const sidebarCollapsed = useProjectStore((state) => state.sidebarCollapsed);
  const notifiedProjectIds = useProjectNotificationStore((state) => state.notifiedProjectIds);

  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const videoButtonRef = useRef<HTMLButtonElement>(null);
  const skipWorkspaceListAnimationRef = useRef(true);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceMenuRect, setWorkspaceMenuRect] = useState<DOMRect | null>(null);
  const [videoPopupOpen, setVideoPopupOpen] = useState(false);
  const [videoPopupAnchor, setVideoPopupAnchor] = useState<DOMRect | null>(null);
  const [activeVideoSession, setActiveVideoSession] = useState<SidebarVideoSession | null>(null);
  const [musicPlayerOpen, setMusicPlayerOpen] = useState(false);
  const pipAnchorRef = useRef<HTMLDivElement>(null);
  const [pipAnchorHeight, setPipAnchorHeight] = useState<number | null>(null);
  const [projectListAnimationKey, setProjectListAnimationKey] = useState(0);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [promptMode, setPromptMode] = useState<ProjectPromptMode | null>(null);
  const [promptProjectId, setPromptProjectId] = useState<string | null>(null);
  const [colorProjectId, setColorProjectId] = useState<string | null>(null);
  const [logoCrop, setLogoCrop] = useState<{ projectId: string; sourcePath: string } | null>(null);
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);
  const [moveProjectId, setMoveProjectId] = useState<string | null>(null);
  const [moveMenuPosition, setMoveMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [deleteWorkspaceId, setDeleteWorkspaceId] = useState<string | null>(null);

  const filteredProjects = useMemo(() => {
    if (activeWorkspaceId === null) {
      return projects;
    }

    return projects.filter((project) => project.workspaceId === activeWorkspaceId);
  }, [activeWorkspaceId, projects]);

  const workspaceFilterLabel = useMemo(() => {
    if (activeWorkspaceId === null) {
      return 'Todos os projetos';
    }

    return workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.name ?? 'Todos os projetos';
  }, [activeWorkspaceId, workspaces]);

  const canMoveProject = workspaces.length > 1;
  const canDeleteWorkspace = workspaces.length > 1;

  useEffect(() => {
    if (skipWorkspaceListAnimationRef.current) {
      skipWorkspaceListAnimationRef.current = false;
      return;
    }

    setProjectListAnimationKey((key) => key + 1);
  }, [activeWorkspaceId]);

  const contextProject = useMemo(
    () => projects.find((project) => project.id === contextMenu?.projectId) ?? null,
    [contextMenu?.projectId, projects],
  );

  const promptProject = useMemo(
    () => projects.find((project) => project.id === promptProjectId) ?? null,
    [promptProjectId, projects],
  );

  const colorProject = useMemo(
    () => projects.find((project) => project.id === colorProjectId) ?? null,
    [colorProjectId, projects],
  );

  const logoCropProject = useMemo(
    () => projects.find((project) => project.id === logoCrop?.projectId) ?? null,
    [logoCrop?.projectId, projects],
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

  const handleStartVideoSession = useCallback((session: SidebarVideoSession) => {
    setActiveVideoSession(session);
  }, []);

  const handleCloseVideoSession = useCallback(() => {
    setActiveVideoSession(null);
    setPipAnchorHeight(null);
  }, []);

  const handlePipAnchorSizeChange = useCallback((size: { width: number; height: number } | null) => {
    setPipAnchorHeight(size?.height ?? null);
  }, []);

  const handleToggleMusicPlayer = useCallback(() => {
    setMusicPlayerOpen((current) => !current);
  }, []);

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

  const handleDeleteWorkspace = useCallback((workspaceId: string) => {
    setDeleteWorkspaceId(workspaceId);
  }, []);

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
      void selectProject(id);
    },
    [selectProject],
  );

  useProjectIndexShortcuts({ filteredProjects, onSelectProject: handleSelectProject });

  const handleContextMenu = useCallback((project: { id: string }, x: number, y: number) => {
    setContextMenu({ projectId: project.id, x, y });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

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
        await window.nexus.projects.saveLogoFromDataUrl(logoCrop.projectId, dataUrl);
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
  }, []);

  const handlePromptConfirm = useCallback(
    async (value: string) => {
      if (promptMode === 'workspace') {
        await createWorkspace(value);
        setPromptMode(null);
        setPromptProjectId(null);
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
    [createWorkspace, promptMode, promptProjectId, updateProject],
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
          className='sidebar__filter'
          title={workspaceFilterLabel}
          onClick={handleOpenWorkspaceMenu}
        >
          <span>{workspaceFilterLabel}</span>
          <ChevronDown size={14} />
        </button>
      </div>

      <div className='sidebar__list'>
        {filteredProjects.map((project, index) => (
          <ProjectListItem
            key={project.id}
            project={project}
            isActive={project.id === activeProjectId}
            hasNotification={Boolean(notifiedProjectIds[project.id])}
            enterIndex={index}
            enterAnimationKey={projectListAnimationKey}
            onSelect={handleSelectProject}
            onContextMenu={handleContextMenu}
          />
        ))}
      </div>

      <div className='sidebar__footer'>
        {activeVideoSession ? (
          <>
            <div
              ref={pipAnchorRef}
              className='sidebar-video-pip-anchor'
              style={pipAnchorHeight ? { height: `${pipAnchorHeight}px` } : undefined}
              aria-hidden='true'
            />
            <SidebarVideoPiP
              session={activeVideoSession}
              anchorRef={pipAnchorRef}
              onAnchorSizeChange={handlePipAnchorSizeChange}
              onClose={handleCloseVideoSession}
            />
          </>
        ) : null}

        {musicPlayerOpen ? <SidebarMusicPlayer /> : null}

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
        </div>
      </div>

      {videoPopupOpen && videoPopupAnchor ? (
        <SidebarVideoLinkPopup
          anchorRect={videoPopupAnchor}
          onClose={handleCloseVideoPopup}
          onStart={handleStartVideoSession}
        />
      ) : null}

      {workspaceMenuOpen && workspaceMenuRect ? (
        <WorkspaceMenu
          anchorRect={workspaceMenuRect}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          canDeleteWorkspace={canDeleteWorkspace}
          onClose={handleCloseWorkspaceMenu}
          onSelect={handleSelectWorkspace}
          onCreate={handleCreateWorkspace}
          onDelete={handleDeleteWorkspace}
        />
      ) : null}

      {contextMenu && contextProject ? (
        <ProjectContextMenu
          project={contextProject}
          x={contextMenu.x}
          y={contextMenu.y}
          canMoveWorkspace={canMoveProject}
          onClose={handleCloseContextMenu}
          onSetLogo={(projectId) => void handleSetLogo(projectId)}
          onRemoveLogo={(projectId) => void handleRemoveLogo(projectId)}
          onSetIcon={handleSetIcon}
          onSetIconColor={handleSetIconColor}
          onRename={handleRename}
          onMove={handleMove}
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

      {promptMode && (promptMode === 'workspace' || promptProject) ? (
        <ProjectPromptDialog
          mode={promptMode}
          initialValue={promptMode === 'rename' && promptProject ? promptProject.name : promptProject?.icon ?? ''}
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

      {logoCrop && logoCropProject ? (
        <ProjectLogoCropDialog
          sourcePath={logoCrop.sourcePath}
          projectName={logoCropProject.name}
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

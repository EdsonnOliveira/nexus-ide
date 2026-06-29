import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { useNexusReady } from '@/hooks/useNexusReady';
import { useAutomationScheduler } from '@/hooks/useAutomationScheduler';
import { flushTerminalSessionsNow } from '@/utils/persistTerminalSession';
import { flushAgentGitGroupsNow } from '@/utils/persistAgentGitGroups';
import { bumpFileExternalRevision } from '@/utils/fileExternalRevision';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTabActions } from '@/stores/useTabStore';
import { isMarkdownFile } from '@/utils/explorerRelativePath';
import { EmptyState } from '@/components/overlay/EmptyState';
import { PaneErrorBoundary } from '@/components/overlay/PaneErrorBoundary';
import { ProjectSidebar } from '@/components/sidebar/ProjectSidebar';
import { StatusBar } from '@/components/layout/StatusBar';
import { GlobalSearchPalette } from '@/components/search/GlobalSearchPalette';
import { useGlobalSearchStore } from '@/stores/useGlobalSearchStore';
import { isAnyModalOpen, subscribeOverlayBlockingChange } from '@/utils/overlayBlocking';

const TerminalPanel = lazy(() =>
  import('@/components/terminal/TerminalPanel').then((module) => ({
    default: module.TerminalPanel,
  })),
);

const ProjectExplorerDrawer = lazy(() =>
  import('@/components/explorer/ProjectExplorerDrawer').then((module) => ({
    default: module.ProjectExplorerDrawer,
  })),
);

const ProjectAutomationsDrawer = lazy(() =>
  import('@/components/automations/ProjectAutomationsDrawer').then((module) => ({
    default: module.ProjectAutomationsDrawer,
  })),
);

const ProjectTasksDrawer = lazy(() =>
  import('@/components/tasks/ProjectTasksDrawer').then((module) => ({
    default: module.ProjectTasksDrawer,
  })),
);

const ProjectPasswordsDrawer = lazy(() =>
  import('@/components/passwords/ProjectPasswordsDrawer').then((module) => ({
    default: module.ProjectPasswordsDrawer,
  })),
);

function EmptyWorkspace() {
  const addProject = useProjectStore((state) => state.addProject);

  const handleAddProject = useCallback(() => {
    void addProject();
  }, [addProject]);

  return (
    <EmptyState
      icon={FolderPlus}
      title='Nenhum projeto adicionado'
      message='Adicione um projeto para começar'
    >
      <button type='button' className='empty-state__action empty-state__action--primary app-button app-button--enter' onClick={handleAddProject}>
        Adicionar projeto
      </button>
    </EmptyState>
  );
}

function AppShellComponent() {
  const nexusReady = useNexusReady();
  const initialize = useProjectStore((state) => state.initialize);
  const toggleExplorer = useProjectStore((state) => state.toggleExplorer);
  const toggleGlobalSearch = useGlobalSearchStore((state) => state.toggle);
  const [isModalOpen, setIsModalOpen] = useState(isAnyModalOpen);
  const sidebarCollapsed = useProjectStore((state) => state.sidebarCollapsed);
  const sidePanel = useProjectStore((state) => state.sidePanel);
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );
  const projectPaths = useMemo(() => projects.map((project) => project.path), [projects]);
  const { openFileTab, openFilePreviewTab, openFileCodeTab, openDiffTab, selectPane } = useTabActions();

  const handleOpenExplorerFile = useCallback(
    (entry: { path: string; name: string }) => {
      if (isMarkdownFile(entry.name)) {
        void openFilePreviewTab(entry.path, entry.name);
        return;
      }

      void openFileTab(entry.path, entry.name);
    },
    [openFilePreviewTab, openFileTab],
  );

  const handleOpenExplorerFileCode = useCallback(
    (entry: { path: string; name: string }) => {
      void openFileCodeTab(entry.path, entry.name);
    },
    [openFileCodeTab],
  );

  const handleOpenGitDiff = useCallback(
    (
      filePath: string,
      options: { staged: boolean; untracked?: boolean; repoPath?: string; agentPrompt?: string },
    ) => {
      void openDiffTab(filePath, options);
    },
    [openDiffTab],
  );

  const isCollapsed = sidebarCollapsed;

  useAutomationScheduler();

  const isMac = useMemo(
    () => typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.platform),
    [],
  );

  const shellClassName = useMemo(() => {
    const classes = ['app-shell'];

    if (isCollapsed) {
      classes.push('app-shell--collapsed');
    }

    if (isMac) {
      classes.push('app-shell--mac');
    }

    if (activeProject) {
      classes.push('app-shell--has-project');
    }

    if (isModalOpen) {
      classes.push('app-shell--modal-open');
    }

    return classes.join(' ');
  }, [activeProject, isCollapsed, isMac, isModalOpen]);

  useEffect(() => {
    const syncModalOpen = () => {
      setIsModalOpen(isAnyModalOpen());
    };

    syncModalOpen();
    return subscribeOverlayBlockingChange(syncModalOpen);
  }, []);

  useEffect(() => {
    if (!nexusReady) {
      return;
    }

    void initialize();
  }, [initialize, nexusReady]);

  useEffect(() => {
    if (!nexusReady) {
      return;
    }

    const unsubscribe = window.nexus.onFlushSession(() => {
      void Promise.all([flushTerminalSessionsNow(), flushAgentGitGroupsNow()]).then(() =>
        window.nexus.session.flushComplete(),
      );
    });

    return unsubscribe;
  }, [nexusReady]);

  useEffect(() => {
    if (!nexusReady) {
      return;
    }

    const unsubscribe = window.nexus.onOpenGlobalSearch(() => {
      toggleGlobalSearch();
    });

    return unsubscribe;
  }, [nexusReady, toggleGlobalSearch]);

  useEffect(() => {
    if (!nexusReady) {
      return;
    }

    const unsubscribe = window.nexus.onToggleExplorer(() => {
      if (!useProjectStore.getState().activeProjectId) {
        return;
      }

      toggleExplorer();
    });

    return unsubscribe;
  }, [nexusReady, toggleExplorer]);

  useEffect(() => {
    if (!nexusReady || projectPaths.length === 0) {
      return;
    }

    projectPaths.forEach((projectPath) => {
      void window.nexus.files.watchProject(projectPath);
    });

    const unsubscribe = window.nexus.files.onProjectChange((payload) => {
      if (payload.changedPath) {
        bumpFileExternalRevision(payload.changedPath);
      }
    });

    return () => {
      unsubscribe();

      projectPaths.forEach((projectPath) => {
        void window.nexus.files.unwatchProject(projectPath);
      });
    };
  }, [nexusReady, projectPaths]);

  if (!nexusReady) {
    return <div className='app-loading'>Carregando...</div>;
  }

  return (
    <div className={shellClassName}>
      {isMac && <div className='titlebar' aria-hidden='true' />}

      <ProjectSidebar />

      <div className='app-main'>
        {activeProject ? (
          <div className='glass-panel glass-panel--main'>
            <PaneErrorBoundary>
              <Suspense fallback={<div className='empty-state'>Carregando...</div>}>
                <TerminalPanel />
              </Suspense>
            </PaneErrorBoundary>
          </div>
        ) : (
          <div className='glass-panel glass-panel--empty'>
            <EmptyWorkspace />
          </div>
        )}
      </div>

      {activeProject ? (
        <div
          className={`project-explorer-slot side-panel-slot${sidePanel ? ' project-explorer-slot--open side-panel-slot--open' : ''}`}
          aria-hidden={!sidePanel}
        >
          <Suspense
            fallback={
              <div className='project-explorer__loading'>
                {sidePanel === 'passwords'
                  ? 'Carregando formulário...'
                  : sidePanel === 'automations'
                    ? 'Carregando automações...'
                    : sidePanel === 'tasks'
                      ? 'Carregando tarefas...'
                      : 'Carregando explorador...'}
              </div>
            }
          >
            {sidePanel === 'explorer' ? (
              <ProjectExplorerDrawer
                projectId={activeProject.id}
                rootPath={activeProject.path}
                onOpenFile={handleOpenExplorerFile}
                onOpenFileCode={handleOpenExplorerFileCode}
                onSelectPane={selectPane}
                onOpenDiff={handleOpenGitDiff}
              />
            ) : null}
            {sidePanel === 'passwords' ? (
              <ProjectPasswordsDrawer projectId={activeProject.id} />
            ) : null}
            {sidePanel === 'automations' ? (
              <ProjectAutomationsDrawer projectId={activeProject.id} />
            ) : null}
            {sidePanel === 'tasks' ? <ProjectTasksDrawer projectId={activeProject.id} /> : null}
          </Suspense>
        </div>
      ) : null}

      <StatusBar />
      <GlobalSearchPalette />
    </div>
  );
}

export const AppShell = memo(AppShellComponent);

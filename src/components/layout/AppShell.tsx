import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { useNexusReady } from '@/hooks/useNexusReady';
import { useGitChangeCount } from '@/hooks/useGitChangeCount';
import { useAutomationScheduler } from '@/hooks/useAutomationScheduler';
import { useTestRunnerEvents } from '@/hooks/useTestRunnerEvents';
import { flushTerminalSessionsNow } from '@/utils/persistTerminalSession';
import { flushAgentGitGroupsNow } from '@/utils/persistAgentGitGroups';
import { bumpFileExternalRevision } from '@/utils/fileExternalRevision';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTabActions } from '@/stores/useTabStore';
import { isMarkdownFile } from '@/utils/explorerRelativePath';
import { NexusLogo } from '@/components/overlay/NexusLogo';
import { EmptyState } from '@/components/overlay/EmptyState';
import { PaneErrorBoundary } from '@/components/overlay/PaneErrorBoundary';
import { ProjectSidebar } from '@/components/sidebar/ProjectSidebar';
import { StatusBar } from '@/components/layout/StatusBar';
import { TitleBar } from '@/components/layout/TitleBar';
import { GlobalSearchPalette } from '@/components/search/GlobalSearchPalette';
import { DailyGenerationProvider } from '@/components/home/DailyGenerationProvider';
import { CalendarEventAlertHost } from '@/components/sidebar/CalendarEventAlertHost';
import { AppToastHost } from '@/components/overlay/AppToastHost';
import { useGlobalSearchStore } from '@/stores/useGlobalSearchStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { projectHasLiveAgentSession } from '@/utils/paneAgentSession';
import { isAnyModalOpen, subscribeOverlayBlockingChange } from '@/utils/overlayBlocking';

const LazyHomeDashboard = lazy(() =>
  import('@/components/home/HomeDashboard').then((module) => ({
    default: module.HomeDashboard,
  })),
);

const LazyTerminalPanel = lazy(() =>
  import('@/components/terminal/TerminalPanel').then((module) => ({
    default: module.TerminalPanel,
  })),
);

function MainWorkspacePanel({ ready }: { ready: boolean }) {
  if (!ready) {
    return <div className='empty-state'>Carregando...</div>;
  }

  return (
    <Suspense fallback={<div className='empty-state'>Carregando...</div>}>
      <LazyTerminalPanel />
    </Suspense>
  );
}

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

const ProjectTestsDrawer = lazy(() =>
  import('@/components/tests/ProjectTestsDrawer').then((module) => ({
    default: module.ProjectTestsDrawer,
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
      <button
        type='button'
        className='empty-state__action empty-state__action--primary app-button app-button--enter'
        onClick={handleAddProject}
      >
        Adicionar projeto
      </button>
    </EmptyState>
  );
}

function AppShellComponent() {
  const nexusReady = useNexusReady();
  useTestRunnerEvents();
  const initialize = useProjectStore((state) => state.initialize);
  const toggleExplorerEntry = useProjectStore((state) => state.toggleExplorerEntry);
  const toggleGlobalSearch = useGlobalSearchStore((state) => state.toggle);
  const [isModalOpen, setIsModalOpen] = useState(isAnyModalOpen);
  const sidebarCollapsed = useProjectStore((state) => state.sidebarCollapsed);
  const sidePanel = useProjectStore((state) => state.sidePanel);
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const initialized = useProjectStore((state) => state.initialized);
  const projectsMigrated = useProjectStore((state) => state.projectsMigrated);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );
  const agentPrintRunTokenByPane = useTerminalSessionStore((state) => state.agentPrintRunTokenByPane);
  const agentBusyByPane = useTerminalSessionStore((state) => state.agentBusyByPane);
  const awaitingResponseByPane = useTerminalSessionStore((state) => state.awaitingResponseByPane);
  const needsOffscreenAgentHost = useMemo(() => {
    if (activeProjectId) {
      return false;
    }

    const hasBusyPane =
      Object.values(agentBusyByPane).some(Boolean) ||
      Object.values(awaitingResponseByPane).some(Boolean) ||
      Object.values(agentPrintRunTokenByPane).some(Boolean);

    if (!hasBusyPane) {
      return false;
    }

    const session = {
      agentPrintRunTokenByPane,
      agentBusyByPane,
      awaitingResponseByPane,
    };

    return projects.some((project) => projectHasLiveAgentSession(project, session));
  }, [
    activeProjectId,
    agentBusyByPane,
    agentPrintRunTokenByPane,
    awaitingResponseByPane,
    projects,
  ]);
  const gitChangeCount = useGitChangeCount(
    projectsMigrated ? (activeProject?.path ?? null) : null,
  );
  const projectPaths = useMemo(() => projects.map((project) => project.path), [projects]);
  const { openFileTab, openFilePreviewTab, openFileCodeTab, openDiffTab, openBrowserTab, selectPane } =
    useTabActions();

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
      const timeoutId = window.setTimeout(() => {
        void window.nexus.session.flushComplete();
      }, 4000);

      void Promise.all([flushTerminalSessionsNow(), flushAgentGitGroupsNow()])
        .catch((error) => {
          console.error('[app-shell] flush session failed', error);
        })
        .finally(() => {
          window.clearTimeout(timeoutId);
          void window.nexus.session.flushComplete();
        });
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

    const unsubscribe = window.nexus.browser.onOpenInTab((url) => {
      void openBrowserTab(url);
    });

    return unsubscribe;
  }, [nexusReady, openBrowserTab]);

  useEffect(() => {
    if (!nexusReady) {
      return;
    }

    const unsubscribe = window.nexus.onToggleExplorer(() => {
      if (!useProjectStore.getState().activeProjectId) {
        return;
      }

      toggleExplorerEntry(gitChangeCount > 0);
    });

    return unsubscribe;
  }, [gitChangeCount, nexusReady, toggleExplorerEntry]);

  useEffect(() => {
    if (!nexusReady || !projectsMigrated || projectPaths.length === 0) {
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
  }, [nexusReady, projectPaths, projectsMigrated]);

  if (!nexusReady) {
    return (
      <div className='app-loading'>
        <div className='app-loading__brand app-button--enter'>
          <NexusLogo size={48} className='nexus-brand-logo app-loading__logo' />
          <span>Carregando...</span>
        </div>
      </div>
    );
  }

  return (
    <DailyGenerationProvider>
      <div className={shellClassName}>
      {isMac ? <TitleBar /> : null}

      <ProjectSidebar />

      <div className='app-main'>
        {activeProject || needsOffscreenAgentHost ? (
          <div
            className={`glass-panel${activeProject ? ' glass-panel--main' : ' app-shell__hidden-agent-host'}`}
            hidden={!activeProject || undefined}
            aria-hidden={!activeProject || undefined}
          >
            <PaneErrorBoundary>
              {initialized && projectsMigrated ? (
                <MainWorkspacePanel ready={initialized && projectsMigrated} />
              ) : (
                <div className='empty-state'>Carregando...</div>
              )}
            </PaneErrorBoundary>
          </div>
        ) : null}
        {!activeProject ? (
          <div className='glass-panel glass-panel--empty glass-panel--home'>
            {projects.length === 0 ? (
              <EmptyWorkspace />
            ) : (
              <Suspense fallback={<div className='empty-state'>Carregando...</div>}>
                <LazyHomeDashboard />
              </Suspense>
            )}
          </div>
        ) : null}
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
                      : sidePanel === 'tests'
                        ? 'Carregando testes...'
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
            {sidePanel === 'tests' ? <ProjectTestsDrawer projectId={activeProject.id} /> : null}
          </Suspense>
        </div>
      ) : null}

      <StatusBar />
      <GlobalSearchPalette />
      <CalendarEventAlertHost />
      <AppToastHost />
      </div>
    </DailyGenerationProvider>
  );
}

export const AppShell = memo(AppShellComponent);

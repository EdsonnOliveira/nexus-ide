import { lazy, memo, Suspense, useCallback, useEffect, useMemo } from 'react';
import { useNexusReady } from '@/hooks/useNexusReady';
import { flushTerminalSessionsNow } from '@/utils/persistTerminalSession';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTabActions } from '@/stores/useTabStore';
import { ProjectSidebar } from '@/components/sidebar/ProjectSidebar';
import { StatusBar } from '@/components/layout/StatusBar';

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

const ProjectGitDrawer = lazy(() =>
  import('@/components/git/ProjectGitDrawer').then((module) => ({
    default: module.ProjectGitDrawer,
  })),
);

function EmptyWorkspace() {
  const addProject = useProjectStore((state) => state.addProject);

  const handleAddProject = useCallback(() => {
    void addProject();
  }, [addProject]);

  return (
    <div className='empty-state'>
      <span className='empty-state__title'>Nenhum projeto adicionado</span>
      <span>Adicione um projeto para começar</span>
      <button type='button' className='empty-state__action empty-state__action--primary app-button app-button--enter' onClick={handleAddProject}>
        Adicionar projeto
      </button>
    </div>
  );
}

function AppShellComponent() {
  const nexusReady = useNexusReady();
  const initialize = useProjectStore((state) => state.initialize);
  const toggleSidebar = useProjectStore((state) => state.toggleSidebar);
  const sidebarCollapsed = useProjectStore((state) => state.sidebarCollapsed);
  const sidePanel = useProjectStore((state) => state.sidePanel);
  const projects = useProjectStore((state) => state.projects);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );
  const { openFileTab, openDiffTab } = useTabActions();

  const handleOpenExplorerFile = useCallback(
    (entry: { path: string; name: string }) => {
      void openFileTab(entry.path, entry.name);
    },
    [openFileTab],
  );

  const handleOpenGitDiff = useCallback(
    (filePath: string, staged: boolean) => {
      void openDiffTab(filePath, staged);
    },
    [openDiffTab],
  );

  const isCollapsed = sidebarCollapsed;

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

    return classes.join(' ');
  }, [activeProject, isCollapsed, isMac]);

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
      void flushTerminalSessionsNow().then(() => window.nexus.session.flushComplete());
    });

    return unsubscribe;
  }, [nexusReady]);

  useEffect(() => {
    if (!nexusReady) {
      return;
    }

    const unsubscribe = window.nexus.onToggleSidebar(() => {
      void toggleSidebar();
    });

    return unsubscribe;
  }, [nexusReady, toggleSidebar]);

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
            <Suspense fallback={<div className='empty-state'>Carregando...</div>}>
              <TerminalPanel />
            </Suspense>
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
                {sidePanel === 'git' ? 'Carregando Git...' : 'Carregando explorador...'}
              </div>
            }
          >
            {sidePanel === 'explorer' ? (
              <ProjectExplorerDrawer
                rootPath={activeProject.path}
                onOpenFile={handleOpenExplorerFile}
              />
            ) : null}
            {sidePanel === 'git' ? (
              <ProjectGitDrawer rootPath={activeProject.path} onOpenDiff={handleOpenGitDiff} />
            ) : null}
          </Suspense>
        </div>
      ) : null}

      <StatusBar />
    </div>
  );
}

export const AppShell = memo(AppShellComponent);

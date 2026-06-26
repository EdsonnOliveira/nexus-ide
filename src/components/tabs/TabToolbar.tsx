import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderTree, GitBranch, ListTodo, Lock, Plus, Search, Workflow } from 'lucide-react';
import { GLOBAL_SEARCH_NAME } from '@/constants/globalSearch';
import { useProjectStore } from '@/stores/useProjectStore';
import { useGlobalSearchStore } from '@/stores/useGlobalSearchStore';
import { useTabActions } from '@/stores/useTabStore';
import { TabAddMenu, type TabAddOptionId } from '@/components/tabs/TabAddMenu';
import { resolveAgentLaunchCommand } from '@/utils/resolveAgentLaunchCommand';
import { useGitChangeCount } from '@/hooks/useGitChangeCount';
import { countProjectTasksForToolbarBadge } from '@/utils/taskFilters';

function TabSearchBadgeComponent() {
  const openGlobalSearch = useGlobalSearchStore((state) => state.open);
  const isGlobalSearchOpen = useGlobalSearchStore((state) => state.isOpen);

  const handleOpenGlobalSearch = useCallback(() => {
    openGlobalSearch();
  }, [openGlobalSearch]);

  return (
    <button
      type='button'
      className={`tab-toolbar__search-badge app-button app-button--enter${isGlobalSearchOpen ? ' tab-toolbar__search-badge--active' : ''}`}
      aria-label={GLOBAL_SEARCH_NAME}
      onClick={handleOpenGlobalSearch}
    >
      <Search size={13} strokeWidth={2.25} aria-hidden='true' />
      <span className='app-button__label'>{GLOBAL_SEARCH_NAME}</span>
    </button>
  );
}

export const TabSearchBadge = memo(TabSearchBadgeComponent);

function TabToolbarComponent() {
  const { addTab, addAgentTab } = useTabActions();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const projects = useProjectStore((state) => state.projects);
  const sidePanel = useProjectStore((state) => state.sidePanel);
  const toggleExplorer = useProjectStore((state) => state.toggleExplorer);
  const toggleGitPanel = useProjectStore((state) => state.toggleGitPanel);
  const togglePasswords = useProjectStore((state) => state.togglePasswords);
  const toggleAutomations = useProjectStore((state) => state.toggleAutomations);
  const toggleTasks = useProjectStore((state) => state.toggleTasks);
  const activeProject = projects.find((item) => item.id === activeProjectId) ?? null;
  const gitChangeCount = useGitChangeCount(activeProject?.path ?? null);
  const openTaskCount = useMemo(() => {
    if (!activeProject) {
      return 0;
    }

    return countProjectTasksForToolbarBadge(activeProject.tasks ?? [], {
      useDefaultFilters: activeProject.taskIntegration?.platform === 'jira',
      jiraAccountName: activeProject.taskIntegration?.jiraAccountName,
    });
  }, [activeProject]);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);

  const handleToggleMenu = useCallback(() => {
    if (menuAnchor) {
      setMenuAnchor(null);
      return;
    }

    const rect = addButtonRef.current?.getBoundingClientRect();

    if (rect) {
      setMenuAnchor(rect);
    }
  }, [menuAnchor]);

  const handleCloseMenu = useCallback(() => {
    setMenuAnchor(null);
  }, []);

  const handleSelectTabOption = useCallback(
    (optionId: TabAddOptionId) => {
      if (optionId === 'agent') {
        void (async () => {
          const project = projects.find((item) => item.id === activeProjectId) ?? null;
          const command = await resolveAgentLaunchCommand(project?.path ?? null);
          await addAgentTab(command);
        })();
        return;
      }

      void addTab(optionId);
    },
    [activeProjectId, addAgentTab, addTab, projects],
  );

  useEffect(() => {
    const unsubscribe = window.nexus.onOpenTabAddMenu(() => {
      handleToggleMenu();
    });

    return unsubscribe;
  }, [handleToggleMenu]);

  return (
    <>
      <div className='tab-bar__tools'>
        <button
          ref={addButtonRef}
          type='button'
          className='tool-btn'
          aria-label='Nova aba'
          onClick={handleToggleMenu}
        >
          <Plus size={15} />
        </button>
        <button
          type='button'
          className={`tool-btn${sidePanel === 'explorer' ? ' tool-btn--active' : ''}`}
          aria-label='Explorador de arquivos'
          onClick={toggleExplorer}
        >
          <FolderTree size={15} />
        </button>
        <button
          type='button'
          className={`tool-btn tool-btn--git${sidePanel === 'git' ? ' tool-btn--active' : ''}`}
          aria-label='Controle de versão'
          onClick={toggleGitPanel}
        >
          <GitBranch size={15} />
          {gitChangeCount > 0 ? (
            <span className='tool-btn__badge' aria-hidden='true'>
              {gitChangeCount > 99 ? '99+' : gitChangeCount}
            </span>
          ) : null}
        </button>
        <button
          type='button'
          className={`tool-btn${sidePanel === 'passwords' ? ' tool-btn--active' : ''}`}
          aria-label='Formulário'
          onClick={togglePasswords}
        >
          <Lock size={15} />
        </button>
        <button
          type='button'
          className={`tool-btn${sidePanel === 'automations' ? ' tool-btn--active' : ''}`}
          aria-label='Automações'
          onClick={toggleAutomations}
        >
          <Workflow size={15} />
        </button>
        <button
          type='button'
          className={`tool-btn tool-btn--tasks${sidePanel === 'tasks' ? ' tool-btn--active' : ''}`}
          aria-label='Tarefas'
          onClick={toggleTasks}
        >
          <ListTodo size={15} />
          {openTaskCount > 0 ? (
            <span className='tool-btn__badge tool-btn__badge--tasks' aria-hidden='true'>
              {openTaskCount > 99 ? '99+' : openTaskCount}
            </span>
          ) : null}
        </button>
        <TabSearchBadge />
      </div>

      {menuAnchor ? (
        <TabAddMenu
          anchorRect={menuAnchor}
          onClose={handleCloseMenu}
          onSelect={handleSelectTabOption}
        />
      ) : null}
    </>
  );
}

export const TabToolbar = memo(TabToolbarComponent);

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FolderTree, Plus, Terminal } from 'lucide-react';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTabActions } from '@/stores/useTabStore';
import { TabAddMenu, type TabAddOptionId } from '@/components/tabs/TabAddMenu';
import { TerminalRestartMenu } from '@/components/tabs/TerminalRestartMenu';
import { resolveAgentLaunchCommand } from '@/utils/resolveAgentLaunchCommand';

function TabToolbarComponent() {
  const { addTab, addAgentTab } = useTabActions();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const projects = useProjectStore((state) => state.projects);
  const sidePanel = useProjectStore((state) => state.sidePanel);
  const toggleExplorer = useProjectStore((state) => state.toggleExplorer);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const terminalButtonRef = useRef<HTMLButtonElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const [terminalMenuAnchor, setTerminalMenuAnchor] = useState<DOMRect | null>(null);

  const handleToggleMenu = useCallback(() => {
    if (menuAnchor) {
      setMenuAnchor(null);
      return;
    }

    setTerminalMenuAnchor(null);

    const rect = addButtonRef.current?.getBoundingClientRect();

    if (rect) {
      setMenuAnchor(rect);
    }
  }, [menuAnchor]);

  const handleCloseMenu = useCallback(() => {
    setMenuAnchor(null);
  }, []);

  const handleToggleTerminalMenu = useCallback(() => {
    if (terminalMenuAnchor) {
      setTerminalMenuAnchor(null);
      return;
    }

    setMenuAnchor(null);

    const rect = terminalButtonRef.current?.getBoundingClientRect();

    if (rect) {
      setTerminalMenuAnchor(rect);
    }
  }, [terminalMenuAnchor]);

  const handleCloseTerminalMenu = useCallback(() => {
    setTerminalMenuAnchor(null);
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
          ref={terminalButtonRef}
          type='button'
          className={`tool-btn${terminalMenuAnchor ? ' tool-btn--active' : ''}`}
          aria-label='Reiniciar terminais'
          onClick={handleToggleTerminalMenu}
        >
          <Terminal size={15} />
        </button>
        <button
          type='button'
          className={`tool-btn${sidePanel === 'explorer' ? ' tool-btn--active' : ''}`}
          aria-label='Explorador de arquivos'
          onClick={toggleExplorer}
        >
          <FolderTree size={15} />
        </button>
      </div>

      {menuAnchor ? (
        <TabAddMenu
          anchorRect={menuAnchor}
          onClose={handleCloseMenu}
          onSelect={handleSelectTabOption}
        />
      ) : null}
      {terminalMenuAnchor ? (
        <TerminalRestartMenu anchorRect={terminalMenuAnchor} onClose={handleCloseTerminalMenu} />
      ) : null}
    </>
  );
}

export const TabToolbar = memo(TabToolbarComponent);

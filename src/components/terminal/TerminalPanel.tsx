import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Globe, Layers, Terminal } from 'lucide-react';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTabActions } from '@/stores/useTabStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { resolveAgentLaunchCommand } from '@/utils/resolveAgentLaunchCommand';
import { BrowserView } from '@/components/browser/BrowserView';
import { FileView } from '@/components/file/FileView';
import { TabStrip } from '@/components/tabs/TabStrip';
import { PanePortal } from '@/components/workspace/PanePortal';
import { PaneSlot } from '@/components/workspace/PaneSlot';
import { PaneSlotRegistryProvider } from '@/components/workspace/PaneSlotRegistry';
import { WorkspaceDropOverlay } from '@/components/workspace/WorkspaceDropOverlay';
import { TerminalFooter } from '@/components/terminal/TerminalFooter';
import { TerminalPasteImages } from '@/components/terminal/TerminalPasteImages';
import { XTermView, type XTermViewHandle } from '@/components/terminal/XTermView';
import { extractCliAgentCommand } from '@/constants/cliAgentCommands';
import { parseCdCommandLine } from '@/utils/terminalCwd';
import { collectProjectPanes, findPaneTab } from '@/utils/tabGroups';
import { persistTerminalCwd } from '@/utils/persistTerminalSession';
import { registerTerminalHandle } from '@/utils/terminalHandleRegistry';
import {
  createAgentReadyStreamDetector,
  createSettledCallback,
  trackAgentReadyDetectorReset,
  type AgentReadyStreamDetector,
} from '@/utils/terminalTaskCompletion';
import { createTerminalOutputParser } from '@/utils/terminalStream';
import { clampSplitRatio } from '@/utils/splitLayout';
import {
  isOverlayBlockingTerminalHints,
  subscribeOverlayBlockingChange,
} from '@/utils/overlayBlocking';
import type { Project, SplitLayoutNode, Tab, TabBarItem } from '@/types';

interface WorkspaceSplitProps {
  node: SplitLayoutNode;
  splitTabId: string;
  path: readonly number[];
  onRatioCommit: (splitTabId: string, path: readonly number[], ratio: number) => void;
}

interface TabPaneProps {
  tab: Tab;
  projectId: string;
  projectPath: string;
  isFocused: boolean;
  isVisible: boolean;
  terminalRef: (handle: XTermViewHandle | null) => void;
  onFocusPane: (paneId: string) => void;
  onPtyCreated: (ptyId: string) => void;
  onPtyLost: () => void;
  onBrowserUrlChange: (url: string) => void;
  onOpenLinkInBrowser: (url: string) => void;
}

const TabPane = memo(function TabPaneComponent({
  tab,
  projectId,
  projectPath,
  isFocused,
  isVisible,
  terminalRef,
  onFocusPane,
  onPtyCreated,
  onPtyLost,
  onBrowserUrlChange,
  onOpenLinkInBrowser,
}: TabPaneProps) {
  const terminalHandleRef = useRef<XTermViewHandle | null>(null);
  const [terminalCwd, setTerminalCwd] = useState(
    tab.type === 'terminal' && tab.terminalCwd ? tab.terminalCwd : projectPath,
  );
  const [hintsKeyboardActive, setHintsKeyboardActive] = useState(false);
  const [hintsActiveIndex, setHintsActiveIndex] = useState(0);
  const hintsCountRef = useRef(0);
  const storedActiveAgent = useTerminalSessionStore((state) => state.activeAgentByPane[tab.id] ?? null);
  const activeAgent = useMemo(() => {
    if (tab.type !== 'terminal') {
      return null;
    }

    const fromRestore = tab.restoreCommand ? extractCliAgentCommand(tab.restoreCommand) : null;

    return fromRestore ?? storedActiveAgent ?? null;
  }, [storedActiveAgent, tab]);

  useEffect(() => {
    if (tab.type === 'terminal' && tab.terminalCwd) {
      setTerminalCwd(tab.terminalCwd);
      return;
    }

    setTerminalCwd(projectPath);
  }, [projectPath, tab]);

  useEffect(() => {
    if (!isFocused) {
      setHintsKeyboardActive(false);
    }
  }, [isFocused]);

  useEffect(() => {
    return subscribeOverlayBlockingChange(() => {
      if (isOverlayBlockingTerminalHints()) {
        setHintsKeyboardActive(false);
      }
    });
  }, []);

  const handleHintsCountChange = useCallback((count: number) => {
    hintsCountRef.current = count;

    if (count === 0) {
      setHintsKeyboardActive(false);
    }
  }, []);

  const handleFocusHints = useCallback(() => {
    if (isOverlayBlockingTerminalHints() || hintsCountRef.current === 0) {
      return;
    }

    setHintsKeyboardActive(true);
    setHintsActiveIndex(0);
  }, []);

  const handleFocusHintsWhenFocused = useCallback(() => {
    if (!isFocused) {
      return;
    }

    handleFocusHints();
  }, [handleFocusHints, isFocused]);

  const handleDismissHints = useCallback((focusTerminal = true) => {
    setHintsKeyboardActive(false);

    if (focusTerminal) {
      terminalHandleRef.current?.focus();
    }
  }, []);

  const handleTerminalRef = useCallback(
    (handle: XTermViewHandle | null) => {
      terminalHandleRef.current = handle;
      terminalRef(handle);
    },
    [terminalRef],
  );

  const handleCwdChange = useCallback((nextCwd: string) => {
    setTerminalCwd(nextCwd);

    if (tab.type === 'terminal') {
      persistTerminalCwd(tab.id, nextCwd);
    }
  }, [tab]);

  const handlePtyLost = useCallback(() => {
    const { pendingLaunchCommands, setActiveAgent } = useTerminalSessionStore.getState();

    if (!pendingLaunchCommands[tab.id]) {
      setActiveAgent(tab.id, null);
    }

    onPtyLost();
  }, [onPtyLost, tab.id]);

  const handleRunCommand = useCallback(
    (command: string) => {
      const commandLine = command.replace(/\n$/, '');

      if (commandLine) {
        useTerminalSessionStore.getState().markAwaitingResponse(tab.id);
        useTerminalSessionStore.getState().setLastCommand(tab.id, commandLine);
      }

      terminalHandleRef.current?.write(command);

      const target = parseCdCommandLine(commandLine);

      if (!target) {
        return;
      }

      void window.nexus.files.resolveCdPath(terminalCwd, target).then(setTerminalCwd);
    },
    [tab.id, terminalCwd],
  );

  const handleMouseDown = useCallback(() => {
    onFocusPane(tab.id);
  }, [onFocusPane, tab.id]);

  if (tab.type === 'browser') {
    return (
      <div className='workspace-pane' onMouseDown={handleMouseDown}>
        <BrowserView
          projectId={projectId}
          url={tab.url}
          isVisible={isVisible}
          isFocused={isFocused}
          onUrlChange={onBrowserUrlChange}
        />
      </div>
    );
  }

  if (tab.type === 'file') {
    return (
      <div className='workspace-pane workspace-pane--file' onMouseDown={handleMouseDown}>
        <FileView tab={tab} isVisible={isVisible} />
      </div>
    );
  }

  return (
    <div
      className={`workspace-pane terminal-panel__shell terminal-panel__shell--${tab.agent}`}
      onMouseDown={handleMouseDown}
    >
      <div className='terminal-panel__body'>
        <XTermView
          ref={handleTerminalRef}
          paneId={tab.id}
          ptyId={tab.ptyId}
          isVisible={isVisible}
          isFocused={isFocused}
          cwd={terminalCwd}
          agent={tab.agent}
          isAgentSession={Boolean(activeAgent)}
          onPtyCreated={onPtyCreated}
          onPtyLost={handlePtyLost}
          onCwdChange={handleCwdChange}
          onOpenLinkInBrowser={onOpenLinkInBrowser}
          onFocusHints={handleFocusHintsWhenFocused}
          hintsKeyboardActive={hintsKeyboardActive && isFocused}
        />
      </div>
      <TerminalPasteImages paneId={tab.id} isVisible={isVisible && Boolean(activeAgent)} />
      <TerminalFooter
        tab={tab}
        cwd={terminalCwd}
        isVisible={isVisible}
        keyboardActive={hintsKeyboardActive && isFocused}
        activeIndex={hintsActiveIndex}
        onActiveIndexChange={setHintsActiveIndex}
        onDismissKeyboard={handleDismissHints}
        onHintsCountChange={handleHintsCountChange}
        onRunCommand={handleRunCommand}
      />
    </div>
  );
});

const WorkspaceSplit = memo(function WorkspaceSplitComponent({
  node,
  splitTabId,
  path,
  onRatioCommit,
}: WorkspaceSplitProps) {
  const splitRef = useRef<HTMLDivElement>(null);
  const [liveRatio, setLiveRatio] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const splitRatio = node.type === 'split' ? (liveRatio ?? node.ratio) : 0.5;

  useEffect(() => {
    if (liveRatio === null) {
      return;
    }

    if (Math.abs(node.ratio - liveRatio) < 0.0001) {
      setLiveRatio(null);
    }
  }, [liveRatio, node.ratio]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (node.type !== 'split') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const divider = event.currentTarget;
      const container = splitRef.current;

      if (!container) {
        return;
      }

      divider.setPointerCapture(event.pointerId);

      const rect = container.getBoundingClientRect();
      const startX = event.clientX;
      const startRatio = liveRatio ?? node.ratio;

      setIsDragging(true);
      document.body.classList.add('workspace-split--resizing');

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - startX;
        const nextRatio = clampSplitRatio(startRatio + delta / rect.width);
        setLiveRatio(nextRatio);
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        divider.releasePointerCapture(upEvent.pointerId);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        document.body.classList.remove('workspace-split--resizing');
        setIsDragging(false);

        const delta = upEvent.clientX - startX;
        const nextRatio = clampSplitRatio(startRatio + delta / rect.width);
        setLiveRatio(nextRatio);
        onRatioCommit(splitTabId, path, nextRatio);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    },
    [liveRatio, node, onRatioCommit, path, splitTabId],
  );

  if (node.type !== 'split') {
    return <PaneSlot paneId={node.tabId} />;
  }

  return (
    <div ref={splitRef} className='workspace-split workspace-split--horizontal'>
      <div className='workspace-split__pane' style={{ flex: splitRatio }}>
        <WorkspaceSplit
          node={node.left}
          splitTabId={splitTabId}
          path={[...path, 0]}
          onRatioCommit={onRatioCommit}
        />
      </div>
      <div
        className={`workspace-split__divider${isDragging ? ' workspace-split__divider--dragging' : ''}`}
        role='separator'
        aria-orientation='vertical'
        aria-valuenow={Math.round(splitRatio * 100)}
        onPointerDown={handlePointerDown}
      />
      <div className='workspace-split__pane' style={{ flex: 1 - splitRatio }}>
        <WorkspaceSplit
          node={node.right}
          splitTabId={splitTabId}
          path={[...path, 1]}
          onRatioCommit={onRatioCommit}
        />
      </div>
    </div>
  );
});

function isPaneInActiveLayout(project: Project, isProjectActive: boolean, paneId: string): boolean {
  if (!isProjectActive) {
    return false;
  }

  const activeItem = project.tabs.find((item) => item.id === project.activeTabId);

  if (!activeItem) {
    return false;
  }

  if (activeItem.type === 'split') {
    return activeItem.panes.some((pane) => pane.id === paneId);
  }

  return activeItem.id === paneId;
}

function isPaneFocused(project: Project, isProjectActive: boolean, paneId: string): boolean {
  if (!isPaneInActiveLayout(project, isProjectActive, paneId)) {
    return false;
  }

  const activeItem = project.tabs.find((item) => item.id === project.activeTabId);

  if (!activeItem) {
    return false;
  }

  if (activeItem.type === 'split') {
    const activePaneId =
      project.activePaneId ?? activeItem.activePaneId ?? activeItem.panes[0]?.id ?? null;

    return activePaneId === paneId;
  }

  return true;
}

interface ProjectWorkspaceProps {
  project: Project;
  isProjectActive: boolean;
  terminalRefs: React.MutableRefObject<Record<string, XTermViewHandle | null>>;
  onFocusPane: (paneId: string) => void;
  onPtyCreated: (projectId: string, tabId: string, ptyId: string) => void;
  onPtyLost: (projectId: string, tabId: string) => void;
  onBrowserUrlChange: (projectId: string, tabId: string, url: string) => void;
  onOpenLinkInBrowser: (url: string) => void;
  onSplitRatioCommit: (
    splitTabId: string,
    path: readonly number[],
    ratio: number,
  ) => void;
}

const ProjectWorkspace = memo(function ProjectWorkspaceComponent({
  project,
  isProjectActive,
  terminalRefs,
  onFocusPane,
  onPtyCreated,
  onPtyLost,
  onBrowserUrlChange,
  onOpenLinkInBrowser,
  onSplitRatioCommit,
}: ProjectWorkspaceProps) {
  const projectPanes = useMemo(() => collectProjectPanes(project.tabs), [project.tabs]);

  const renderTabLayout = useCallback(
    (tabItem: TabBarItem) => {
      const isTabActive = isProjectActive && tabItem.id === project.activeTabId;

      if (tabItem.type === 'split') {
        return (
          <div
            key={tabItem.id}
            className={`terminal-panel__layout${isTabActive ? ' terminal-panel__layout--active' : ''}`}
          >
            <WorkspaceSplit
              node={tabItem.layout}
              splitTabId={tabItem.id}
              path={[]}
              onRatioCommit={onSplitRatioCommit}
            />
          </div>
        );
      }

      return (
        <div
          key={tabItem.id}
          className={`terminal-panel__layout${isTabActive ? ' terminal-panel__layout--active' : ''}`}
        >
          <PaneSlot paneId={tabItem.id} />
        </div>
      );
    },
    [isProjectActive, onSplitRatioCommit, project.activeTabId],
  );

  if (!project.tabs.length) {
    return null;
  }

  return (
    <PaneSlotRegistryProvider>
      <div
        className={`terminal-panel__view${isProjectActive ? ' terminal-panel__view--active' : ''}`}
      >
        {project.tabs.map(renderTabLayout)}
        {projectPanes.map((pane) => {
          const latestPane = findPaneTab(project.tabs, pane.id) ?? pane;
          const isVisible = isPaneInActiveLayout(project, isProjectActive, pane.id);
          const isFocused = isPaneFocused(project, isProjectActive, pane.id);

          return (
            <PanePortal key={pane.id} paneId={pane.id}>
              <TabPane
                tab={latestPane}
                projectId={project.id}
                projectPath={project.path}
                isFocused={isFocused}
                isVisible={isVisible}
                terminalRef={(handle) => {
                  terminalRefs.current[pane.id] = handle;
                  registerTerminalHandle(pane.id, handle);
                }}
                onFocusPane={onFocusPane}
                onPtyCreated={(ptyId) => onPtyCreated(project.id, pane.id, ptyId)}
                onPtyLost={() => onPtyLost(project.id, pane.id)}
                onBrowserUrlChange={(url) => onBrowserUrlChange(project.id, pane.id, url)}
                onOpenLinkInBrowser={onOpenLinkInBrowser}
              />
            </PanePortal>
          );
        })}
      </div>
    </PaneSlotRegistryProvider>
  );
});

interface PaneCompletionTracker {
  agentDetector: AgentReadyStreamDetector;
  parseShellPrompt: (chunk: string) => string;
  disposeReset: () => void;
}

function TerminalPanelComponent() {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const projects = useProjectStore((state) => state.projects);
  const completionTrackersRef = useRef(new Map<string, PaneCompletionTracker>());
  const { selectPane, updateBrowserUrl, splitTab, openBrowserTab, addTab, addAgentTab, setSplitRatio } =
    useTabActions();
  const setTabPtyId = useProjectStore((state) => state.setTabPtyId);
  const terminalRefs = useRef<Record<string, XTermViewHandle | null>>({});
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );

  const handlePtyLost = useCallback(
    (projectId: string, tabId: string) => {
      setTabPtyId(projectId, tabId, null);
    },
    [setTabPtyId],
  );

  const handlePtyCreated = useCallback(
    (projectId: string, tabId: string, ptyId: string) => {
      setTabPtyId(projectId, tabId, ptyId);
    },
    [setTabPtyId],
  );

  const handleFocusPane = useCallback(
    (paneId: string) => {
      void selectPane(paneId);
    },
    [selectPane],
  );

  const handleBrowserUrlChange = useCallback(
    (projectId: string, tabId: string, nextUrl: string) => {
      if (projectId !== activeProjectId) {
        return;
      }

      void updateBrowserUrl(tabId, nextUrl);
    },
    [activeProjectId, updateBrowserUrl],
  );

  const handleOpenLinkInBrowser = useCallback(
    (url: string) => {
      void openBrowserTab(url);
    },
    [openBrowserTab],
  );

  const handleTabDragStart = useCallback((tabId: string) => {
    setDraggedTabId(tabId);
  }, []);

  const handleTabDragEnd = useCallback(() => {
    setDraggedTabId(null);
  }, []);

  const handleWorkspaceDrop = useCallback(
    (sourceTabId: string, side: 'left' | 'right') => {
      if (!sourceTabId || !activeProject?.activeTabId) {
        return;
      }

      if (sourceTabId === activeProject.activeTabId) {
        return;
      }

      void splitTab(sourceTabId, activeProject.activeTabId, side);
      setDraggedTabId(null);
    },
    [activeProject?.activeTabId, splitTab],
  );

  const showDropOverlay = useMemo(() => {
    if (!draggedTabId || !activeProject?.activeTabId) {
      return false;
    }

    if (draggedTabId === activeProject.activeTabId) {
      return false;
    }

    return activeProject.tabs.length >= 2;
  }, [activeProject, draggedTabId]);

  useEffect(() => {
    if (!draggedTabId) {
      return;
    }

    const handleWindowDragEnd = () => {
      setDraggedTabId(null);
    };

    window.addEventListener('dragend', handleWindowDragEnd);

    return () => {
      window.removeEventListener('dragend', handleWindowDragEnd);
    };
  }, [draggedTabId]);

  const handleAddTerminal = useCallback(() => {
    void addTab('terminal');
  }, [addTab]);

  const handleAddBrowser = useCallback(() => {
    void addTab('browser');
  }, [addTab]);

  const resolveAgentCommand = useCallback(async (): Promise<string> => {
    return resolveAgentLaunchCommand(activeProject?.path ?? null);
  }, [activeProject?.path]);

  const handleAddAgent = useCallback(() => {
    void (async () => {
      const command = await resolveAgentCommand();
      await addAgentTab(command);
    })();
  }, [addAgentTab, resolveAgentCommand]);

  const handleSplitRatioCommit = useCallback(
    (splitTabId: string, path: readonly number[], ratio: number) => {
      void setSplitRatio(splitTabId, path, ratio);
    },
    [setSplitRatio],
  );

  useEffect(() => {
    const ptyToPane = new Map<string, string>();
    const activePaneIds = new Set<string>();

    for (const project of projects) {
      for (const pane of collectProjectPanes(project.tabs)) {
        if (pane.type !== 'terminal' || !pane.ptyId) {
          continue;
        }

        ptyToPane.set(pane.ptyId, pane.id);
        activePaneIds.add(pane.id);

        if (!completionTrackersRef.current.has(pane.id)) {
          const paneId = pane.id;
          const completeIfAwaiting = createSettledCallback(() => {
            useTerminalSessionStore.getState().completeTaskIfAwaiting(paneId);
          });
          const agentDetector = createAgentReadyStreamDetector(
            () => {
              useTerminalSessionStore.getState().completeTaskIfAwaiting(paneId);
            },
            {
              isAwaiting: () =>
                useTerminalSessionStore.getState().awaitingResponseByPane[paneId] === true,
            },
          );

          completionTrackersRef.current.set(paneId, {
            agentDetector,
            parseShellPrompt: createTerminalOutputParser(() => {}, completeIfAwaiting),
            disposeReset: trackAgentReadyDetectorReset(paneId, () => agentDetector.reset()),
          });
        }
      }
    }

    for (const [paneId, tracker] of completionTrackersRef.current.entries()) {
      if (!activePaneIds.has(paneId)) {
        tracker.disposeReset();
        completionTrackersRef.current.delete(paneId);
      }
    }

    const unsubscribe = window.nexus.terminal.onData((ptyId, data) => {
      const paneId = ptyToPane.get(ptyId);

      if (!paneId) {
        return;
      }

      const tracker = completionTrackersRef.current.get(paneId);

      if (!tracker) {
        return;
      }

      tracker.agentDetector.feed(data);
      tracker.parseShellPrompt(data);
    });

    return unsubscribe;
  }, [projects]);

  if (!activeProject) {
    return null;
  }

  const hasActiveProjectTabs = activeProject.tabs.length > 0;

  return (
    <div className='terminal-workspace'>
      <TabStrip onTabDragStart={handleTabDragStart} onTabDragEnd={handleTabDragEnd} />

      {!hasActiveProjectTabs ? (
        <div className='terminal-workspace__empty'>
          <div className='empty-state'>
            <div className='empty-state__icon' aria-hidden='true'>
              <Layers size={26} strokeWidth={1.75} />
            </div>
            <span className='empty-state__title'>Nenhuma aba aberta</span>
            <span>Crie um terminal, agent ou navegador para começar</span>
            <div className='workspace-empty-state__actions'>
              <button
                type='button'
                className='empty-state__action empty-state__action--terminal app-button app-button--enter'
                onClick={handleAddTerminal}
              >
                <Terminal size={14} />
                Terminal
              </button>
              <button
                type='button'
                className='empty-state__action empty-state__action--agent app-button app-button--enter'
                onClick={handleAddAgent}
              >
                <Bot size={14} />
                Agent
              </button>
              <button
                type='button'
                className='empty-state__action empty-state__action--browser app-button app-button--enter'
                onClick={handleAddBrowser}
              >
                <Globe size={14} />
                Navegador
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className='terminal-panel terminal-panel--split'>
          {projects.map((project) => (
            <ProjectWorkspace
              key={project.id}
              project={project}
              isProjectActive={project.id === activeProjectId}
              terminalRefs={terminalRefs}
              onFocusPane={handleFocusPane}
              onPtyCreated={handlePtyCreated}
              onPtyLost={handlePtyLost}
              onBrowserUrlChange={handleBrowserUrlChange}
              onOpenLinkInBrowser={handleOpenLinkInBrowser}
              onSplitRatioCommit={handleSplitRatioCommit}
            />
          ))}
          {showDropOverlay ? <WorkspaceDropOverlay onDrop={handleWorkspaceDrop} /> : null}
        </div>
      )}
    </div>
  );
}

export const TerminalPanel = memo(TerminalPanelComponent);

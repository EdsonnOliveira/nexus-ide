import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Braces, Clock, Globe, Layers, Play, Smartphone, Terminal } from 'lucide-react';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTabActions } from '@/stores/useTabStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { resolveAgentLaunchCommand } from '@/utils/resolveAgentLaunchCommand';
import { ApiView } from '@/components/api/ApiView';
import { BrowserView } from '@/components/browser/BrowserView';
import { EmulatorView } from '@/components/emulator/EmulatorView';
import { FileView } from '@/components/file/FileView';
import { TabStrip } from '@/components/tabs/TabStrip';
import { WorkspaceDropOverlay } from '@/components/workspace/WorkspaceDropOverlay';
import {
  useWorkspacePaneContext,
  WorkspacePaneProvider,
  type WorkspacePaneContextValue,
} from '@/components/workspace/WorkspacePaneContext';
import { TerminalFooter } from '@/components/terminal/TerminalFooter';
import { TerminalPasteImages } from '@/components/terminal/TerminalPasteImages';
import { XTermView } from '@/components/terminal/XTermView';
import type { XTermViewHandle } from '@/types';
import { extractCliAgentCommand } from '@/constants/cliAgentCommands';
import { parseCdCommandLine } from '@/utils/terminalCwd';
import { collectProjectPanes, findPaneTab, resolveActiveTabBarItem } from '@/utils/tabGroups';
import { useIsHomeAgentOverlayPane } from '@/hooks/useHomeAgentOverlayPanes';
import { persistTerminalCwd } from '@/utils/persistTerminalSession';
import { registerTerminalHandle } from '@/utils/terminalHandleRegistry';
import {
  completeShellIdleTaskIfAwaiting,
  createAgentReadyStreamDetector,
  dispatchPendingAgentTaskCommands,
  createSettledCallback,
  isPaneTrackingAgentCompletion,
  syncAgentBusyFromTail,
  trackAgentReadyDetectorReset,
  TURN_BUFFER_SIZE,
  type AgentReadyStreamDetector,
} from '@/utils/terminalTaskCompletion';
import { createTerminalOutputParser } from '@/utils/terminalStream';
import { clampSplitRatio } from '@/utils/splitLayout';
import { executeAutomation } from '@/utils/executeAutomation';
import { handleAutomationPaneShellPrompt } from '@/utils/automationPaneExecution';
import {
  feedMobileReleaseOutput,
  handleMobileReleaseShellPrompt,
  startMobileReleaseFromCommand,
} from '@/utils/mobileReleaseTracker';
import { completeAgentGitTurn, trackAgentGitPrompt } from '@/utils/agentGitTurn';
import { useAgentPrintBridge } from '@/hooks/useAgentPrintBridge';
import { useAgentGitChangeStore } from '@/stores/useAgentGitChangeStore';
import {
  isPaneAgentSessionLive,
  resolveHostedAgentProjects,
  type PaneAgentSessionSnapshot,
} from '@/utils/paneAgentSession';
import {
  isOverlayBlockingTerminalHints,
  subscribeOverlayBlockingChange,
} from '@/utils/overlayBlocking';
import { EXPLORER_ENTRY_DRAG_MIME } from '@/constants/explorerDrag';
import { mentionExplorerEntryInPane } from '@/utils/explorerAgentMention';
import {
  attachAgentPromptImagesToPane,
  readDroppedImageDataUrls,
  readImagePathAsDataUrl,
} from '@/utils/attachAgentPromptImage';
import {
  buildAgentComposerMentionsAppendFragment,
  resolveAgentComposerDropMentions,
} from '@/utils/agentComposerDrop';
import { writeAgentPaneDraft } from '@/utils/agentPaneRegistry';
import {
  getExplorerDragEntryPath,
  isExplorerInternalDrag,
  isExternalFileDrag,
  resolveExplorerDropEffect,
} from '@/utils/explorerExternalDrop';
import {
  buildRunningAgentProjectIdSet,
  resolvePaneAgentCommand,
  shouldMarkAgentAwaiting,
} from '@/utils/projectAgentStatus';
import type { ApiTab, EmulatorTab, Project, SplitLayoutNode, Tab, TabBarItem, AgentTab } from '@/types';

const LazyAgentView = lazy(() =>
  import('@/components/agent/AgentView').then((module) => ({ default: module.AgentView })),
);

const LazyBrainView = lazy(() =>
  import('@/components/brain/BrainView').then((module) => ({ default: module.BrainView })),
);

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
  isRuntimeActive: boolean;
  terminalRef: (handle: XTermViewHandle | null) => void;
  onFocusPane: (paneId: string) => void;
  onPtyCreated: (ptyId: string) => void;
  onPtyLost: () => void;
  onBrowserUrlChange: (url: string) => void;
  onOpenLinkInBrowser: (url: string) => void;
  onUpdateEmulatorTab: (
    tabId: string,
    patch: Partial<Pick<EmulatorTab, 'platform' | 'deviceId' | 'sessionId' | 'title'>>,
  ) => void;
  onUpdateApiTab: (
    tabId: string,
    patch: Partial<Pick<ApiTab, 'requestId' | 'collectionId' | 'title'>>,
  ) => void;
  onUpdateAgentTab: (
    tabId: string,
    patch: Partial<Pick<AgentTab, 'turns' | 'workingDirectory' | 'restoreCommand' | 'cliAgent' | 'title'>>,
  ) => void;
}

const TabPane = memo(function TabPaneComponent({
  tab,
  projectId,
  projectPath,
  isFocused,
  isVisible,
  isRuntimeActive,
  terminalRef,
  onFocusPane,
  onPtyCreated,
  onPtyLost,
  onBrowserUrlChange,
  onOpenLinkInBrowser,
  onUpdateEmulatorTab,
  onUpdateApiTab,
  onUpdateAgentTab,
}: TabPaneProps) {
  const { selectPane } = useTabActions();
  const isDedicatedAgentTab = tab.type === 'agent';
  const isAgentTab = isDedicatedAgentTab || (tab.type === 'terminal' && tab.agent !== 'shell');
  const terminalHandleRef = useRef<XTermViewHandle | null>(null);
  const [terminalCwd, setTerminalCwd] = useState(
    tab.type === 'terminal' && tab.terminalCwd ? tab.terminalCwd : projectPath,
  );
  const [hintsKeyboardActive, setHintsKeyboardActive] = useState(false);
  const [hintsActiveIndex, setHintsActiveIndex] = useState(0);
  const [explorerDropActive, setExplorerDropActive] = useState(false);
  const hintsCountRef = useRef(0);
  const storedActiveAgent = useTerminalSessionStore((state) => state.activeAgentByPane[tab.id] ?? null);
  const activeAgent = useMemo(() => {
    if (tab.type === 'agent') {
      return tab.cliAgent;
    }

    if (tab.type !== 'terminal') {
      return null;
    }

    const fromRestore = tab.restoreCommand ? extractCliAgentCommand(tab.restoreCommand) : null;

    return fromRestore ?? storedActiveAgent ?? null;
  }, [storedActiveAgent, tab]);
  const isAgentSession = isDedicatedAgentTab || isAgentTab || Boolean(activeAgent);

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

  useEffect(() => {
    if (!explorerDropActive) {
      return;
    }

    const handleDragEnd = () => {
      setExplorerDropActive(false);
    };

    window.addEventListener('dragend', handleDragEnd);

    return () => {
      window.removeEventListener('dragend', handleDragEnd);
    };
  }, [explorerDropActive]);

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
        const session = useTerminalSessionStore.getState();

        if (shouldMarkAgentAwaiting(tab.id, commandLine, session.activeAgentByPane)) {
          session.setLastCommand(tab.id, commandLine);
          trackAgentGitPrompt(tab.id, commandLine);
          session.markAwaitingResponse(tab.id);
        } else {
          session.setLastCommand(tab.id, commandLine);
        }

        void startMobileReleaseFromCommand(tab.id, commandLine);
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

  const handleExplorerDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!isAgentSession) {
        return;
      }

      const isExplorerDrag = isExplorerInternalDrag(event.dataTransfer);
      const isFileDrag = isExternalFileDrag(event.dataTransfer);

      if (!isExplorerDrag && !isFileDrag) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = resolveExplorerDropEffect(event.dataTransfer.effectAllowed);
      setExplorerDropActive(true);
    },
    [isAgentSession],
  );

  const handleExplorerDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const related = event.relatedTarget as Node | null;

    if (!event.currentTarget.contains(related)) {
      setExplorerDropActive(false);
    }
  }, []);

  const handleExplorerDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!isAgentSession) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setExplorerDropActive(false);

      if (isExplorerInternalDrag(event.dataTransfer)) {
        const entryPath = getExplorerDragEntryPath(event.dataTransfer);

        if (!entryPath) {
          return;
        }

        void mentionExplorerEntryInPane(projectPath, tab.id, entryPath, selectPane);
        return;
      }

      if (!isExternalFileDrag(event.dataTransfer)) {
        return;
      }

      void (async () => {
        const dataUrls = await readDroppedImageDataUrls(event.dataTransfer);

        if (dataUrls.length > 0) {
          await attachAgentPromptImagesToPane(projectPath, tab.id, dataUrls);
        }

        const mentions = await resolveAgentComposerDropMentions(projectPath, event.dataTransfer, {
          includeImages: false,
        });

        if (mentions.length > 0) {
          writeAgentPaneDraft(tab.id, buildAgentComposerMentionsAppendFragment('', mentions));
        }
      })();
    },
    [isAgentSession, projectPath, selectPane, tab.id],
  );

  if (tab.type === 'browser') {
    return (
      <div className='workspace-pane' onMouseDown={handleMouseDown}>
        <BrowserView
          projectId={projectId}
          url={tab.url}
          isVisible={isVisible}
          isRuntimeActive={isRuntimeActive}
          isFocused={isFocused}
          onUrlChange={onBrowserUrlChange}
        />
      </div>
    );
  }

  if (tab.type === 'file') {
    return (
      <div className='workspace-pane workspace-pane--file' onMouseDown={handleMouseDown}>
        <FileView tab={tab} isVisible={isVisible} projectId={projectId} />
      </div>
    );
  }

  if (tab.type === 'emulator') {
    return (
      <div className='workspace-pane workspace-pane--emulator' onMouseDown={handleMouseDown}>
        <EmulatorView
          tab={tab}
          isVisible={isVisible}
          isRuntimeActive={isRuntimeActive}
          isFocused={isFocused}
          onFocusPane={onFocusPane}
          onUpdateTab={onUpdateEmulatorTab}
        />
      </div>
    );
  }

  if (tab.type === 'api') {
    return (
      <div className='workspace-pane workspace-pane--api' onMouseDown={handleMouseDown}>
        <ApiView
          tab={tab}
          projectId={projectId}
          isVisible={isVisible}
          isRuntimeActive={isRuntimeActive}
          isFocused={isFocused}
          onFocusPane={onFocusPane}
          onUpdateTab={onUpdateApiTab}
        />
      </div>
    );
  }

  if (tab.type === 'agent') {
    return (
      <div
        className={`workspace-pane workspace-pane--agent-slot${explorerDropActive ? ' workspace-pane--explorer-drop-target' : ''}`}
        onMouseDown={handleMouseDown}
        onDragOver={handleExplorerDragOver}
        onDragLeave={handleExplorerDragLeave}
        onDrop={handleExplorerDrop}
      >
        <Suspense fallback={null}>
          <LazyAgentView
            tab={tab}
            projectId={projectId}
            projectPath={projectPath}
            isVisible={isVisible}
            isRuntimeActive={isRuntimeActive}
            isFocused={isFocused}
            onFocusPane={() => onFocusPane(tab.id)}
            onPtyCreated={onPtyCreated}
            onPtyLost={onPtyLost}
            onUpdateTab={(patch) => onUpdateAgentTab(tab.id, patch)}
          />
        </Suspense>
      </div>
    );
  }

  if (tab.type !== 'terminal') {
    return null;
  }

  return (
    <div
      className={`workspace-pane terminal-panel__shell terminal-panel__shell--${tab.agent}${explorerDropActive ? ' workspace-pane--explorer-drop-target' : ''}`}
      onMouseDown={handleMouseDown}
      onDragOver={isAgentSession ? handleExplorerDragOver : undefined}
      onDragLeave={isAgentSession ? handleExplorerDragLeave : undefined}
      onDrop={isAgentSession ? handleExplorerDrop : undefined}
    >
      <div className='terminal-panel__body'>
        <XTermView
          ref={handleTerminalRef}
          paneId={tab.id}
          projectPath={projectPath}
          ptyId={tab.ptyId}
          isVisible={isVisible}
          isRuntimeActive={isRuntimeActive}
          isFocused={isFocused}
          cwd={terminalCwd}
          agent={tab.agent}
          isAgentSession={isAgentSession}
          onPtyCreated={onPtyCreated}
          onPtyLost={handlePtyLost}
          onCwdChange={handleCwdChange}
          onOpenLinkInBrowser={onOpenLinkInBrowser}
          onFocusHints={handleFocusHintsWhenFocused}
          hintsKeyboardActive={hintsKeyboardActive && isFocused}
          restoreCommand={tab.restoreCommand}
        />
      </div>
      <TerminalPasteImages
        paneId={tab.id}
        projectPath={projectPath}
        isVisible={isVisible && isAgentSession}
      />
      <TerminalFooter
        tab={tab}
        projectId={projectId}
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

const ProjectPaneSlot = memo(function ProjectPaneSlotComponent({ paneId }: { paneId: string }) {
  const {
    project,
    isProjectActive,
    terminalRefs,
    onFocusPane,
    onPtyCreated,
    onPtyLost,
    onBrowserUrlChange,
    onOpenLinkInBrowser,
    onUpdateEmulatorTab,
    onUpdateApiTab,
    onUpdateAgentTab,
    isPaneVisible,
    isPaneFocused,
    isPaneRuntimeActive,
  } = useWorkspacePaneContext();
  const isHomeOverlayPane = useIsHomeAgentOverlayPane(paneId);

  const tab = findPaneTab(project.tabs, paneId);

  const handleTerminalRef = useCallback(
    (handle: XTermViewHandle | null) => {
      terminalRefs.current[paneId] = handle;
      registerTerminalHandle(paneId, handle);
    },
    [paneId, terminalRefs],
  );

  if (!tab) {
    return <div className='workspace-pane workspace-pane--slot' />;
  }

  if (!isProjectActive && tab.type === 'agent' && isHomeOverlayPane) {
    return <div className='workspace-pane workspace-pane--slot' />;
  }

  return (
    <div className='workspace-pane workspace-pane--slot'>
      <TabPane
        tab={tab}
        projectId={project.id}
        projectPath={project.path}
        isFocused={isPaneFocused(paneId)}
        isVisible={isPaneVisible(paneId)}
        isRuntimeActive={isPaneRuntimeActive(paneId)}
        terminalRef={handleTerminalRef}
        onFocusPane={onFocusPane}
        onPtyCreated={(ptyId) => onPtyCreated(project.id, paneId, ptyId)}
        onPtyLost={() => onPtyLost(project.id, paneId)}
        onBrowserUrlChange={(url) => onBrowserUrlChange(project.id, paneId, url)}
        onOpenLinkInBrowser={onOpenLinkInBrowser}
        onUpdateEmulatorTab={onUpdateEmulatorTab}
        onUpdateApiTab={onUpdateApiTab}
        onUpdateAgentTab={onUpdateAgentTab}
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
    if (liveRatio === null || node.type !== 'split') {
      return;
    }

    if (Math.abs(node.ratio - liveRatio) < 0.0001) {
      setLiveRatio(null);
    }
  }, [liveRatio, node]);

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
    return <ProjectPaneSlot paneId={node.tabId} />;
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

const KEEP_ALIVE_PANE_TYPES = new Set<Tab['type']>([
  'browser',
  'terminal',
  'agent',
  'emulator',
]);

function shouldKeepTabAlive(item: TabBarItem): boolean {
  if (item.type === 'split') {
    return item.panes.some((pane) => KEEP_ALIVE_PANE_TYPES.has(pane.type));
  }

  return KEEP_ALIVE_PANE_TYPES.has(item.type);
}

function isPaneInActiveLayout(project: Project, isProjectActive: boolean, paneId: string): boolean {
  if (!isProjectActive) {
    return false;
  }

  const activeItem = resolveActiveTabBarItem(project.tabs, project.activeTabId);

  if (!activeItem) {
    return false;
  }

  if (activeItem.type === 'split') {
    return activeItem.panes.some((pane) => pane.id === paneId);
  }

  return activeItem.id === paneId;
}

function isPaneRuntimeActive(
  project: Project,
  isProjectActive: boolean,
  paneId: string,
  agentSession: PaneAgentSessionSnapshot,
): boolean {
  const pane = findPaneTab(project.tabs, paneId);

  if (!pane) {
    return false;
  }

  if (isPaneAgentSessionLive(paneId, agentSession)) {
    return true;
  }

  if (!isProjectActive) {
    return false;
  }

  if (pane.type === 'agent') {
    return true;
  }

  if (pane.type === 'terminal' && pane.ptyId) {
    return true;
  }

  return isPaneInActiveLayout(project, true, paneId);
}

function shouldKeepTabAliveForProject(
  item: TabBarItem,
  isProjectActive: boolean,
  agentSession: PaneAgentSessionSnapshot,
): boolean {
  if (isProjectActive) {
    return shouldKeepTabAlive(item);
  }

  if (item.type === 'split') {
    return item.panes.some(
      (pane) => pane.type === 'agent' && isPaneAgentSessionLive(pane.id, agentSession),
    );
  }

  return item.type === 'agent' && isPaneAgentSessionLive(item.id, agentSession);
}

function isPaneFocused(project: Project, isProjectActive: boolean, paneId: string): boolean {
  if (!isPaneInActiveLayout(project, isProjectActive, paneId)) {
    return false;
  }

  const activeItem = resolveActiveTabBarItem(project.tabs, project.activeTabId);

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
  agentSession: PaneAgentSessionSnapshot;
  terminalRefs: React.MutableRefObject<Record<string, XTermViewHandle | null>>;
  onFocusPane: (paneId: string) => void;
  onPtyCreated: (projectId: string, tabId: string, ptyId: string) => void;
  onPtyLost: (projectId: string, tabId: string) => void;
  onBrowserUrlChange: (projectId: string, tabId: string, url: string) => void;
  onOpenLinkInBrowser: (url: string) => void;
  onUpdateEmulatorTab: (
    tabId: string,
    patch: Partial<Pick<EmulatorTab, 'platform' | 'deviceId' | 'sessionId' | 'title'>>,
  ) => void;
  onUpdateApiTab: (
    tabId: string,
    patch: Partial<Pick<ApiTab, 'requestId' | 'collectionId' | 'title'>>,
  ) => void;
  onUpdateAgentTab: (
    tabId: string,
    patch: Partial<Pick<AgentTab, 'turns' | 'workingDirectory' | 'restoreCommand' | 'cliAgent' | 'title'>>,
  ) => void;
  onSplitRatioCommit: (
    splitTabId: string,
    path: readonly number[],
    ratio: number,
  ) => void;
}

const ProjectWorkspace = memo(function ProjectWorkspaceComponent({
  project,
  isProjectActive,
  agentSession,
  terminalRefs,
  onFocusPane,
  onPtyCreated,
  onPtyLost,
  onBrowserUrlChange,
  onOpenLinkInBrowser,
  onUpdateEmulatorTab,
  onUpdateApiTab,
  onUpdateAgentTab,
  onSplitRatioCommit,
}: ProjectWorkspaceProps) {
  const activeTabItem = useMemo(() => {
    const resolved = resolveActiveTabBarItem(project.tabs, project.activeTabId);

    if (resolved) {
      return resolved;
    }

    return project.tabs[project.tabs.length - 1] ?? project.tabs[0] ?? null;
  }, [project.activeTabId, project.tabs]);

  const isPaneVisibleForProject = useCallback(
    (paneId: string) => isPaneInActiveLayout(project, isProjectActive, paneId),
    [isProjectActive, project],
  );

  const isPaneFocusedForProject = useCallback(
    (paneId: string) => isPaneFocused(project, isProjectActive, paneId),
    [isProjectActive, project],
  );

  const isPaneRuntimeActiveForProject = useCallback(
    (paneId: string) => isPaneRuntimeActive(project, isProjectActive, paneId, agentSession),
    [agentSession, isProjectActive, project],
  );

  const workspacePaneContext = useMemo<WorkspacePaneContextValue>(
    () => ({
      project,
      isProjectActive,
      terminalRefs,
      onFocusPane,
      onPtyCreated,
      onPtyLost,
      onBrowserUrlChange,
      onOpenLinkInBrowser,
      onUpdateEmulatorTab,
      onUpdateApiTab,
      onUpdateAgentTab,
      isPaneVisible: isPaneVisibleForProject,
      isPaneFocused: isPaneFocusedForProject,
      isPaneRuntimeActive: isPaneRuntimeActiveForProject,
    }),
    [
      isPaneFocusedForProject,
      isPaneRuntimeActiveForProject,
      isPaneVisibleForProject,
      isProjectActive,
      onBrowserUrlChange,
      onFocusPane,
      onOpenLinkInBrowser,
      onPtyCreated,
      onPtyLost,
      onUpdateApiTab,
      onUpdateAgentTab,
      onUpdateEmulatorTab,
      project,
      terminalRefs,
    ],
  );

  const renderTabLayout = useCallback(
    (tabItem: TabBarItem) => {
      const isTabActive = isProjectActive && tabItem.id === activeTabItem?.id;

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
          <ProjectPaneSlot paneId={tabItem.id} />
        </div>
      );
    },
    [activeTabItem?.id, isProjectActive, onSplitRatioCommit],
  );

  const keptAliveTabs = useMemo(
    () =>
      project.tabs.filter((item) =>
        shouldKeepTabAliveForProject(item, isProjectActive, agentSession),
      ),
    [agentSession, isProjectActive, project.tabs],
  );

  if (!project.tabs.length || !activeTabItem) {
    return null;
  }

  const activeIsKeptAlive = shouldKeepTabAliveForProject(
    activeTabItem,
    isProjectActive,
    agentSession,
  );

  return (
    <WorkspacePaneProvider value={workspacePaneContext}>
      <div
        className={`terminal-panel__view${isProjectActive ? ' terminal-panel__view--active' : ''}`}
      >
        {isProjectActive && !activeIsKeptAlive ? renderTabLayout(activeTabItem) : null}
        {keptAliveTabs.map((tabItem) => renderTabLayout(tabItem))}
      </div>
    </WorkspacePaneProvider>
  );
});

interface PaneCompletionTracker {
  agentDetector: AgentReadyStreamDetector;
  parseShellPrompt: (chunk: string) => string;
  busyBuffer: string;
  resetBusyBuffer: () => void;
  disposeReset: () => void;
}

function TerminalPanelComponent() {
  useAgentPrintBridge();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const sidePanel = useProjectStore((state) => state.sidePanel);
  const projects = useProjectStore((state) => state.projects);
  const agentPrintRunTokenByPane = useTerminalSessionStore((state) => state.agentPrintRunTokenByPane);
  const agentBusyByPane = useTerminalSessionStore((state) => state.agentBusyByPane);
  const awaitingResponseByPane = useTerminalSessionStore((state) => state.awaitingResponseByPane);
  const agentSession = useMemo<PaneAgentSessionSnapshot>(
    () => ({
      agentPrintRunTokenByPane,
      agentBusyByPane,
      awaitingResponseByPane,
    }),
    [agentBusyByPane, agentPrintRunTokenByPane, awaitingResponseByPane],
  );
  const completionTrackersRef = useRef(new Map<string, PaneCompletionTracker>());
  const ptyToPaneRef = useRef(new Map<string, string>());
  const paneByIdRef = useRef(new Map<string, Tab>());
  const { selectPane, updateBrowserUrl, updateEmulatorTab, updateApiTab, updateAgentTab, splitTab, openBrowserTab, addTab, addAgentTab, setSplitRatio } =
    useTabActions();
  const setTabPtyId = useProjectStore((state) => state.setTabPtyId);
  const terminalRefs = useRef<Record<string, XTermViewHandle | null>>({});
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [paneHostReady, setPaneHostReady] = useState(false);

  useEffect(() => {
    if (paneHostReady) {
      return;
    }

    let cancelled = false;
    let idleId = 0;
    const rafId = requestAnimationFrame(() => {
      idleId = window.requestIdleCallback(
        () => {
          if (!cancelled) {
            setPaneHostReady(true);
          }
        },
        { timeout: 200 },
      );
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (idleId) {
        window.cancelIdleCallback(idleId);
      }
    };
  }, [paneHostReady]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );
  const hostedProjects = useMemo(
    () => resolveHostedAgentProjects(projects, activeProjectId, agentSession),
    [activeProjectId, agentSession, projects],
  );
  const toggleAutomations = useProjectStore((state) => state.toggleAutomations);
  const featuredAutomations = useMemo(
    () => (activeProject?.automations ?? []).slice(0, 5),
    [activeProject?.automations],
  );
  const hasMoreAutomations = (activeProject?.automations?.length ?? 0) > 5;

  const handleRunAutomation = useCallback(
    (automationId: string) => {
      if (!activeProject) {
        return;
      }

      const automation = (activeProject.automations ?? []).find((entry) => entry.id === automationId);

      if (!automation) {
        return;
      }

      void executeAutomation(automation, activeProject.id);
    },
    [activeProject],
  );

  const handleOpenAutomationsDrawer = useCallback(() => {
    toggleAutomations();
  }, [toggleAutomations]);

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
      if (!sourceTabId || !activeProject) {
        return;
      }

      const activeTabItem = resolveActiveTabBarItem(activeProject.tabs, activeProject.activeTabId);

      if (!activeTabItem) {
        return;
      }

      if (sourceTabId === activeTabItem.id) {
        return;
      }

      void splitTab(sourceTabId, activeTabItem.id, side);
      setDraggedTabId(null);
    },
    [activeProject, splitTab],
  );

  const showDropOverlay = useMemo(() => {
    if (!draggedTabId || !activeProject) {
      return false;
    }

    const activeTabItem = resolveActiveTabBarItem(activeProject.tabs, activeProject.activeTabId);

    if (!activeTabItem) {
      return false;
    }

    if (draggedTabId === activeTabItem.id) {
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

  const handleUpdateEmulatorTab = useCallback(
    (
      tabId: string,
      patch: Partial<Pick<EmulatorTab, 'platform' | 'deviceId' | 'sessionId' | 'title'>>,
    ) => {
      void updateEmulatorTab(tabId, patch);
    },
    [updateEmulatorTab],
  );

  const handleUpdateApiTab = useCallback(
    (tabId: string, patch: Partial<Pick<ApiTab, 'requestId' | 'collectionId' | 'title'>>) => {
      void updateApiTab(tabId, patch);
    },
    [updateApiTab],
  );

  const handleUpdateAgentTab = useCallback(
    (
      tabId: string,
      patch: Partial<Pick<AgentTab, 'turns' | 'workingDirectory' | 'restoreCommand' | 'cliAgent' | 'title'>>,
    ) => {
      void updateAgentTab(tabId, patch);
    },
    [updateAgentTab],
  );

  const handleAddApi = useCallback(() => {
    void addTab('api');
  }, [addTab]);

  const handleAddTerminal = useCallback(() => {
    void addTab('terminal');
  }, [addTab]);

  const handleAddBrowser = useCallback(() => {
    void addTab('browser');
  }, [addTab]);

  const handleAddEmulator = useCallback(() => {
    void addTab('emulator');
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
    if (!paneHostReady || !activeProject) {
      return;
    }

    const ptyToPane = new Map<string, string>();
    const paneById = new Map<string, Tab>();
    ptyToPaneRef.current = ptyToPane;
    paneByIdRef.current = paneById;
    const trackedPaneIds = new Set<string>();
    const activeProjectPaneIds = activeProject
      ? new Set(collectProjectPanes(activeProject.tabs).map((pane) => pane.id))
      : new Set<string>();

    for (const project of activeProject ? [activeProject] : []) {
      for (const pane of collectProjectPanes(project.tabs)) {
        paneById.set(pane.id, pane);

        if (pane.type !== 'terminal' && pane.type !== 'agent') {
          continue;
        }

        if (!pane.ptyId) {
          continue;
        }

        ptyToPane.set(pane.ptyId, pane.id);

        if (!activeProjectPaneIds.has(pane.id)) {
          continue;
        }

        trackedPaneIds.add(pane.id);

        if (!completionTrackersRef.current.has(pane.id)) {
          const paneId = pane.id;
          const completeIfAwaiting = createSettledCallback(() => {
            completeShellIdleTaskIfAwaiting(paneId);
            handleAutomationPaneShellPrompt(paneId);
            handleMobileReleaseShellPrompt(paneId);
          });
          const agentDetector = createAgentReadyStreamDetector(
            () => {
              completeAgentGitTurn(paneId);
              useTerminalSessionStore.getState().completeTaskIfAwaiting(paneId);

              const session = useTerminalSessionStore.getState();
              const paneEntry = paneByIdRef.current.get(paneId);

              if (!paneEntry || (paneEntry.type !== 'terminal' && paneEntry.type !== 'agent')) {
                return;
              }

              const ptyId = paneEntry.ptyId;

              if (!ptyId || !session.activeAgentByPane[paneId]) {
                return;
              }

              dispatchPendingAgentTaskCommands(paneId, (command) => {
                void startMobileReleaseFromCommand(paneId, command);
                window.nexus.terminal.write(ptyId, `${command}\n`);
              });
            },
            {
              isAwaiting: () => {
                const session = useTerminalSessionStore.getState();
                return isPaneTrackingAgentCompletion(
                  paneId,
                  session.awaitingResponseByPane,
                  session.agentNotifyEligibleByPane,
                  session.agentBusyByPane,
                );
              },
              isBlocked: () => {
                const session = useTerminalSessionStore.getState();
                const pending = useAgentGitChangeStore.getState().pendingTurnByPane[paneId];

                if (pending) {
                  return false;
                }

                return Boolean(session.agentBusyByPane[paneId]);
              },
            },
          );

          const tracker: PaneCompletionTracker = {
            agentDetector,
            parseShellPrompt: createTerminalOutputParser(() => {}, completeIfAwaiting),
            busyBuffer: '',
            resetBusyBuffer() {
              this.busyBuffer = '';
            },
            disposeReset: trackAgentReadyDetectorReset(paneId, () => {
              agentDetector.reset();
              tracker.resetBusyBuffer();
            }),
          };

          completionTrackersRef.current.set(paneId, tracker);
        }
      }
    }

    for (const [paneId, tracker] of completionTrackersRef.current.entries()) {
      if (!trackedPaneIds.has(paneId)) {
        tracker.disposeReset();
        completionTrackersRef.current.delete(paneId);
      }
    }

  }, [activeProject, paneHostReady]);

  useEffect(() => {
    if (!paneHostReady) {
      return;
    }

    const unsubscribe = window.nexus.terminal.onData((ptyId, data) => {
      const paneId = ptyToPaneRef.current.get(ptyId);

      if (!paneId) {
        return;
      }

      const tracker = completionTrackersRef.current.get(paneId);

      if (!tracker) {
        return;
      }

      tracker.agentDetector.feed(data);
      tracker.parseShellPrompt(data);
      feedMobileReleaseOutput(paneId, data);
      tracker.busyBuffer = (tracker.busyBuffer + data).slice(-TURN_BUFFER_SIZE);

      const session = useTerminalSessionStore.getState();
      const hasActiveAgent = Boolean(session.activeAgentByPane[paneId]);

      syncAgentBusyFromTail(
        paneId,
        tracker.busyBuffer,
        hasActiveAgent,
        session.setAgentBusy,
        () => {
          useTerminalSessionStore.getState().markAgentNotifyEligible(paneId);
        },
        () => {
          completeAgentGitTurn(paneId);
        },
      );
    });

    return unsubscribe;
  }, [paneHostReady]);

  useEffect(() => {
    if (!paneHostReady || !activeProject) {
      return;
    }

    for (const pane of collectProjectPanes(activeProject.tabs)) {
      if ((pane.type !== 'terminal' && pane.type !== 'agent') || !pane.ptyId) {
        continue;
      }

      const paneId = pane.id;
      const tracker = completionTrackersRef.current.get(paneId);

      void window.nexus.terminal.getScrollbackTail(pane.ptyId, TURN_BUFFER_SIZE).then((scrollback) => {
        const tail = (scrollback ?? '').slice(-TURN_BUFFER_SIZE);
        const session = useTerminalSessionStore.getState();

        if (tracker && tail) {
          tracker.busyBuffer = tail;
        }

        syncAgentBusyFromTail(
          paneId,
          tail,
          Boolean(session.activeAgentByPane[paneId]),
          session.setAgentBusy,
        );
      });
    }
  }, [activeProject, hostedProjects, paneHostReady]);

  if (!activeProject && hostedProjects.length === 0) {
    return null;
  }

  const hasActiveProjectTabs = Boolean(activeProject?.tabs.length);
  const isBrainOpen = Boolean(activeProject) && sidePanel === 'brain';

  return (
    <div className='terminal-workspace'>
      {activeProject ? (
        <TabStrip onTabDragStart={handleTabDragStart} onTabDragEnd={handleTabDragEnd} />
      ) : null}

      {isBrainOpen ? (
        <>
          <Suspense fallback={<div className='empty-state'>Carregando Cérebro...</div>}>
            <LazyBrainView />
          </Suspense>
          {paneHostReady && hostedProjects.length > 0 ? (
            <div className='terminal-panel__offscreen-host' hidden aria-hidden='true'>
              {hostedProjects.map((project) => (
                <ProjectWorkspace
                  key={project.id}
                  project={project}
                  isProjectActive={false}
                  agentSession={agentSession}
                  terminalRefs={terminalRefs}
                  onFocusPane={handleFocusPane}
                  onPtyCreated={handlePtyCreated}
                  onPtyLost={handlePtyLost}
                  onBrowserUrlChange={handleBrowserUrlChange}
                  onOpenLinkInBrowser={handleOpenLinkInBrowser}
                  onUpdateEmulatorTab={handleUpdateEmulatorTab}
                  onUpdateApiTab={handleUpdateApiTab}
                  onUpdateAgentTab={handleUpdateAgentTab}
                  onSplitRatioCommit={handleSplitRatioCommit}
                />
              ))}
            </div>
          ) : null}
        </>
      ) : activeProject && !hasActiveProjectTabs ? (
        <div className='terminal-workspace__empty'>
          <div className='empty-state'>
            <div className='empty-state__icon' aria-hidden='true'>
              <Layers size={26} strokeWidth={1.75} />
            </div>
            <span className='empty-state__title'>Nenhuma aba aberta</span>
            <span>Crie um terminal, agent, navegador, emulador ou API Client para começar</span>
            <div className='workspace-empty-state__actions'>
              <div className='workspace-empty-state__row'>
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
              <div className='workspace-empty-state__row'>
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
                  className='empty-state__action empty-state__action--emulator app-button app-button--enter'
                  onClick={handleAddEmulator}
                >
                  <Smartphone size={14} />
                  Emulador
                </button>
                <button
                  type='button'
                  className='empty-state__action empty-state__action--api app-button app-button--enter'
                  onClick={handleAddApi}
                >
                  <Braces size={14} />
                  API Client
                </button>
              </div>
            </div>

            {featuredAutomations.length > 0 ? (
              <div className='workspace-empty-state__automations'>
                <span className='workspace-empty-state__section-label'>Automações</span>
                <div className='workspace-empty-state__row'>
                  {featuredAutomations.slice(0, 2).map((automation, index) => (
                    <button
                      key={automation.id}
                      type='button'
                      className='empty-state__action empty-state__action--automation app-button app-button--enter'
                      style={{ animationDelay: `${200 + index * 40}ms` }}
                      onClick={() => handleRunAutomation(automation.id)}
                    >
                      {automation.trigger === 'interval' ? (
                        <Clock size={14} />
                      ) : (
                        <Play size={14} />
                      )}
                      {automation.name}
                    </button>
                  ))}
                </div>
                {featuredAutomations.length > 2 ? (
                  <div className='workspace-empty-state__row'>
                    {featuredAutomations.slice(2, 5).map((automation, index) => (
                      <button
                        key={automation.id}
                        type='button'
                        className='empty-state__action empty-state__action--automation app-button app-button--enter'
                        style={{ animationDelay: `${280 + index * 40}ms` }}
                        onClick={() => handleRunAutomation(automation.id)}
                      >
                        {automation.trigger === 'interval' ? (
                          <Clock size={14} />
                        ) : (
                          <Play size={14} />
                        )}
                        {automation.name}
                      </button>
                    ))}
                  </div>
                ) : null}
                {hasMoreAutomations ? (
                  <button
                    type='button'
                    className='empty-state__action empty-state__action--ghost app-button app-button--enter'
                    style={{ animationDelay: '420ms' }}
                    onClick={handleOpenAutomationsDrawer}
                  >
                    Ver todas
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className='terminal-panel terminal-panel--split'>
          {paneHostReady ? (
            <div className='terminal-panel__project-hosts'>
              {hostedProjects.map((project) => (
                <div
                  key={project.id}
                  className={`terminal-panel__project-host${project.id === activeProjectId ? ' terminal-panel__project-host--active' : ''}`}
                >
                  <ProjectWorkspace
                    project={project}
                    isProjectActive={project.id === activeProjectId}
                    agentSession={agentSession}
                    terminalRefs={terminalRefs}
                    onFocusPane={handleFocusPane}
                    onPtyCreated={handlePtyCreated}
                    onPtyLost={handlePtyLost}
                    onBrowserUrlChange={handleBrowserUrlChange}
                    onOpenLinkInBrowser={handleOpenLinkInBrowser}
                    onUpdateEmulatorTab={handleUpdateEmulatorTab}
                    onUpdateApiTab={handleUpdateApiTab}
                    onUpdateAgentTab={handleUpdateAgentTab}
                    onSplitRatioCommit={handleSplitRatioCommit}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className='terminal-panel__view terminal-panel__view--active' />
          )}
          {showDropOverlay ? <WorkspaceDropOverlay onDrop={handleWorkspaceDrop} /> : null}
        </div>
      )}
    </div>
  );
}

export const TerminalPanel = memo(TerminalPanelComponent);

import { memo, Suspense, lazy, useCallback } from 'react';
import { EmptyState } from '@/components/overlay/EmptyState';
import { Globe } from 'lucide-react';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTabActions } from '@/stores/useTabStore';
import type { ApiTab, BrowserTab, EmulatorTab, TabBarItem, TerminalTab } from '@/types';
import type { MissionAgentNode } from '@/types/mission';
import { getMissionNodeKind, getMissionToolNodeLabel } from '@/utils/missionHelpers';
import { findPaneTab, updatePaneInTabs } from '@/utils/tabGroups';

const LazyBrowserView = lazy(() =>
  import('@/components/browser/BrowserView').then((module) => ({
    default: module.BrowserView,
  })),
);
const LazyEmulatorView = lazy(() =>
  import('@/components/emulator/EmulatorView').then((module) => ({
    default: module.EmulatorView,
  })),
);
const LazyApiView = lazy(() =>
  import('@/components/api/ApiView').then((module) => ({
    default: module.ApiView,
  })),
);
const LazyXTermView = lazy(() =>
  import('@/components/terminal/XTermView').then((module) => ({
    default: module.XTermView,
  })),
);

interface MissionToolEmbedProps {
  node: MissionAgentNode;
  live: boolean;
  variant?: 'panel' | 'node';
  focused?: boolean;
}

function MissionToolEmbedComponent({
  node,
  live,
  variant = 'panel',
  focused,
}: MissionToolEmbedProps) {
  const projects = useProjectStore((state) => state.projects);
  const updateProject = useProjectStore((state) => state.updateProject);
  const setProjectTabPtyId = useProjectStore((state) => state.setTabPtyId);
  const { openBrowserTab } = useTabActions();
  const isFocused = focused ?? (live && variant === 'panel');

  const project = projects.find((entry) => entry.id === node.projectId) ?? null;
  const pane =
    node.paneId && project ? findPaneTab(project.tabs, node.paneId) : null;
  const kind = getMissionNodeKind(node);
  const embedClassName =
    variant === 'node'
      ? 'mission-graph-node__embed'
      : 'mission-inspector__agent-embed mission-inspector__agent-embed--tool';

  const patchPane = useCallback(
    async (updater: (tabs: TabBarItem[]) => TabBarItem[]) => {
      if (!project) {
        return;
      }
      await updateProject(project.id, { tabs: updater(project.tabs) });
    },
    [project, updateProject],
  );

  if (!project || !pane || kind === 'agent' || kind === 'mission') {
    return (
      <EmptyState
        icon={Globe}
        message={`Nenhum ${
          kind === 'agent' || kind === 'mission'
            ? 'recurso'
            : getMissionToolNodeLabel(kind).toLowerCase()
        } vinculado`}
        compact
      />
    );
  }

  if (pane.type === 'browser') {
    const browserPane = pane as BrowserTab;
    return (
      <Suspense fallback={<div className='mission-inspector__text'>Carregando navegador...</div>}>
        <div className={embedClassName}>
          <LazyBrowserView
            projectId={project.id}
            url={browserPane.url}
            isVisible
            isRuntimeActive={live}
            isFocused={isFocused}
            onUrlChange={(url) => {
              void patchPane((tabs) =>
                updatePaneInTabs(tabs, browserPane.id, (entry) =>
                  entry.type === 'browser' ? { ...entry, url } : entry,
                ),
              );
            }}
          />
        </div>
      </Suspense>
    );
  }

  if (pane.type === 'emulator') {
    const emulatorPane = pane as EmulatorTab;
    return (
      <Suspense fallback={<div className='mission-inspector__text'>Carregando emulador...</div>}>
        <div className={embedClassName}>
          <LazyEmulatorView
            tab={emulatorPane}
            isVisible
            isRuntimeActive={live}
            isFocused={isFocused}
            onFocusPane={() => undefined}
            onUpdateTab={(tabId, patch) => {
              void patchPane((tabs) =>
                updatePaneInTabs(tabs, tabId, (entry) =>
                  entry.type === 'emulator' ? { ...entry, ...patch } : entry,
                ),
              );
            }}
          />
        </div>
      </Suspense>
    );
  }

  if (pane.type === 'api') {
    const apiPane = pane as ApiTab;
    return (
      <Suspense fallback={<div className='mission-inspector__text'>Carregando API Client...</div>}>
        <div className={embedClassName}>
          <LazyApiView
            tab={apiPane}
            projectId={project.id}
            isVisible
            isRuntimeActive={live}
            isFocused={isFocused}
            onFocusPane={() => undefined}
            onUpdateTab={(tabId, patch) => {
              void patchPane((tabs) =>
                updatePaneInTabs(tabs, tabId, (entry) =>
                  entry.type === 'api' ? { ...entry, ...patch } : entry,
                ),
              );
            }}
          />
        </div>
      </Suspense>
    );
  }

  if (pane.type === 'terminal') {
    const terminalPane = pane as TerminalTab;
    return (
      <Suspense fallback={<div className='mission-inspector__text'>Carregando terminal...</div>}>
        <div className={embedClassName}>
          <LazyXTermView
            paneId={terminalPane.id}
            projectPath={project.path}
            ptyId={terminalPane.ptyId}
            isVisible
            isRuntimeActive={live}
            isFocused={isFocused}
            cwd={terminalPane.terminalCwd || project.path}
            agent={terminalPane.agent}
            isAgentSession={false}
            restoreCommand={terminalPane.restoreCommand}
            onPtyCreated={(ptyId) => {
              setProjectTabPtyId(project.id, terminalPane.id, ptyId);
            }}
            onPtyLost={() => {
              setProjectTabPtyId(project.id, terminalPane.id, null);
            }}
            onCwdChange={(cwd) => {
              void patchPane((tabs) =>
                updatePaneInTabs(tabs, terminalPane.id, (entry) =>
                  entry.type === 'terminal' ? { ...entry, terminalCwd: cwd } : entry,
                ),
              );
            }}
            onOpenLinkInBrowser={(url) => {
              void openBrowserTab(url);
            }}
          />
        </div>
      </Suspense>
    );
  }

  return (
    <EmptyState
      icon={Globe}
      message='Tipo de nó não suportado neste painel'
      compact
    />
  );
}

export const MissionToolEmbed = memo(MissionToolEmbedComponent);

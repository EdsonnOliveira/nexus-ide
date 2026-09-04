import { memo, Suspense, lazy, useCallback } from 'react';
import type { AgentTab } from '@/types';
import type { MissionAgentNode } from '@/types/mission';
import { EmptyState } from '@/components/overlay/EmptyState';
import { Bot } from 'lucide-react';

const LazyAgentViewSession = lazy(() =>
  import('@/components/agent/AgentViewSession').then((module) => ({
    default: module.AgentViewSession,
  })),
);

interface MissionAgentEmbedProps {
  node: MissionAgentNode;
  projectId: string;
  projectPath: string;
  pane: AgentTab;
  focused: boolean;
  setTabPtyId: (projectId: string, paneId: string, ptyId: string | null) => void;
  updateAgentTab: (
    tabId: string,
    patch: Partial<Pick<AgentTab, 'turns' | 'followUps' | 'workingDirectory' | 'restoreCommand'>>,
  ) => Promise<void> | void;
}

function MissionAgentEmbedComponent({
  node,
  projectId,
  projectPath,
  pane,
  focused,
  setTabPtyId,
  updateAgentTab,
}: MissionAgentEmbedProps) {
  const paneId = node.paneId;

  const handlePtyCreated = useCallback(
    (ptyId: string) => {
      if (!paneId) {
        return;
      }
      setTabPtyId(projectId, paneId, ptyId);
    },
    [paneId, projectId, setTabPtyId],
  );

  const handlePtyLost = useCallback(() => {
    if (!paneId) {
      return;
    }
    setTabPtyId(projectId, paneId, null);
  }, [paneId, projectId, setTabPtyId]);

  const handleUpdateTab = useCallback(
    (
      patch: Partial<
        Pick<AgentTab, 'turns' | 'followUps' | 'workingDirectory' | 'restoreCommand'>
      >,
    ) => {
      if (!paneId) {
        return;
      }
      void updateAgentTab(paneId, patch);
    },
    [paneId, updateAgentTab],
  );

  if (!paneId || pane.type !== 'agent') {
    return (
      <EmptyState
        icon={Bot}
        message='Agent ainda sem sessão'
        compact
      />
    );
  }

  return (
    <div className='mission-agent-embed nodrag nopan nowheel'>
      <Suspense fallback={<EmptyState icon={Bot} message='Carregando agent…' compact />}>
        <LazyAgentViewSession
          tab={pane}
          projectId={projectId}
          projectPath={projectPath}
          isVisible
          isRuntimeActive
          isFocused={focused}
          disableStickyPrompt
          onFocusPane={() => undefined}
          onPtyCreated={handlePtyCreated}
          onPtyLost={handlePtyLost}
          onUpdateTab={handleUpdateTab}
        />
      </Suspense>
    </div>
  );
}

export const MissionAgentEmbed = memo(MissionAgentEmbedComponent);

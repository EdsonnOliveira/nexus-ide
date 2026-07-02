import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { TERMINAL_AGENTS } from '@/constants/terminalAgents';
import type { AgentTab } from '@/types';
import { cliAgentToTerminalAgent } from '@/utils/agentTabHelpers';
import { resolveSanitizedAgentTab } from '@/utils/trimAgentTurnHistory';

const LazyAgentViewSession = lazy(() =>
  import('@/components/agent/AgentViewSession').then((module) => ({
    default: module.AgentViewSession,
  })),
);

export interface AgentViewProps {
  tab: AgentTab;
  projectId: string;
  projectPath: string;
  isVisible: boolean;
  isRuntimeActive: boolean;
  isFocused: boolean;
  onFocusPane: () => void;
  onPtyCreated: (ptyId: string) => void;
  onPtyLost: () => void;
  onUpdateTab: (patch: Partial<Pick<AgentTab, 'turns' | 'workingDirectory' | 'restoreCommand'>>) => void;
}

function AgentViewShell({
  terminalAgent,
  promptColor,
  onFocusPane,
}: {
  terminalAgent: string;
  promptColor: string;
  onFocusPane: () => void;
}) {
  return (
    <div
      className={`agent-view workspace-pane workspace-pane--agent agent-view--${terminalAgent}`}
      style={{ '--agent-accent': promptColor } as CSSProperties}
      onMouseDown={onFocusPane}
    />
  );
}

function AgentViewComponent(props: AgentViewProps) {
  const [sessionReady, setSessionReady] = useState(false);
  const tab = useMemo(() => resolveSanitizedAgentTab(props.tab), [props.tab]);
  const terminalAgent = cliAgentToTerminalAgent(tab.cliAgent);
  const agentConfig = TERMINAL_AGENTS[terminalAgent];

  const handleFocusPane = useCallback(() => {
    props.onFocusPane();
  }, [props.onFocusPane]);

  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7573/ingest/667eb7be-70f4-44cb-a19a-5ae8dc0f89e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f47fa1'},body:JSON.stringify({sessionId:'f47fa1',location:'AgentView.tsx:shell',message:'AgentView shell mounted',data:{paneId:props.tab.id},timestamp:Date.now(),hypothesisId:'H9',runId:'post-fix'})}).catch(()=>{});
    // #endregion
  }, [props.tab.id]);

  useEffect(() => {
    setSessionReady(false);
    let cancelled = false;
    const idleId = window.requestIdleCallback(
      () => {
        if (!cancelled) {
          setSessionReady(true);
        }
      },
      { timeout: 250 },
    );

    return () => {
      cancelled = true;
      window.cancelIdleCallback(idleId);
    };
  }, [props.projectId, props.tab.id]);

  const shell = (
    <AgentViewShell
      terminalAgent={terminalAgent}
      promptColor={agentConfig.promptColor}
      onFocusPane={handleFocusPane}
    />
  );

  if (!sessionReady) {
    return shell;
  }

  return (
    <Suspense fallback={shell}>
      <LazyAgentViewSession {...props} tab={tab} />
    </Suspense>
  );
}

export const AgentView = memo(AgentViewComponent);

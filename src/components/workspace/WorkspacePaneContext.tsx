import { createContext, memo, useContext, type ReactNode, type RefObject } from 'react';
import type { AgentTab, ApiTab, EmulatorTab, Project } from '@/types';
import type { XTermViewHandle } from '@/components/terminal/XTermView';

export interface WorkspacePaneContextValue {
  project: Project;
  isProjectActive: boolean;
  terminalRefs: RefObject<Record<string, XTermViewHandle | null>>;
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
  isPaneVisible: (paneId: string) => boolean;
  isPaneFocused: (paneId: string) => boolean;
  isPaneRuntimeActive: (paneId: string) => boolean;
}

const WorkspacePaneContext = createContext<WorkspacePaneContextValue | null>(null);

interface WorkspacePaneProviderProps {
  value: WorkspacePaneContextValue;
  children: ReactNode;
}

function WorkspacePaneProviderComponent({ value, children }: WorkspacePaneProviderProps) {
  return <WorkspacePaneContext.Provider value={value}>{children}</WorkspacePaneContext.Provider>;
}

export const WorkspacePaneProvider = memo(WorkspacePaneProviderComponent);

export function useWorkspacePaneContext(): WorkspacePaneContextValue {
  const context = useContext(WorkspacePaneContext);

  if (!context) {
    throw new Error('useWorkspacePaneContext must be used within WorkspacePaneProvider');
  }

  return context;
}

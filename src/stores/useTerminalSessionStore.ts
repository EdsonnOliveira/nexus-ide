import { create } from 'zustand';
import type { XTermViewHandle } from '@/components/terminal/XTermView';
import { extractCliAgentCommand } from '@/constants/cliAgentCommands';
import { useProjectNotificationStore } from '@/stores/useProjectNotificationStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { schedulePersistTerminalPane, persistTerminalCommand } from '@/utils/persistTerminalSession';
import { findProjectIdByPaneId } from '@/utils/findProjectIdByPaneId';
import { getTerminalHandle } from '@/utils/terminalHandleRegistry';
import { resetAgentReadyDetectors } from '@/utils/terminalTaskCompletion';

interface TerminalSessionState {
  lastRestartCommands: Record<string, string>;
  lastAgentCommand: string | null;
  activeAgentByPane: Record<string, string | null>;
  activeAgentSinceByPane: Record<string, number>;
  pendingLaunchCommands: Record<string, string>;
  restartingPaneIds: Record<string, boolean>;
  awaitingResponseByPane: Record<string, boolean>;
  setLastCommand: (paneId: string, command: string) => void;
  setActiveAgent: (paneId: string, agent: string | null) => void;
  clearActiveAgentOnShellPrompt: (paneId: string) => void;
  markAwaitingResponse: (paneId: string) => void;
  completeTaskIfAwaiting: (paneId: string) => void;
  setPendingLaunchCommand: (paneId: string, command: string) => void;
  takePendingLaunchCommand: (paneId: string) => string | null;
  setRestarting: (paneId: string, restarting: boolean) => void;
  restartTerminalPane: (paneId: string, selectPane: (paneId: string) => Promise<void>) => Promise<void>;
}

const RESTART_LOADING_MS = 900;
const AGENT_SHELL_PROMPT_CLEAR_GRACE_MS = 800;

function markPaneAgentActive(
  state: TerminalSessionState,
  paneId: string,
  agentCommand: string,
): Pick<TerminalSessionState, 'lastAgentCommand' | 'activeAgentByPane' | 'activeAgentSinceByPane'> {
  return {
    lastAgentCommand: agentCommand,
    activeAgentByPane: {
      ...state.activeAgentByPane,
      [paneId]: agentCommand,
    },
    activeAgentSinceByPane: {
      ...state.activeAgentSinceByPane,
      [paneId]: Date.now(),
    },
  };
}

function waitForTerminalHandle(paneId: string, attempts = 12): Promise<XTermViewHandle | null> {
  return new Promise((resolve) => {
    let remaining = attempts;

    const tryResolve = () => {
      const handle = getTerminalHandle(paneId);

      if (handle) {
        resolve(handle);
        return;
      }

      remaining -= 1;

      if (remaining <= 0) {
        resolve(null);
        return;
      }

      window.requestAnimationFrame(tryResolve);
    };

    tryResolve();
  });
}

export const useTerminalSessionStore = create<TerminalSessionState>((set, get) => ({
  lastRestartCommands: {},
  lastAgentCommand: null,
  activeAgentByPane: {},
  activeAgentSinceByPane: {},
  pendingLaunchCommands: {},
  restartingPaneIds: {},
  awaitingResponseByPane: {},
  setActiveAgent: (paneId, agent) => {
    set((state) => {
      const nextSince = { ...state.activeAgentSinceByPane };

      if (agent) {
        nextSince[paneId] = Date.now();
      } else {
        delete nextSince[paneId];
      }

      return {
        activeAgentByPane: {
          ...state.activeAgentByPane,
          [paneId]: agent,
        },
        activeAgentSinceByPane: nextSince,
      };
    });
  },
  clearActiveAgentOnShellPrompt: (paneId) => {
    const state = get();
    const agent = state.activeAgentByPane[paneId];

    if (!agent) {
      return;
    }

    if (state.pendingLaunchCommands[paneId]) {
      return;
    }

    const since = state.activeAgentSinceByPane[paneId] ?? 0;

    if (Date.now() - since < AGENT_SHELL_PROMPT_CLEAR_GRACE_MS) {
      return;
    }

    get().setActiveAgent(paneId, null);
  },
  markAwaitingResponse: (paneId) => {
    resetAgentReadyDetectors(paneId);

    set((state) => ({
      awaitingResponseByPane: {
        ...state.awaitingResponseByPane,
        [paneId]: true,
      },
    }));
  },
  completeTaskIfAwaiting: (paneId) => {
    const state = get();

    if (!state.awaitingResponseByPane[paneId]) {
      return;
    }

    const projectId = findProjectIdByPaneId(paneId);

    if (projectId && useProjectStore.getState().activeProjectId !== projectId) {
      useProjectNotificationStore.getState().markProjectReady(projectId);
    }

    set((current) => {
      const nextAwaiting = { ...current.awaitingResponseByPane };
      delete nextAwaiting[paneId];
      return { awaitingResponseByPane: nextAwaiting };
    });
  },
  setLastCommand: (paneId, command) => {
    const trimmed = command.trim();

    if (!trimmed || trimmed.startsWith('/')) {
      return;
    }

    const agentCommand = extractCliAgentCommand(trimmed);

    if (agentCommand) {
      set((state) => markPaneAgentActive(state, paneId, agentCommand));
      persistTerminalCommand(paneId, trimmed);
      return;
    }

    const existingAgent = get().activeAgentByPane[paneId];

    if (existingAgent) {
      persistTerminalCommand(paneId, trimmed);
      return;
    }

    set((state) => ({
      lastRestartCommands: {
        ...state.lastRestartCommands,
        [paneId]: trimmed,
      },
    }));

    persistTerminalCommand(paneId, trimmed);
  },
  setPendingLaunchCommand: (paneId, command) => {
    const trimmed = command.trim();

    if (!trimmed) {
      return;
    }

    const agentCommand = extractCliAgentCommand(trimmed);

    set((state) => ({
      pendingLaunchCommands: {
        ...state.pendingLaunchCommands,
        [paneId]: trimmed,
      },
      ...(agentCommand ? markPaneAgentActive(state, paneId, agentCommand) : {}),
    }));

    schedulePersistTerminalPane(paneId, { restoreCommand: trimmed });
  },
  takePendingLaunchCommand: (paneId) => {
    const pending = get().pendingLaunchCommands[paneId] ?? null;

    if (!pending) {
      return null;
    }

    set((state) => {
      const nextPending = { ...state.pendingLaunchCommands };
      delete nextPending[paneId];
      return { pendingLaunchCommands: nextPending };
    });

    return pending;
  },
  setRestarting: (paneId, restarting) => {
    set((state) => ({
      restartingPaneIds: {
        ...state.restartingPaneIds,
        [paneId]: restarting,
      },
    }));
  },
  restartTerminalPane: async (paneId, selectPane) => {
    const command = get().lastRestartCommands[paneId];

    if (!command) {
      return;
    }

    set((state) => ({
      restartingPaneIds: {
        ...state.restartingPaneIds,
        [paneId]: true,
      },
    }));

    try {
      await selectPane(paneId);
      const handle = await waitForTerminalHandle(paneId);

      if (handle) {
        await handle.interruptAndRun(command);
      }
    } finally {
      window.setTimeout(() => {
        get().setRestarting(paneId, false);
      }, RESTART_LOADING_MS);
    }
  },
}));

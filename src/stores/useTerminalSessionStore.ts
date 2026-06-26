import { create } from 'zustand';
import type { XTermViewHandle } from '@/components/terminal/XTermView';
import type { AutomationAgentMode } from '@/constants/agentModes';
import { extractCliAgentCommand } from '@/constants/cliAgentCommands';
import { parseAgentModeCommand } from '@/utils/parseAgentModeCommand';
import { useProjectNotificationStore } from '@/stores/useProjectNotificationStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { schedulePersistTerminalPane, persistTerminalCommand } from '@/utils/persistTerminalSession';
import { handleAutomationPaneTaskComplete } from '@/utils/automationPaneExecution';
import { findProjectIdByPaneId } from '@/utils/findProjectIdByPaneId';
import { getTerminalHandle } from '@/utils/terminalHandleRegistry';
import { trackAgentGitPrompt } from '@/utils/agentGitTurn';
import { resolvePaneAgentForGitTurn } from '@/utils/projectAgentStatus';
import { resetAgentReadyDetectors } from '@/utils/terminalTaskCompletion';

interface TerminalSessionState {
  lastRestartCommands: Record<string, string>;
  lastAgentCommand: string | null;
  activeAgentByPane: Record<string, string | null>;
  activeAgentModeByPane: Record<string, AutomationAgentMode>;
  activeAgentSinceByPane: Record<string, number>;
  agentBusyByPane: Record<string, boolean>;
  pendingLaunchCommands: Record<string, string>;
  pendingAgentSetupByPane: Record<string, string[]>;
  pendingTaskPromptByPane: Record<string, string>;
  restartingPaneIds: Record<string, boolean>;
  awaitingResponseByPane: Record<string, boolean>;
  agentNotifyEligibleByPane: Record<string, boolean>;
  setLastCommand: (paneId: string, command: string) => void;
  setActiveAgent: (paneId: string, agent: string | null) => void;
  setAgentBusy: (paneId: string, busy: boolean) => void;
  clearActiveAgentOnShellPrompt: (paneId: string) => void;
  markAgentNotifyEligible: (paneId: string) => void;
  markAwaitingResponse: (paneId: string) => void;
  resetAgentWorkload: (paneId: string) => void;
  completeTaskIfAwaiting: (paneId: string) => void;
  disposePaneSession: (paneId: string) => void;
  setPendingLaunchCommand: (paneId: string, command: string) => void;
  setPendingAgentSetup: (paneId: string, commands: string[]) => void;
  takePendingAgentSetup: (paneId: string) => string[];
  setPendingTaskPrompt: (paneId: string, prompt: string) => void;
  takePendingTaskPrompt: (paneId: string) => string | null;
  takePendingLaunchCommand: (paneId: string) => string | null;
  setRestarting: (paneId: string, restarting: boolean) => void;
  resumeAgentSession: (
    paneId: string,
    command: string,
    selectPane: (paneId: string) => Promise<void>,
  ) => Promise<void>;
  restartTerminalPane: (
    paneId: string,
    selectPane: (paneId: string) => Promise<void>,
    focusPane?: boolean,
  ) => Promise<void>;
}

const RESTART_LOADING_MS = 900;
const AGENT_SHELL_PROMPT_CLEAR_GRACE_MS = 800;

function omitPaneRecord<T>(record: Record<string, T>, paneId: string): Record<string, T> {
  if (!(paneId in record)) {
    return record;
  }

  const next = { ...record };
  delete next[paneId];
  return next;
}

function markPaneAgentActive(
  state: TerminalSessionState,
  paneId: string,
  agentCommand: string,
): Pick<
  TerminalSessionState,
  'lastAgentCommand' | 'activeAgentByPane' | 'activeAgentModeByPane' | 'activeAgentSinceByPane'
> {
  return {
    lastAgentCommand: agentCommand,
    activeAgentByPane: {
      ...state.activeAgentByPane,
      [paneId]: agentCommand,
    },
    activeAgentModeByPane: {
      ...state.activeAgentModeByPane,
      [paneId]: 'agent',
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
  activeAgentModeByPane: {},
  activeAgentSinceByPane: {},
  agentBusyByPane: {},
  pendingLaunchCommands: {},
  pendingAgentSetupByPane: {},
  pendingTaskPromptByPane: {},
  restartingPaneIds: {},
  awaitingResponseByPane: {},
  agentNotifyEligibleByPane: {},
  setActiveAgent: (paneId, agent) => {
    set((state) => {
      const nextSince = { ...state.activeAgentSinceByPane };
      const nextMode = { ...state.activeAgentModeByPane };

      if (agent) {
        nextSince[paneId] = Date.now();

        if (!state.activeAgentByPane[paneId]) {
          nextMode[paneId] = 'agent';
        }
      } else {
        delete nextSince[paneId];
        delete nextMode[paneId];
      }

      const nextBusy = { ...state.agentBusyByPane };

      if (!agent) {
        delete nextBusy[paneId];
      }

      return {
        activeAgentByPane: {
          ...state.activeAgentByPane,
          [paneId]: agent,
        },
        activeAgentModeByPane: nextMode,
        activeAgentSinceByPane: nextSince,
        agentBusyByPane: nextBusy,
      };
    });
  },
  setAgentBusy: (paneId, busy) => {
    set((state) => {
      if (state.agentBusyByPane[paneId] === busy) {
        return state;
      }

      const nextBusy = { ...state.agentBusyByPane };

      if (busy) {
        nextBusy[paneId] = true;
      } else {
        delete nextBusy[paneId];
      }

      return { agentBusyByPane: nextBusy };
    });
  },
  clearActiveAgentOnShellPrompt: (paneId) => {
    const state = get();
    const agent = state.activeAgentByPane[paneId];

    if (!agent) {
      return;
    }

    if (state.awaitingResponseByPane[paneId] || state.agentBusyByPane[paneId] || state.agentNotifyEligibleByPane[paneId]) {
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
  markAgentNotifyEligible: (paneId) => {
    set((state) => {
      if (state.agentNotifyEligibleByPane[paneId]) {
        return state;
      }

      return {
        agentNotifyEligibleByPane: {
          ...state.agentNotifyEligibleByPane,
          [paneId]: true,
        },
      };
    });
  },
  markAwaitingResponse: (paneId) => {
    resetAgentReadyDetectors(paneId);

    set((state) => ({
      awaitingResponseByPane: {
        ...state.awaitingResponseByPane,
        [paneId]: true,
      },
      agentNotifyEligibleByPane: {
        ...state.agentNotifyEligibleByPane,
        [paneId]: true,
      },
      agentBusyByPane: {
        ...state.agentBusyByPane,
        [paneId]: true,
      },
    }));
  },
  resetAgentWorkload: (paneId) => {
    resetAgentReadyDetectors(paneId);

    set((state) => ({
      awaitingResponseByPane: omitPaneRecord(state.awaitingResponseByPane, paneId),
      agentNotifyEligibleByPane: omitPaneRecord(state.agentNotifyEligibleByPane, paneId),
      agentBusyByPane: omitPaneRecord(state.agentBusyByPane, paneId),
    }));
  },
  completeTaskIfAwaiting: (paneId) => {
    const state = get();
    const isAwaiting = Boolean(state.awaitingResponseByPane[paneId]);
    const isEligible = Boolean(state.agentNotifyEligibleByPane[paneId]);
    const isBusy = Boolean(state.agentBusyByPane[paneId]);

    if (!isAwaiting && !isEligible && !isBusy) {
      return;
    }

    if (isBusy) {
      return;
    }

    if (isAwaiting) {
      const projectId = findProjectIdByPaneId(paneId);

      if (projectId) {
        useProjectNotificationStore.getState().markProjectReady(projectId, paneId);
      }
    }

    set((current) => {
      const nextAwaiting = { ...current.awaitingResponseByPane };
      delete nextAwaiting[paneId];
      const nextEligible = { ...current.agentNotifyEligibleByPane };
      delete nextEligible[paneId];
      const nextBusy = { ...current.agentBusyByPane };
      delete nextBusy[paneId];
      return {
        awaitingResponseByPane: nextAwaiting,
        agentNotifyEligibleByPane: nextEligible,
        agentBusyByPane: nextBusy,
      };
    });

    handleAutomationPaneTaskComplete(paneId);
  },
  disposePaneSession: (paneId) => {
    resetAgentReadyDetectors(paneId);

    set((state) => ({
      lastRestartCommands: omitPaneRecord(state.lastRestartCommands, paneId),
      activeAgentByPane: omitPaneRecord(state.activeAgentByPane, paneId),
      activeAgentModeByPane: omitPaneRecord(state.activeAgentModeByPane, paneId),
      activeAgentSinceByPane: omitPaneRecord(state.activeAgentSinceByPane, paneId),
      agentBusyByPane: omitPaneRecord(state.agentBusyByPane, paneId),
      pendingLaunchCommands: omitPaneRecord(state.pendingLaunchCommands, paneId),
      pendingAgentSetupByPane: omitPaneRecord(state.pendingAgentSetupByPane, paneId),
      pendingTaskPromptByPane: omitPaneRecord(state.pendingTaskPromptByPane, paneId),
      restartingPaneIds: omitPaneRecord(state.restartingPaneIds, paneId),
      awaitingResponseByPane: omitPaneRecord(state.awaitingResponseByPane, paneId),
      agentNotifyEligibleByPane: omitPaneRecord(state.agentNotifyEligibleByPane, paneId),
    }));
  },
  setLastCommand: (paneId, command) => {
    const trimmed = command.trim();
    const modeCommand = parseAgentModeCommand(trimmed);

    if (modeCommand) {
      set((state) => ({
        activeAgentModeByPane: {
          ...state.activeAgentModeByPane,
          [paneId]: modeCommand,
        },
      }));
      return;
    }

    if (!trimmed || trimmed.startsWith('/')) {
      return;
    }

    const agentCommand = extractCliAgentCommand(trimmed);

    if (agentCommand) {
      set((state) => markPaneAgentActive(state, paneId, agentCommand));
      persistTerminalCommand(paneId, trimmed);
      return;
    }

    const existingAgent = resolvePaneAgentForGitTurn(
      paneId,
      useProjectStore.getState().projects,
      get().activeAgentByPane,
    );

    if (existingAgent) {
      persistTerminalCommand(paneId, trimmed);
      trackAgentGitPrompt(paneId, trimmed);
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
  setPendingAgentSetup: (paneId, commands) => {
    const filtered = commands.map((command) => command.trim()).filter(Boolean);

    if (filtered.length === 0) {
      return;
    }

    set((state) => ({
      pendingAgentSetupByPane: {
        ...state.pendingAgentSetupByPane,
        [paneId]: filtered,
      },
    }));
  },
  takePendingAgentSetup: (paneId) => {
    const pending = get().pendingAgentSetupByPane[paneId] ?? [];

    if (pending.length === 0) {
      return [];
    }

    set((state) => {
      const nextPending = { ...state.pendingAgentSetupByPane };
      delete nextPending[paneId];
      return { pendingAgentSetupByPane: nextPending };
    });

    return pending;
  },
  setPendingTaskPrompt: (paneId, prompt) => {
    const trimmed = prompt.trim();

    if (!trimmed) {
      return;
    }

    set((state) => ({
      pendingTaskPromptByPane: {
        ...state.pendingTaskPromptByPane,
        [paneId]: trimmed,
      },
    }));
  },
  takePendingTaskPrompt: (paneId) => {
    const pending = get().pendingTaskPromptByPane[paneId] ?? null;

    if (!pending) {
      return null;
    }

    set((state) => {
      const nextPending = { ...state.pendingTaskPromptByPane };
      delete nextPending[paneId];
      return { pendingTaskPromptByPane: nextPending };
    });

    return pending;
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
  restartTerminalPane: async (paneId, selectPane, focusPane = true) => {
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
      if (focusPane) {
        await selectPane(paneId);
      }

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
  resumeAgentSession: async (paneId, command, selectPane) => {
    const trimmed = command.trim();

    if (!trimmed) {
      return;
    }

    const agentCommand = extractCliAgentCommand(trimmed);

    set((state) => ({
      restartingPaneIds: {
        ...state.restartingPaneIds,
        [paneId]: true,
      },
      ...(agentCommand ? markPaneAgentActive(state, paneId, agentCommand) : {}),
      pendingLaunchCommands: {
        ...state.pendingLaunchCommands,
        [paneId]: trimmed,
      },
    }));

    schedulePersistTerminalPane(paneId, { restoreCommand: trimmed });

    try {
      await selectPane(paneId);
      const handle = await waitForTerminalHandle(paneId);

      if (handle) {
        await handle.interruptAndRun(trimmed);
      }
    } finally {
      window.setTimeout(() => {
        get().setRestarting(paneId, false);
      }, RESTART_LOADING_MS);
    }
  },
}));

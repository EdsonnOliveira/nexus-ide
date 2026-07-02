import type { AgentTab, Tab, TerminalTab } from '@/types';
import type { Automation } from '@/types/automation';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { buildAgentPaneLaunchCommand } from '@/utils/agentCliSession';
import {
  cliAgentToTerminalAgent,
  resolveAgentPaneRootPath,
  resolveAgentTabCli,
} from '@/utils/agentTabHelpers';
import { collectPendingCommands } from '@/utils/buildAutomationTabs';
import { shouldMarkAgentAwaiting } from '@/utils/projectAgentStatus';
import { findPaneTab } from '@/utils/tabGroups';

const LAUNCH_COMMAND_DELAY_MS = 350;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isTerminalLikePane(pane: Tab): pane is TerminalTab | AgentTab {
  return pane.type === 'terminal' || pane.type === 'agent';
}

function resolvePaneTerminalAgent(pane: TerminalTab | AgentTab) {
  if (pane.type === 'agent') {
    return cliAgentToTerminalAgent(resolveAgentTabCli(pane));
  }

  return pane.agent;
}

function resolvePanePtyCwd(pane: TerminalTab | AgentTab, projectPath: string): string {
  if (pane.type === 'agent') {
    return resolveAgentPaneRootPath(pane.workingDirectory ?? projectPath);
  }

  return pane.terminalCwd?.trim() || projectPath;
}

function resolveLaunchCommand(pane: TerminalTab | AgentTab, fallbackCommand: string): string {
  const sessionStore = useTerminalSessionStore.getState();
  const pendingLaunch =
    sessionStore.takePendingLaunchCommand(pane.id) ??
    fallbackCommand.trim() ??
    (pane.type === 'terminal' ? pane.restoreCommand?.trim() : null) ??
    '';

  if (pane.type === 'agent') {
    return buildAgentPaneLaunchCommand(pendingLaunch || resolveAgentTabCli(pane));
  }

  return pendingLaunch;
}

async function bootstrapPanePty(
  projectId: string,
  pane: TerminalTab | AgentTab,
  fallbackCommand: string,
  projectPath: string,
): Promise<void> {
  const freshPane = findPaneTab(
    useProjectStore.getState().projects.find((item) => item.id === projectId)?.tabs ?? [],
    pane.id,
  );

  if (freshPane && isTerminalLikePane(freshPane) && freshPane.ptyId) {
    if (await window.nexus.terminal.has(freshPane.ptyId)) {
      return;
    }
  }

  const sessionStore = useTerminalSessionStore.getState();
  const cwd = resolvePanePtyCwd(pane, projectPath);
  const agent = resolvePaneTerminalAgent(pane);
  const launchCommand = resolveLaunchCommand(pane, fallbackCommand);

  if (pane.type === 'agent') {
    sessionStore.setActiveAgent(pane.id, resolveAgentTabCli(pane));
  }

  const ptyId = await window.nexus.terminal.create(cwd, agent);
  useProjectStore.getState().setTabPtyId(projectId, pane.id, ptyId);

  if (!launchCommand) {
    return;
  }

  await delay(LAUNCH_COMMAND_DELAY_MS);

  if (!(await window.nexus.terminal.has(ptyId))) {
    return;
  }

  window.nexus.terminal.write(ptyId, `${launchCommand}\n`);
  sessionStore.setLastCommand(pane.id, launchCommand);

  if (shouldMarkAgentAwaiting(pane.id, launchCommand, sessionStore.activeAgentByPane)) {
    sessionStore.markAwaitingResponse(pane.id);
  }
}

export async function bootstrapAutomationPtys(
  projectId: string,
  automation: Automation,
  projectPath: string,
): Promise<void> {
  const project = useProjectStore.getState().projects.find((item) => item.id === projectId);

  if (!project) {
    return;
  }

  const commandByPane = new Map(
    collectPendingCommands(automation).map((entry) => [entry.paneId, entry.command]),
  );

  for (const step of automation.steps) {
    if (step.type !== 'terminal' && step.type !== 'agent') {
      continue;
    }

    const pane = findPaneTab(project.tabs, step.id);

    if (!pane || !isTerminalLikePane(pane)) {
      continue;
    }

    await bootstrapPanePty(projectId, pane, commandByPane.get(step.id) ?? '', projectPath);
  }
}

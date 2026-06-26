import { useAutomationExecutionStore } from '@/stores/useAutomationExecutionStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useTerminalSessionStore } from '@/stores/useTerminalSessionStore';
import { buildTabsFromAutomation, collectPendingCommands } from '@/utils/buildAutomationTabs';
import { buildAgentSetupCommands } from '@/utils/buildAgentSetupCommands';
import { markAutomationPanesFromRun } from '@/utils/automationPaneExecution';
import { persistAutomationApiRequests, sendAutomationApiRequests } from '@/utils/automationApiRequest';
import { resolveAgentLaunchCommand } from '@/utils/resolveAgentLaunchCommand';
import type { Automation } from '@/types/automation';

const EXECUTION_CLEAR_MS = 3200;

const runningAutomationIds = new Set<string>();

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

async function resolveAutomationSteps(automation: Automation, projectPath: string): Promise<Automation> {
  const steps = await Promise.all(
    automation.steps.map(async (step) => {
      if (step.type !== 'agent' || step.command?.trim()) {
        return step;
      }

      const command = await resolveAgentLaunchCommand(projectPath);

      return { ...step, command };
    }),
  );

  return { ...automation, steps };
}

export async function executeAutomation(automation: Automation, projectId: string): Promise<void> {
  if (runningAutomationIds.has(automation.id)) {
    return;
  }

  const projectStore = useProjectStore.getState();
  const project = projectStore.projects.find((item) => item.id === projectId);

  if (!project || automation.steps.length === 0) {
    return;
  }

  runningAutomationIds.add(automation.id);
  useAutomationExecutionStore.getState().markAutomationRunning(projectId, automation.id);

  try {
    const resolved = await resolveAutomationSteps(automation, project.path);

    if (resolved.closeOpenTabsBeforeRun) {
      await projectStore.updateProject(projectId, {
        tabs: [],
        activeTabId: null,
        activePaneId: null,
      });
      await waitForNextFrame();
    }

    const freshProject =
      useProjectStore.getState().projects.find((item) => item.id === projectId) ?? project;

    for (const { paneId, command } of collectPendingCommands(resolved)) {
      useTerminalSessionStore.getState().setPendingLaunchCommand(paneId, command);
    }

    markAutomationPanesFromRun(resolved);

    for (const step of resolved.steps) {
      if (step.type !== 'agent') {
        continue;
      }

      const setupCommands = buildAgentSetupCommands(step);

      if (setupCommands.length > 0) {
        useTerminalSessionStore.getState().setPendingAgentSetup(step.id, setupCommands);
      }
    }

    await persistAutomationApiRequests(projectId, resolved.steps);

    const built = await buildTabsFromAutomation(resolved, freshProject.path, freshProject.tabs);

    const emulatorAutoStartTabIds = resolved.steps
      .filter((step) => step.type === 'emulator' && step.autoStartEmulator !== false)
      .map((step) => step.id);

    useAutomationExecutionStore.getState().syncPendingEmulatorAutoStart(emulatorAutoStartTabIds);

    await projectStore.updateProject(projectId, {
      tabs: built.tabs,
      activeTabId: built.activeTabId,
      activePaneId: built.activePaneId,
    });

    await sendAutomationApiRequests(projectId, resolved.steps);
  } finally {
    window.setTimeout(() => {
      runningAutomationIds.delete(automation.id);
      useAutomationExecutionStore.getState().clearAutomationRunning(projectId);
    }, EXECUTION_CLEAR_MS);
  }
}

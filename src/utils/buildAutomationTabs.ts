import type {
  AgentTab,
  ApiTab,
  BrowserTab,
  EmulatorPlatform,
  EmulatorTab,
  SplitLayoutNode,
  Tab,
  TabBarItem,
  TabType,
  TerminalTab,
} from '@/types';
import type { Automation, AutomationStep } from '@/types/automation';
import { extractCliAgentCommand } from '@/constants/cliAgentCommands';
import { terminalAgentToCli } from '@/utils/agentTabHelpers';
import { AUTOMATION_API_COLLECTION_ID } from '@/utils/automationApiRequest';
import { normalizeAutomation } from '@/utils/normalizeAutomation';
import { normalizeBrowserUrl } from '@/utils/browserUrl';
import { createTabLayout } from '@/utils/splitLayout';
import { createBadgeColorIndex } from '@/utils/tabBadge';

function countPanesByType(tabs: TabBarItem[], type: TabType): number {
  let count = 0;

  for (const item of tabs) {
    if (item.type === 'split') {
      count += item.panes.filter((pane) => pane.type === type).length;
      continue;
    }

    if (item.type === type) {
      count += 1;
    }
  }

  return count;
}

async function resolveDefaultEmulatorPlatform(projectPath: string): Promise<EmulatorPlatform> {
  if (typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent)) {
    try {
      const kinds = await window.nexus.files.detectProjectKinds([projectPath]);

      if (kinds[projectPath] === 'mobile') {
        return 'ios';
      }
    } catch {
      return 'android';
    }
  }

  return 'android';
}

function resolveStepCwd(step: AutomationStep, projectPath: string): string | undefined {
  const cwd = step.cwd?.trim();

  if (!cwd) {
    return undefined;
  }

  if (cwd.startsWith('/')) {
    return cwd;
  }

  return `${projectPath}/${cwd.replace(/^\.\//, '')}`;
}

export function buildBalancedSplitLayout(tabIds: string[]): SplitLayoutNode {
  if (tabIds.length === 0) {
    throw new Error('Cannot build split layout without tabs');
  }

  if (tabIds.length === 1) {
    return createTabLayout(tabIds[0]);
  }

  const mid = Math.ceil(tabIds.length / 2);

  return {
    type: 'split',
    orientation: 'horizontal',
    left: buildBalancedSplitLayout(tabIds.slice(0, mid)),
    right: buildBalancedSplitLayout(tabIds.slice(mid)),
    ratio: 0.5,
  };
}

function buildSplitTabTitle(panes: Tab[]): string {
  return panes.map((pane) => pane.title).join(' + ');
}

function resolveStepTabTitle(step: AutomationStep, fallback: string): string {
  return step.tabTitle?.trim() || fallback;
}

function resolveStepTabExtras(step: AutomationStep, badgeColorIndex: number) {
  return {
    badgeColorIndex,
    ...(step.pinned ? { pinned: true } : {}),
  };
}

export async function buildTabFromStep(
  step: AutomationStep,
  projectPath: string,
  existingTabs: TabBarItem[],
  badgeOffset = 0,
): Promise<Tab> {
  const badgeColorIndex = createBadgeColorIndex(existingTabs) + badgeOffset;
  const shared = resolveStepTabExtras(step, badgeColorIndex);

  if (step.type === 'browser') {
    const nextTab: BrowserTab = {
      id: step.id,
      title: resolveStepTabTitle(
        step,
        `Navegador ${countPanesByType(existingTabs, 'browser') + 1 + badgeOffset}`,
      ),
      type: 'browser',
      url: normalizeBrowserUrl(step.url ?? '') || 'https://www.google.com',
      ...shared,
    };

    return nextTab;
  }

  if (step.type === 'emulator') {
    const platform = step.platform ?? (await resolveDefaultEmulatorPlatform(projectPath));

    const nextTab: EmulatorTab = {
      id: step.id,
      title: resolveStepTabTitle(
        step,
        `Emulador ${countPanesByType(existingTabs, 'emulator') + 1 + badgeOffset}`,
      ),
      type: 'emulator',
      platform,
      deviceId: step.deviceId ?? null,
      sessionId: null,
      ...shared,
    };

    return nextTab;
  }

  if (step.type === 'api') {
    const nextTab: ApiTab = {
      id: step.id,
      title: resolveStepTabTitle(
        step,
        `API Client ${countPanesByType(existingTabs, 'api') + 1 + badgeOffset}`,
      ),
      type: 'api',
      requestId: step.id,
      collectionId: AUTOMATION_API_COLLECTION_ID,
      ...shared,
    };

    return nextTab;
  }

  const terminalCwd = resolveStepCwd(step, projectPath);
  const command = step.command?.trim() ?? '';
  const isAgent = step.type === 'agent';

  if (isAgent) {
    const cliAgent = extractCliAgentCommand(command) ?? terminalAgentToCli('cursor');
    const nextTab: AgentTab = {
      id: step.id,
      title: resolveStepTabTitle(
        step,
        `Agent ${countPanesByType(existingTabs, 'agent') + 1 + badgeOffset}`,
      ),
      type: 'agent',
      cliAgent,
      ptyId: null,
      messages: [],
      turns: [],
      restoreCommand: command || cliAgent,
      workingDirectory: projectPath,
      ...shared,
    };

    return nextTab;
  }

  const defaultTitle = `Terminal ${countPanesByType(existingTabs, 'terminal') + 1 + badgeOffset}`;

  const nextTab: TerminalTab = {
    id: step.id,
    title: resolveStepTabTitle(step, defaultTitle),
    type: 'terminal',
    ptyId: null,
    agent: 'shell',
    ...(terminalCwd ? { terminalCwd } : {}),
    ...(command ? { restoreCommand: command } : {}),
    ...shared,
  };

  return nextTab;
}

export async function buildTabsFromAutomation(
  automation: Automation,
  projectPath: string,
  existingTabs: TabBarItem[],
): Promise<{ tabs: TabBarItem[]; activeTabId: string; activePaneId: string | null }> {
  const normalized = normalizeAutomation(automation);
  const steps = normalized.steps;

  if (steps.length === 0) {
    throw new Error('Automation has no steps');
  }

  const panes: Tab[] = [];

  for (let index = 0; index < steps.length; index += 1) {
    panes.push(await buildTabFromStep(steps[index], projectPath, existingTabs, index));
  }

  const outputItems: TabBarItem[] = [];
  let group: Tab[] = [];
  let groupSteps: AutomationStep[] = [];

  const flushGroup = () => {
    if (group.length === 0) {
      return;
    }

    if (group.length === 1) {
      outputItems.push(group[0]);
    } else {
      const leaderStep = groupSteps[0];
      const layout = buildBalancedSplitLayout(group.map((pane) => pane.id));
      outputItems.push({
        id: crypto.randomUUID(),
        title: resolveStepTabTitle(leaderStep, buildSplitTabTitle(group)),
        type: 'split',
        layout,
        activePaneId: group[0]?.id ?? null,
        panes: group,
        badgeColorIndex: createBadgeColorIndex([...existingTabs, ...outputItems]),
        ...(leaderStep.pinned ? { pinned: true } : {}),
      });
    }

    group = [];
    groupSteps = [];
  };

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const pane = panes[index];

    if (index === 0 || step.openMode !== 'split-with-previous') {
      flushGroup();
      group = [pane];
      groupSteps = [step];
      continue;
    }

    group.push(pane);
    groupSteps.push(step);
  }

  flushGroup();

  const lastItem = outputItems[outputItems.length - 1];
  const fallbackActiveTabId = lastItem.id;
  const fallbackActivePaneId = lastItem.type === 'split' ? lastItem.activePaneId : null;
  const defaultActiveStepId = normalized.defaultActiveStepId;
  let activeTabId = fallbackActiveTabId;
  let activePaneId = fallbackActivePaneId;

  if (defaultActiveStepId) {
    for (const item of outputItems) {
      if (item.type === 'split') {
        const pane = item.panes.find((entry) => entry.id === defaultActiveStepId);

        if (pane) {
          activeTabId = item.id;
          activePaneId = pane.id;
          break;
        }

        continue;
      }

      if (item.id === defaultActiveStepId) {
        activeTabId = item.id;
        activePaneId = null;
        break;
      }
    }
  }

  return {
    tabs: [...existingTabs, ...outputItems],
    activeTabId,
    activePaneId,
  };
}

export function collectPendingCommands(automation: Automation): Array<{ paneId: string; command: string }> {
  const pending: Array<{ paneId: string; command: string }> = [];

  for (const step of automation.steps) {
    const command = step.command?.trim();

    if ((step.type === 'terminal' || step.type === 'agent') && command) {
      pending.push({ paneId: step.id, command });
    }
  }

  return pending;
}

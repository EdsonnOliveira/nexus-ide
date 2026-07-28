import type { Automation, AutomationStep, AutomationStepOpenMode, AutomationTrigger } from '@/types/automation';
import { resolveAutomationStepTabOptionLabel } from '@/utils/automationLabels';

type LegacyAutomation = Omit<Automation, 'defaultActiveStepId' | 'trigger'> & {
  trigger: AutomationTrigger | 'app_open';
  tabLayout?: 'separate' | 'split';
  defaultActiveStepId?: string | null;
};

export interface AutomationStepGroupItem {
  step: AutomationStep;
  index: number;
}

export interface AutomationStepGroup {
  steps: AutomationStepGroupItem[];
}

export function isJoinWithPreviousOpenMode(
  openMode: AutomationStepOpenMode | undefined,
): boolean {
  return openMode === 'split-with-previous' || openMode === 'grid-with-previous';
}

export function groupAutomationSteps(steps: AutomationStep[]): AutomationStepGroup[] {
  const groups: AutomationStepGroup[] = [];

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];

    if (index === 0 || !isJoinWithPreviousOpenMode(step.openMode)) {
      groups.push({ steps: [{ step, index }] });
      continue;
    }

    groups[groups.length - 1]?.steps.push({ step, index });
  }

  return groups;
}

export function isAutomationStepDefaultActiveOption(
  step: AutomationStep,
  index: number,
  steps: AutomationStep[],
): boolean {
  if (isJoinWithPreviousOpenMode(step.openMode)) {
    return false;
  }

  const group = groupAutomationSteps(steps).find((entry) => entry.steps[0]?.index === index);

  if (!group || group.steps.length === 1) {
    return true;
  }

  return Boolean(step.tabTitle?.trim());
}

export function buildAutomationDefaultActiveStepOptions(
  steps: AutomationStep[],
): Array<{ value: string; label: string }> {
  return steps
    .map((step, index) => ({ step, index }))
    .filter(({ step, index }) => isAutomationStepDefaultActiveOption(step, index, steps))
    .map(({ step, index }) => ({
      value: step.id,
      label: resolveAutomationStepTabOptionLabel(step, index, steps),
    }));
}

export function normalizeAutomationDefaultActiveStepId(
  steps: AutomationStep[],
  defaultActiveStepId: string | null | undefined,
): string | null {
  if (!defaultActiveStepId) {
    return null;
  }

  const listableIds = new Set(
    buildAutomationDefaultActiveStepOptions(steps).map((option) => option.value),
  );

  return listableIds.has(defaultActiveStepId) ? defaultActiveStepId : null;
}

function resolveOpenMode(
  step: AutomationStep,
  index: number,
): AutomationStepOpenMode {
  if (index === 0) {
    return 'separate';
  }

  if (step.openMode === 'split-with-previous' || step.openMode === 'grid-with-previous') {
    return step.openMode;
  }

  return 'separate';
}

export function normalizeAutomationSteps(steps: AutomationStep[]): AutomationStep[] {
  return steps.map((step, index): AutomationStep => {
    const openMode = resolveOpenMode(step, index);

    if (isJoinWithPreviousOpenMode(openMode)) {
      const { tabTitle, pinned, ...rest } = step;
      return { ...rest, openMode };
    }

    return { ...step, openMode };
  });
}

export function normalizeAutomation(automation: LegacyAutomation): Automation {
  const legacyLayout = automation.tabLayout;
  const steps = automation.steps.map((step, index) => {
    if (step.openMode) {
      return step;
    }

    if (legacyLayout === 'split') {
      return {
        ...step,
        openMode: index === 0 ? ('separate' as const) : ('split-with-previous' as const),
      };
    }

    return { ...step, openMode: 'separate' as const };
  });

  const normalizedSteps = normalizeAutomationSteps(steps);
  const defaultActiveStepId = normalizeAutomationDefaultActiveStepId(
    normalizedSteps,
    automation.defaultActiveStepId,
  );
  const trigger: AutomationTrigger =
    automation.trigger === 'interval' ? 'interval' : 'manual';

  return {
    id: automation.id,
    name: automation.name,
    trigger,
    intervalMinutes: trigger === 'interval' ? automation.intervalMinutes : undefined,
    closeOpenTabsBeforeRun: automation.closeOpenTabsBeforeRun,
    defaultActiveStepId,
    steps: normalizedSteps,
  };
}

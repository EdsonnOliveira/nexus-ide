import type { Automation, AutomationStep, AutomationStepOpenMode } from '@/types/automation';
import { resolveAutomationStepTabOptionLabel } from '@/utils/automationLabels';

type LegacyAutomation = Omit<Automation, 'defaultActiveStepId'> & {
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

export function groupAutomationSteps(steps: AutomationStep[]): AutomationStepGroup[] {
  const groups: AutomationStepGroup[] = [];

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];

    if (index === 0 || step.openMode !== 'split-with-previous') {
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
  if (step.openMode === 'split-with-previous') {
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

export function normalizeAutomationSteps(steps: AutomationStep[]): AutomationStep[] {
  return steps.map((step, index): AutomationStep => {
    const openMode: AutomationStepOpenMode =
      index === 0
        ? 'separate'
        : step.openMode === 'split-with-previous'
          ? 'split-with-previous'
          : 'separate';

    if (openMode === 'split-with-previous') {
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

  return {
    id: automation.id,
    name: automation.name,
    trigger: automation.trigger,
    intervalMinutes: automation.intervalMinutes,
    closeOpenTabsBeforeRun: automation.closeOpenTabsBeforeRun,
    defaultActiveStepId,
    steps: normalizedSteps,
  };
}

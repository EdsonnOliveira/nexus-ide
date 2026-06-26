import type { Automation } from '@/types/automation';
import { AUTOMATION_MAX_STEPS } from '@/types/automation';

export function createDefaultAutomation(): Automation {
  return {
    id: crypto.randomUUID(),
    name: 'Nova automação',
    trigger: 'manual',
    closeOpenTabsBeforeRun: false,
    defaultActiveStepId: null,
    steps: [],
  };
}

export function canAddAutomationStep(stepsCount: number): boolean {
  return stepsCount < AUTOMATION_MAX_STEPS;
}

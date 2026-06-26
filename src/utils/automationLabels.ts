import type { Automation, AutomationStep, AutomationStepType } from '@/types/automation';

export function getAutomationStepLabel(type: AutomationStepType): string {
  if (type === 'terminal') {
    return 'Abrir Terminal';
  }

  if (type === 'agent') {
    return 'Abrir Agent';
  }

  if (type === 'browser') {
    return 'Abrir Navegador';
  }

  if (type === 'emulator') {
    return 'Abrir Emulador';
  }

  return 'Abrir API Client';
}

export function resolveAutomationStepTabOptionLabel(
  step: AutomationStep,
  index: number,
  steps: AutomationStep[],
): string {
  const title = step.tabTitle?.trim();

  if (title) {
    return title;
  }

  const base = getAutomationStepLabel(step.type).replace('Abrir ', '');
  const priorSameType = steps.slice(0, index).filter((item) => item.type === step.type).length;

  if (priorSameType > 0) {
    return `${base} ${priorSameType + 1}`;
  }

  return base;
}

export function summarizeAutomationSteps(types: AutomationStepType[]): string {
  if (types.length === 0) {
    return 'Sem ações';
  }

  return types.map((type) => getAutomationStepLabel(type).replace('Abrir ', '')).join(' → ');
}

export function formatAutomationTrigger(trigger: Automation['trigger'], intervalMinutes?: number): string {
  if (trigger === 'interval' && intervalMinutes) {
    return `A cada ${intervalMinutes} min`;
  }

  if (trigger === 'app_open') {
    return 'Ao abrir a IDE';
  }

  return 'Por clique';
}

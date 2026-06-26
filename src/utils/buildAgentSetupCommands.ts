import type { AutomationStep } from '@/types/automation';

export function buildAgentSetupCommands(step: AutomationStep): string[] {
  if (step.type !== 'agent') {
    return [];
  }

  const commands: string[] = [];

  if (step.agentMode) {
    commands.push(`/${step.agentMode}`);
  }

  if (step.agentModel) {
    commands.push(`/model ${step.agentModel}`);
  }

  return commands;
}

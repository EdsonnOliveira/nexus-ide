import type { AutomationAgentMode } from '@/constants/agentModes';
import { AGENT_MODE_OPTIONS } from '@/constants/agentModes';

const MODE_ORDER = AGENT_MODE_OPTIONS.map((option) => option.id);

export function cycleAgentMode(current: AutomationAgentMode | null | undefined): AutomationAgentMode {
  const active = current ?? 'agent';
  const index = MODE_ORDER.indexOf(active);
  const nextIndex = index === -1 ? 0 : (index + 1) % MODE_ORDER.length;

  return MODE_ORDER[nextIndex] ?? 'agent';
}

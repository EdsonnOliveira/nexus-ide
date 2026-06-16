import { getAgentModeHints } from './agentModes';
import { getAgentModelHints } from './agentModels';
import { getAgentSkillHints } from './agentSkills';
import type { TerminalCommandHint } from './terminalHints';

export function getAgentFooterHints(cwd: string): TerminalCommandHint[] {
  return [...getAgentModeHints(), ...getAgentModelHints(), ...getAgentSkillHints(cwd)];
}

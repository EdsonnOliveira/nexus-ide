import logoClaude from '@/assets/logo-claude.svg';
import logoCodex from '@/assets/logo-codex.svg';
import logoCursor from '@/assets/logo-cursor.svg';
import logoGemini from '@/assets/logo-gemini.svg';
import iconModeAgent from '@/assets/icon-mode-agent.svg';
import iconModeAsk from '@/assets/icon-mode-ask.svg';
import iconModeDebug from '@/assets/icon-mode-debug.svg';
import iconModeMultitask from '@/assets/icon-mode-multitask.svg';
import iconModePlan from '@/assets/icon-mode-plan.svg';
import { AGENT_MODE_OPTIONS, type AgentModeBadgeIcon } from '@/constants/agentModes';
import type { TerminalCommandHint } from '@/types';

export const AGENT_HINT_BADGE_ICON_SRC = {
  cursor: logoCursor,
  claude: logoClaude,
  codex: logoCodex,
  gemini: logoGemini,
  'mode-agent': iconModeAgent,
  'mode-plan': iconModePlan,
  'mode-ask': iconModeAsk,
  'mode-debug': iconModeDebug,
  'mode-multitask': iconModeMultitask,
} as const;

export const AGENT_HINT_BADGE_COLORS = {
  cursor: '#6366f1',
  claude: '#cc785c',
  codex: '#10a37f',
  gemini: '#1c69ff',
} as const;

const MODE_BADGE_COLORS = Object.fromEntries(
  AGENT_MODE_OPTIONS.map((mode) => [mode.badgeIcon, mode.badgeColor]),
) as Record<AgentModeBadgeIcon, string>;

export type AgentHintBadgeIcon = keyof typeof AGENT_HINT_BADGE_ICON_SRC;

export function resolveModelBadgeIcon(modelId: string, label: string): AgentHintBadgeIcon {
  const id = modelId.toLowerCase();
  const text = label.toLowerCase();

  if (id === 'auto' || text === 'auto') {
    return 'cursor';
  }

  if (id.includes('composer') || text.includes('composer')) {
    return 'cursor';
  }

  if (
    id.includes('claude') ||
    id.includes('opus') ||
    id.includes('sonnet') ||
    id.includes('haiku') ||
    text.includes('opus') ||
    text.includes('claude') ||
    text.includes('sonnet') ||
    text.includes('haiku')
  ) {
    return 'claude';
  }

  if (
    id.includes('codex') ||
    id.includes('gpt') ||
    id.includes('o3') ||
    id.includes('o4') ||
    text.includes('codex') ||
    text.includes('gpt')
  ) {
    return 'codex';
  }

  if (id.includes('gemini') || text.includes('gemini')) {
    return 'gemini';
  }

  return 'cursor';
}

export function resolveModelBadgeColor(icon: AgentHintBadgeIcon): string {
  if (icon in AGENT_HINT_BADGE_COLORS) {
    return AGENT_HINT_BADGE_COLORS[icon as keyof typeof AGENT_HINT_BADGE_COLORS];
  }

  return AGENT_HINT_BADGE_COLORS.cursor;
}

export function resolveHintBadgeColor(hint: TerminalCommandHint): string | undefined {
  if (hint.badgeColor) {
    return hint.badgeColor;
  }

  if (hint.badgeIcon && hint.badgeIcon in MODE_BADGE_COLORS) {
    return MODE_BADGE_COLORS[hint.badgeIcon as AgentModeBadgeIcon];
  }

  if (hint.badgeIcon && hint.badgeIcon in AGENT_HINT_BADGE_COLORS) {
    return AGENT_HINT_BADGE_COLORS[hint.badgeIcon as keyof typeof AGENT_HINT_BADGE_COLORS];
  }

  return undefined;
}

export function resolveHintBadgeIconSrc(hint: TerminalCommandHint): string | null {
  if (!hint.badgeIcon) {
    return null;
  }

  if (hint.badgeIcon in AGENT_HINT_BADGE_ICON_SRC) {
    return AGENT_HINT_BADGE_ICON_SRC[hint.badgeIcon as AgentHintBadgeIcon];
  }

  return null;
}

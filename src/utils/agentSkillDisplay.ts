import type { TerminalCommandHint } from '@/types';
import { resolvePromptDisplayContent } from '@/utils/agentPromptAttachments';

const SKILL_SLASH_PATTERN = /^\/[^\s/]+(?:\/[^\s/]+)*$/;

export function isAgentSkillSlashCommand(value: string): boolean {
  return SKILL_SLASH_PATTERN.test(value.trim());
}

export interface ComposerSkillDraftState {
  hasSkill: boolean;
  skillLabel: string;
  skillCommand: string;
  body: string;
  prefixLength: number;
}

export function parseComposerSkillDraft(
  draft: string,
  skillHints: TerminalCommandHint[],
): ComposerSkillDraftState {
  const leadingWhitespace = draft.match(/^\s*/)?.[0]?.length ?? 0;
  const rest = draft.slice(leadingWhitespace);
  const match = rest.match(/^(\/[^\s/]+(?:\/[^\s/]+)*)(?:\s([\s\S]*))?$/);

  if (!match) {
    return {
      hasSkill: false,
      skillLabel: '',
      skillCommand: '',
      body: draft,
      prefixLength: 0,
    };
  }

  const skillCommand = match[1];
  const body = match[2] ?? '';
  const skillName = skillCommand.slice(1);
  const knownHint = skillHints.find(
    (hint) => hint.hintKind === 'skill' && hint.label.toLowerCase() === skillName.toLowerCase(),
  );

  if (!knownHint && !isAgentSkillSlashCommand(skillCommand)) {
    return {
      hasSkill: false,
      skillLabel: '',
      skillCommand: '',
      body: draft,
      prefixLength: 0,
    };
  }

  const skillLabel = knownHint ? `/${knownHint.label}` : skillCommand;
  const hasTrailingSeparator = rest.length > skillCommand.length && rest[skillCommand.length] === ' ';

  if (!hasTrailingSeparator) {
    return {
      hasSkill: false,
      skillLabel: '',
      skillCommand: '',
      body: draft,
      prefixLength: 0,
    };
  }

  return {
    hasSkill: true,
    skillLabel,
    skillCommand,
    body,
    prefixLength: leadingWhitespace + skillCommand.length + 1,
  };
}

export function normalizeSkillToken(value: string): string {
  return value.trim().replace(/^\/+/, '').toLowerCase();
}

export function shouldShowSkillChipAbovePrompt(content: string, skillChipLabel: string): boolean {
  const chip = skillChipLabel.trim();

  if (!chip) {
    return false;
  }

  const bubble = content.trim();

  if (!bubble) {
    return true;
  }

  return normalizeSkillToken(chip) !== normalizeSkillToken(bubble);
}

export function resolveAgentSkillDisplayState(user: {
  content: string;
  skillLabel?: string;
  agentPrompt?: string;
}): {
  hasSkillPrompt: boolean;
  skillChipLabel: string;
} {
  const content = user.content.trim();
  const skillLabel = user.skillLabel?.trim() ?? '';
  const agentPrompt = user.agentPrompt?.trim() ?? '';

  if (skillLabel) {
    return { hasSkillPrompt: true, skillChipLabel: skillLabel };
  }

  if (agentPrompt) {
    return { hasSkillPrompt: true, skillChipLabel: content || skillLabel };
  }

  if (isAgentSkillSlashCommand(content)) {
    return { hasSkillPrompt: true, skillChipLabel: content };
  }

  return { hasSkillPrompt: false, skillChipLabel: '' };
}

export function resolveFollowUpEnqueueFields(prompt: string): {
  content: string;
  skillLabel?: string;
  agentPrompt?: string;
} {
  const trimmed = prompt.trim();
  const parsed = parseComposerSkillDraft(prompt, []);

  if (parsed.hasSkill) {
    const content = resolvePromptDisplayContent(parsed.body);

    return {
      content,
      skillLabel: parsed.skillLabel,
      ...(trimmed !== content ? { agentPrompt: trimmed } : {}),
    };
  }

  const skillState = resolveAgentSkillDisplayState({ content: trimmed });

  if (skillState.hasSkillPrompt && isAgentSkillSlashCommand(trimmed)) {
    return {
      content: trimmed,
      skillLabel: skillState.skillChipLabel,
    };
  }

  return { content: resolvePromptDisplayContent(trimmed) };
}

export function resolveFollowUpAgentPrompt(item: {
  content: string;
  skillLabel?: string;
  agentPrompt?: string;
}): string {
  const agentPrompt = item.agentPrompt?.trim();

  if (agentPrompt) {
    return agentPrompt;
  }

  const content = item.content.trim();
  const skillLabel = item.skillLabel?.trim() ?? '';

  if (skillLabel && content && normalizeSkillToken(skillLabel) !== normalizeSkillToken(content)) {
    return `${skillLabel} ${content}`;
  }

  return content;
}

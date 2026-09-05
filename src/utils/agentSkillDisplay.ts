import type { TerminalCommandHint } from '@/types';
import { isSelectableAiProviderId, type AiProviderId } from '@/constants/aiProviders';
import { isAgentSetupCommand } from '@/utils/parseAgentModeCommand';
import { resolvePromptDisplayContent } from '@/utils/agentPromptAttachments';

const SKILL_SLASH_PATTERN = /^\/[^\s/]+(?:\/[^\s/]+)*$/;
const SKILL_COMMAND_PATTERN = /^(\/[^\s/]+(?:\/[^\s/]+)*)/;

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
  const hasTrailingSeparator =
    rest.length > skillCommand.length && rest[skillCommand.length] === ' ';

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

function extractLeadingSkillToken(prompt: string): string {
  const match = SKILL_COMMAND_PATTERN.exec(prompt.trim());

  if (!match?.[1]) {
    return '';
  }

  return normalizeSkillToken(match[1]);
}

function resolveHintSkillAiProvider(
  hint: TerminalCommandHint | undefined,
): Exclude<AiProviderId, 'nexus'> | null {
  if (!hint || hint.hintKind !== 'skill') {
    return null;
  }

  if (hint.skillAiProvider && isSelectableAiProviderId(hint.skillAiProvider)) {
    return hint.skillAiProvider;
  }

  return 'cursor';
}

export function resolvePromptSkillAiProvider(
  prompt: string,
  skillHints: TerminalCommandHint[],
): Exclude<AiProviderId, 'nexus'> | null {
  const trimmed = prompt.trim();

  if (!trimmed || isAgentSetupCommand(trimmed)) {
    return null;
  }

  const parsed = parseComposerSkillDraft(trimmed, skillHints);
  const skillToken = parsed.hasSkill
    ? normalizeSkillToken(parsed.skillLabel)
    : extractLeadingSkillToken(trimmed);

  if (!skillToken) {
    return null;
  }

  const hint = skillHints.find(
    (entry) => entry.hintKind === 'skill' && normalizeSkillToken(entry.label) === skillToken,
  );

  return resolveHintSkillAiProvider(hint);
}

export function formatSkillChipLabel(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('/')) {
    return trimmed.match(SKILL_COMMAND_PATTERN)?.[1] ?? trimmed;
  }

  if (/^[^\s/]+(?:\/[^\s/]+)*$/.test(trimmed)) {
    return `/${trimmed}`;
  }

  const withSlash = `/${trimmed}`;
  return withSlash.match(SKILL_COMMAND_PATTERN)?.[1] ?? trimmed;
}

function stripSkillPrefixFromContent(content: string, skillChipLabel: string): string {
  const trimmed = content.trim();

  if (!trimmed || !skillChipLabel) {
    return resolvePromptDisplayContent(trimmed);
  }

  const parsed = parseComposerSkillDraft(trimmed, []);

  if (
    parsed.hasSkill &&
    normalizeSkillToken(parsed.skillLabel) === normalizeSkillToken(skillChipLabel)
  ) {
    return resolvePromptDisplayContent(parsed.body);
  }

  const skillCommand = formatSkillChipLabel(skillChipLabel);

  if (
    skillCommand &&
    (trimmed === skillCommand ||
      trimmed.startsWith(`${skillCommand} `) ||
      normalizeSkillToken(trimmed) === normalizeSkillToken(skillCommand))
  ) {
    if (
      trimmed === skillCommand ||
      normalizeSkillToken(trimmed) === normalizeSkillToken(skillCommand)
    ) {
      return '';
    }

    return resolvePromptDisplayContent(trimmed.slice(skillCommand.length).trimStart());
  }

  return resolvePromptDisplayContent(trimmed);
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

export function isSkillOnlyPrompt(
  user: {
    content: string;
    skillLabel?: string;
    agentPrompt?: string;
  },
  bubbleContent: string,
  attachmentCount = 0,
): boolean {
  const { hasSkillPrompt, skillChipLabel } = resolveAgentSkillDisplayState(user);

  if (!hasSkillPrompt || attachmentCount > 0) {
    return false;
  }

  const bubble = bubbleContent.trim();

  if (!bubble) {
    return true;
  }

  return normalizeSkillToken(bubble) === normalizeSkillToken(skillChipLabel);
}

export function resolveAgentSkillDisplayState(user: {
  content: string;
  skillLabel?: string;
  agentPrompt?: string;
}): {
  hasSkillPrompt: boolean;
  skillChipLabel: string;
  promptBody: string;
} {
  const content = user.content.trim();
  const skillLabelRaw = user.skillLabel?.trim() ?? '';
  const agentPrompt = user.agentPrompt?.trim() ?? '';
  const parsedFromPrompt = agentPrompt ? parseComposerSkillDraft(agentPrompt, []) : null;
  const parsedFromContent = content ? parseComposerSkillDraft(content, []) : null;

  if (skillLabelRaw) {
    const skillChipLabel = formatSkillChipLabel(skillLabelRaw);
    const promptBody = stripSkillPrefixFromContent(
      content || (parsedFromPrompt?.hasSkill ? parsedFromPrompt.body : ''),
      skillChipLabel,
    );

    return { hasSkillPrompt: true, skillChipLabel, promptBody };
  }

  if (parsedFromPrompt?.hasSkill) {
    const skillChipLabel = parsedFromPrompt.skillLabel;
    const promptBody = content
      ? stripSkillPrefixFromContent(content, skillChipLabel)
      : resolvePromptDisplayContent(parsedFromPrompt.body);

    return { hasSkillPrompt: true, skillChipLabel, promptBody };
  }

  if (parsedFromContent?.hasSkill) {
    return {
      hasSkillPrompt: true,
      skillChipLabel: parsedFromContent.skillLabel,
      promptBody: resolvePromptDisplayContent(parsedFromContent.body),
    };
  }

  if (isAgentSkillSlashCommand(content)) {
    return { hasSkillPrompt: true, skillChipLabel: content, promptBody: '' };
  }

  return { hasSkillPrompt: false, skillChipLabel: '', promptBody: content };
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
    return `${formatSkillChipLabel(skillLabel)} ${content}`;
  }

  return content;
}

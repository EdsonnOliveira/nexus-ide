import type { TerminalCommandHint } from '@/types';

function isUserSkill(hint: TerminalCommandHint): boolean {
  return hint.skillOrigin === 'user';
}

export function compareDailySkillHints(
  left: TerminalCommandHint,
  right: TerminalCommandHint,
): number {
  const leftRank = isUserSkill(left) ? 0 : 1;
  const rightRank = isUserSkill(right) ? 0 : 1;

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  return left.label.localeCompare(right.label, 'pt-BR');
}

export function mergeDailySkillHint(
  hintsById: Map<string, TerminalCommandHint>,
  hint: TerminalCommandHint,
): void {
  if (hint.hintKind !== 'skill') {
    return;
  }

  const existing = hintsById.get(hint.id);

  if (!existing) {
    hintsById.set(hint.id, hint);
    return;
  }

  if (isUserSkill(hint) && !isUserSkill(existing)) {
    hintsById.set(hint.id, hint);
  }
}

export function sortDailySkillHints(hints: TerminalCommandHint[]): TerminalCommandHint[] {
  return [...hints].sort(compareDailySkillHints);
}

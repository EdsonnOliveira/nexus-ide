import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TerminalCommandHint } from './terminalHints';
import { findProjectRoot } from './terminalHints';

const MAX_SKILL_HINTS = 14;
const SKILL_BADGE_COLOR = '#8b5cf6';

function readSkillName(skillDir: string, folderName: string): string {
  try {
    const content = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    const match = content.match(/^---[\s\S]*?\nname:\s*([^\n\r]+)/m);

    if (match?.[1]) {
      return match[1].trim();
    }
  } catch {
    return folderName;
  }

  return folderName;
}

function collectSkillsFromDirectory(
  skillsRoot: string,
  seen: Set<string>,
  hints: TerminalCommandHint[],
  skillOrigin: 'user' | 'builtin',
): void {
  if (!existsSync(skillsRoot)) {
    return;
  }

  let entries: { name: string; isDirectory: () => boolean }[] = [];

  try {
    entries = readdirSync(skillsRoot, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillDir = path.join(skillsRoot, entry.name);
    const skillFile = path.join(skillDir, 'SKILL.md');

    if (!existsSync(skillFile)) {
      continue;
    }

    const name = readSkillName(skillDir, entry.name);

    if (!name || seen.has(name)) {
      continue;
    }

    seen.add(name);
    hints.push({
      id: `skill-${name}`,
      badge: '/',
      badgeColor: SKILL_BADGE_COLOR,
      label: name,
      command: `/${name}\n`,
      hintKind: 'skill',
      skillOrigin,
    });
  }
}

export function getAgentSkillHints(cwd: string): TerminalCommandHint[] {
  const resolvedCwd = path.resolve(cwd);
  const seen = new Set<string>();
  const userHints: TerminalCommandHint[] = [];
  const builtinHints: TerminalCommandHint[] = [];
  const home = os.homedir();
  const projectRoot = findProjectRoot(resolvedCwd);

  if (projectRoot) {
    collectSkillsFromDirectory(
      path.join(projectRoot, '.cursor', 'skills'),
      seen,
      userHints,
      'user',
    );
  }

  collectSkillsFromDirectory(path.join(home, '.cursor', 'skills'), seen, userHints, 'user');
  collectSkillsFromDirectory(
    path.join(home, '.cursor', 'skills-cursor'),
    seen,
    builtinHints,
    'builtin',
  );

  const sortByLabel = (left: TerminalCommandHint, right: TerminalCommandHint) =>
    left.label.localeCompare(right.label);

  userHints.sort(sortByLabel);
  builtinHints.sort(sortByLabel);

  const remainingSlots = Math.max(0, MAX_SKILL_HINTS - userHints.length);

  return [...userHints, ...builtinHints.slice(0, remainingSlots)];
}

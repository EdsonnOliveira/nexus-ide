import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_SKILL_HINTS = 14;
const SKILL_BADGE_COLOR = '#8b5cf6';

export interface AgentSkillHint {
  id: string;
  badge: string;
  badgeColor: string;
  label: string;
  command: string;
  hintKind: 'skill';
  skillOrigin: 'user' | 'builtin';
}

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
  hints: AgentSkillHint[],
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

    const name = readSkillName(skillDir, entry.name)
      .replace(/[\r\n\u0000]/g, '')
      .trim()
      .slice(0, 80);

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

function collectProjectSkillsWalkingUp(
  startDir: string,
  home: string,
  seen: Set<string>,
  hints: AgentSkillHint[],
): void {
  let current = path.resolve(startDir);
  const resolvedHome = path.resolve(home);

  while (true) {
    if (current === resolvedHome) {
      break;
    }

    collectSkillsFromDirectory(path.join(current, '.cursor', 'skills'), seen, hints, 'user');

    const parent = path.dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }
}

export function getAgentSkillHints(cwd: string | null): AgentSkillHint[] {
  const seen = new Set<string>();
  const userHints: AgentSkillHint[] = [];
  const builtinHints: AgentSkillHint[] = [];
  const home = os.homedir();

  if (cwd) {
    collectProjectSkillsWalkingUp(path.resolve(cwd), home, seen, userHints);
  }

  collectSkillsFromDirectory(path.join(home, '.cursor', 'skills'), seen, userHints, 'user');
  collectSkillsFromDirectory(
    path.join(home, '.cursor', 'skills-cursor'),
    seen,
    builtinHints,
    'builtin',
  );

  const sortByLabel = (left: AgentSkillHint, right: AgentSkillHint) =>
    left.label.localeCompare(right.label);

  userHints.sort(sortByLabel);
  builtinHints.sort(sortByLabel);

  const remainingSlots = Math.max(0, MAX_SKILL_HINTS - userHints.length);

  return [...userHints, ...builtinHints.slice(0, remainingSlots)];
}

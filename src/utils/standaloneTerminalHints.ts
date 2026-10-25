import { shellEscapeSingleQuotes } from '@/utils/agentCliSession';
import type { Project, TerminalCommandHint } from '@/types';

export const STANDALONE_TERMINAL_PROJECT_ID = 'standalone-global-terminal';

const MAX_STANDALONE_PROJECT_HINTS = 12;
const MAX_HINTS_PER_MAESTRO_PROJECT = 3;

function normalizeFsPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function isPathInsideProject(projectPath: string, cwd: string): boolean {
  const root = normalizeFsPath(projectPath);
  const current = normalizeFsPath(cwd);

  return current === root || current.startsWith(`${root}/`);
}

function isCliAgentHint(hint: TerminalCommandHint): boolean {
  return hint.id.startsWith('cli-');
}

function ensureCommandNewline(command: string): string {
  return command.endsWith('\n') ? command : `${command}\n`;
}

function stripCommandNewline(command: string): string {
  return command.replace(/\n$/, '');
}

function commandAlreadyChangesDirectory(command: string): boolean {
  return /^\s*cd\s+/i.test(command);
}

function withProjectWorkingDirectory(command: string, projectPath: string, cwd: string): string {
  const rawCommand = stripCommandNewline(command);

  if (!rawCommand || commandAlreadyChangesDirectory(rawCommand) || isPathInsideProject(projectPath, cwd)) {
    return ensureCommandNewline(rawCommand);
  }

  return ensureCommandNewline(`cd ${shellEscapeSingleQuotes(projectPath)} && ${rawCommand}`);
}

export function isStandaloneTerminalProjectId(projectId: string): boolean {
  return projectId === STANDALONE_TERMINAL_PROJECT_ID;
}

export function adaptProjectHintForStandalone(
  hint: TerminalCommandHint,
  project: Project,
  cwd: string,
): TerminalCommandHint {
  const rawCommand = stripCommandNewline(hint.command);
  const command = withProjectWorkingDirectory(rawCommand, project.path, cwd);

  return {
    ...hint,
    id: `maestro-${project.id}-${hint.id}`,
    badge: project.name,
    badgeIcon: undefined,
    badgeColor: project.color,
    badgeLogo: project.logo,
    badgeProjectIcon: project.icon,
    label: hint.label,
    command,
  };
}

export function buildMaestroQuickCommandHints(
  projects: Project[],
  cwd: string,
): TerminalCommandHint[] {
  const hints: TerminalCommandHint[] = [];

  for (const project of projects) {
    for (const entry of project.terminalQuickCommands ?? []) {
      const rawCommand = stripCommandNewline(entry.command);
      const label = stripCommandNewline(entry.label) || rawCommand;

      if (!rawCommand) {
        continue;
      }

      hints.push(
        adaptProjectHintForStandalone(
          {
            id: `quick-${entry.id}`,
            badge: project.name,
            badgeColor: project.color,
            label,
            command: ensureCommandNewline(rawCommand),
          },
          project,
          cwd,
        ),
      );
    }
  }

  return hints;
}

export function mergeStandaloneTerminalHints(
  cwdHints: TerminalCommandHint[],
  projectHintGroups: Array<{ project: Project; hints: TerminalCommandHint[] }>,
  cwd: string,
  quickCommandHints: TerminalCommandHint[] = [],
): TerminalCommandHint[] {
  const seen = new Set<string>();
  const merged: TerminalCommandHint[] = [];

  const push = (hint: TerminalCommandHint) => {
    const key = stripCommandNewline(hint.command);

    if (!key || seen.has(key)) {
      return;
    }

    seen.add(key);
    merged.push(hint);
  };

  for (const hint of quickCommandHints) {
    push(hint);

    if (merged.length >= MAX_STANDALONE_PROJECT_HINTS) {
      return merged;
    }
  }

  for (const { project, hints } of projectHintGroups) {
    let addedForProject = 0;

    for (const hint of hints) {
      if (isCliAgentHint(hint)) {
        continue;
      }

      const beforeCount = merged.length;
      push(adaptProjectHintForStandalone(hint, project, cwd));

      if (merged.length > beforeCount) {
        addedForProject += 1;
      }

      if (
        addedForProject >= MAX_HINTS_PER_MAESTRO_PROJECT ||
        merged.length >= MAX_STANDALONE_PROJECT_HINTS
      ) {
        break;
      }
    }

    if (merged.length >= MAX_STANDALONE_PROJECT_HINTS) {
      break;
    }
  }

  for (const hint of cwdHints) {
    push(hint);
  }

  return merged;
}

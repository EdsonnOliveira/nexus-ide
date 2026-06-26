import type { Project } from '@/types';
import type {
  ParsedGlobalSearchQuery,
  SlashCommandId,
  SlashCommandMeta,
  SlashCommandPhase,
  SlashCommandQuery,
} from '@/utils/globalSearchTypes';

export const SLASH_COMMANDS: SlashCommandId[] = [
  'project',
  'tab',
  'file',
  'git',
  'task',
  'form',
  'automation',
  'agent',
  'terminal',
  'browser',
  'emulator',
  'api',
  'music',
];

const FREE_TEXT_PAYLOAD_COMMANDS = new Set<SlashCommandId>(['agent', 'terminal', 'browser']);

export function isStaticSlashResultQuery(slash: SlashCommandQuery): boolean {
  return slash.phase === 'payload' && FREE_TEXT_PAYLOAD_COMMANDS.has(slash.command);
}

export function buildGlobalSearchEffectKey(
  parsed: ParsedGlobalSearchQuery,
  agentListVersion = '',
): string {
  if (parsed.mode === 'free' && !parsed.freeText.trim()) {
    return 'initial';
  }

  if (parsed.mode === 'free') {
    return `free:${parsed.freeText}`;
  }

  if (!parsed.slash) {
    return `slash-commands:${parsed.suggestedCommands.join(',')}`;
  }

  const slash = parsed.slash;

  if (isStaticSlashResultQuery(slash)) {
    if (slash.command === 'agent' || slash.command === 'terminal') {
      return `slash-static:${slash.command}:${slash.projectId}:${slash.phase}:${agentListVersion}`;
    }

    return `slash-static:${slash.command}:${slash.projectId}:${slash.phase}`;
  }

  return `slash:${slash.command}:${slash.phase}:${slash.projectId}:${slash.filterText}:${slash.isCurlPayload}`;
}

const SLASH_COMMAND_META: Record<SlashCommandId, SlashCommandMeta> = {
  project: {
    id: 'project',
    badge: 'Project',
    placeholder: 'Pesquisar projeto…',
    requiresProject: false,
    hasEntityList: true,
    isFreeTextPayload: false,
  },
  tab: {
    id: 'tab',
    badge: 'Tab',
    placeholder: 'Pesquisar aba…',
    requiresProject: true,
    hasEntityList: true,
    isFreeTextPayload: false,
  },
  file: {
    id: 'file',
    badge: 'File',
    placeholder: 'Pesquisar arquivo…',
    requiresProject: true,
    hasEntityList: true,
    isFreeTextPayload: false,
  },
  git: {
    id: 'git',
    badge: 'Git',
    placeholder: 'Pesquisar alteração git…',
    requiresProject: true,
    hasEntityList: true,
    isFreeTextPayload: false,
  },
  task: {
    id: 'task',
    badge: 'Task',
    placeholder: 'Pesquisar tarefa…',
    requiresProject: true,
    hasEntityList: true,
    isFreeTextPayload: false,
  },
  form: {
    id: 'form',
    badge: 'Formulário',
    placeholder: 'Pesquisar formulário…',
    requiresProject: true,
    hasEntityList: true,
    isFreeTextPayload: false,
  },
  automation: {
    id: 'automation',
    badge: 'Automation',
    placeholder: 'Pesquisar automação…',
    requiresProject: true,
    hasEntityList: true,
    isFreeTextPayload: false,
  },
  agent: {
    id: 'agent',
    badge: 'Agent',
    placeholder: 'Prompt para o agent…',
    requiresProject: true,
    hasEntityList: false,
    isFreeTextPayload: true,
  },
  terminal: {
    id: 'terminal',
    badge: 'Terminal',
    placeholder: 'Comando do terminal…',
    requiresProject: true,
    hasEntityList: false,
    isFreeTextPayload: true,
  },
  browser: {
    id: 'browser',
    badge: 'Browser',
    placeholder: 'URL do navegador…',
    requiresProject: true,
    hasEntityList: false,
    isFreeTextPayload: true,
  },
  emulator: {
    id: 'emulator',
    badge: 'Emulator',
    placeholder: 'Pesquisar dispositivo…',
    requiresProject: true,
    hasEntityList: true,
    isFreeTextPayload: false,
  },
  api: {
    id: 'api',
    badge: 'API',
    placeholder: 'Cole cURL ou pesquise rota…',
    requiresProject: true,
    hasEntityList: true,
    isFreeTextPayload: false,
  },
  music: {
    id: 'music',
    badge: 'Music',
    placeholder: 'Pesquisar música ou playlist…',
    requiresProject: false,
    hasEntityList: true,
    isFreeTextPayload: false,
  },
};

function resolveSlashCommandPhase(
  command: SlashCommandId,
  requiresProject: boolean,
  projectToken: string | null,
  projectId: string | null,
  remainderHasAt: boolean,
  filterText: string,
): SlashCommandPhase {
  if (requiresProject) {
    if (remainderHasAt && (!projectToken || !projectId)) {
      return 'project';
    }

    if (!projectToken || !projectId) {
      return 'project';
    }

    if (FREE_TEXT_PAYLOAD_COMMANDS.has(command)) {
      return 'payload';
    }

    if (command === 'api' && isCurlPayload(filterText)) {
      return 'payload';
    }

    return 'entity';
  }

  return 'entity';
}

function sortProjectsByNameLength(projects: Project[]): Project[] {
  return [...projects].sort((left, right) => right.name.length - left.name.length);
}

function matchesAtProjectPrefix(textAfterAt: string, projectName: string): boolean {
  if (!textAfterAt.toLowerCase().startsWith(projectName.toLowerCase())) {
    return false;
  }

  const boundary = textAfterAt[projectName.length];

  return boundary === undefined || boundary === ' ';
}

function matchSlashProjectAtPrefix(
  textAfterAt: string,
  projects: Project[],
): {
  projectToken: string | null;
  projectId: string | null;
  rest: string;
} | null {
  for (const project of sortProjectsByNameLength(projects)) {
    if (matchesAtProjectPrefix(textAfterAt, project.name)) {
      return {
        projectToken: project.name,
        projectId: project.id,
        rest: textAfterAt.slice(project.name.length).trimStart(),
      };
    }
  }

  return null;
}

function parseSlashRemainder(
  remainder: string,
  projects: Project[],
): {
  projectToken: string | null;
  projectId: string | null;
  rest: string;
  remainderHasAt: boolean;
} {
  const trimmedRemainder = remainder.trimStart();

  if (!trimmedRemainder.startsWith('@')) {
    return {
      projectToken: null,
      projectId: null,
      rest: trimmedRemainder,
      remainderHasAt: trimmedRemainder.includes('@'),
    };
  }

  const matchedProject = matchSlashProjectAtPrefix(trimmedRemainder.slice(1), projects);

  if (matchedProject) {
    return {
      ...matchedProject,
      remainderHasAt: true,
    };
  }

  const partialToken = trimmedRemainder.slice(1).match(/^([^\s@]*)/)?.[1]?.trim() ?? '';
  const trailing = trimmedRemainder.slice(1 + partialToken.length).trimStart();

  return {
    projectToken: partialToken || null,
    projectId: null,
    rest: trailing,
    remainderHasAt: true,
  };
}

export function getSlashCommandMeta(command: SlashCommandId): SlashCommandMeta {
  return SLASH_COMMAND_META[command];
}

export function isCurlPayload(text: string): boolean {
  const trimmed = text.trim();

  if (!trimmed) {
    return false;
  }

  const normalized = trimmed.toLowerCase();

  return normalized.startsWith('curl') || normalized.includes('curl ');
}

export function resolveProjectByToken(projects: Project[], token: string): Project | null {
  const normalizedToken = token.trim().toLowerCase();

  if (!normalizedToken) {
    return null;
  }

  const exactMatches = projects.filter((project) => project.name.toLowerCase() === normalizedToken);

  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  const includesMatches = projects.filter((project) =>
    project.name.toLowerCase().includes(normalizedToken),
  );

  if (includesMatches.length === 0) {
    return null;
  }

  includesMatches.sort((left, right) => {
    const leftStarts = left.name.toLowerCase().startsWith(normalizedToken) ? 0 : 1;
    const rightStarts = right.name.toLowerCase().startsWith(normalizedToken) ? 0 : 1;

    if (leftStarts !== rightStarts) {
      return leftStarts - rightStarts;
    }

    return left.name.localeCompare(right.name, 'pt-BR');
  });

  return includesMatches[0];
}

export function parseGlobalSearchQuery(
  input: string,
  _activeProjectName: string | null,
  projects: Project[] = [],
): ParsedGlobalSearchQuery {
  const trimmedInput = input.trimStart();

  if (!trimmedInput.startsWith('/')) {
    return {
      input,
      mode: 'free',
      freeText: input,
      slash: null,
      suggestedCommands: [],
    };
  }

  const slashBody = trimmedInput.slice(1);
  const commandTokenMatch = slashBody.match(/^([^\s/]+)(?:\s+(.*))?$/s);
  const commandToken = commandTokenMatch?.[1]?.toLowerCase() ?? '';
  const remainder = commandTokenMatch?.[2] ?? '';

  const suggestedCommands = findMatchingSlashCommands(commandToken);

  if (!commandToken || !SLASH_COMMANDS.includes(commandToken as SlashCommandId)) {
    return {
      input,
      mode: 'slash',
      freeText: '',
      slash: null,
      suggestedCommands,
    };
  }

  const command = commandToken as SlashCommandId;
  const meta = getSlashCommandMeta(command);
  const requiresProject = meta.requiresProject;
  const parsedRemainder = parseSlashRemainder(remainder, projects);
  const filterText = requiresProject ? parsedRemainder.rest : remainder.trim();
  const payload =
    requiresProject && (FREE_TEXT_PAYLOAD_COMMANDS.has(command) || (command === 'api' && isCurlPayload(filterText)))
      ? parsedRemainder.rest
      : '';
  const isCurl = command === 'api' && isCurlPayload(filterText);
  const phase = resolveSlashCommandPhase(
    command,
    requiresProject,
    parsedRemainder.projectToken,
    parsedRemainder.projectId,
    parsedRemainder.remainderHasAt,
    filterText,
  );

  const slash: SlashCommandQuery = {
    command,
    requiresProject,
    projectToken: parsedRemainder.projectToken,
    projectId: parsedRemainder.projectId,
    filterText,
    payload,
    isCurlPayload: isCurl,
    phase,
  };

  return {
    input,
    mode: 'slash',
    freeText: '',
    slash,
    suggestedCommands: [],
  };
}

export function stripSlashCommandPrefix(input: string, command: SlashCommandId): string {
  const trimmedStart = input.trimStart();
  const prefix = `/${command}`;

  if (!trimmedStart.toLowerCase().startsWith(prefix)) {
    return input;
  }

  const leadingSpaces = input.length - trimmedStart.length;
  const absolutePrefixEnd = leadingSpaces + prefix.length;
  let remainder = input.slice(absolutePrefixEnd);

  if (remainder.startsWith(' ')) {
    remainder = remainder.slice(1);
  }

  return remainder;
}

export function mergeSlashCommandDisplayInput(
  displayInput: string,
  command: SlashCommandId,
): string {
  if (!displayInput) {
    return `/${command}`;
  }

  return `/${command} ${displayInput}`;
}

function parseDisplayProjectToken(
  displayInput: string,
  projects: Project[],
): { token: string; rest: string } | null {
  const trimmedDisplay = displayInput.trimStart();

  if (!trimmedDisplay.startsWith('@')) {
    return null;
  }

  const matchedProject = matchSlashProjectAtPrefix(trimmedDisplay.slice(1), projects);

  if (matchedProject?.projectToken) {
    return {
      token: matchedProject.projectToken,
      rest: matchedProject.rest,
    };
  }

  const partialToken = trimmedDisplay.slice(1).match(/^([^\s@]*)/)?.[1] ?? '';

  return {
    token: partialToken,
    rest: trimmedDisplay.slice(1 + partialToken.length).trimStart(),
  };
}

function findExactProjectByToken(projects: Project[], token: string): Project | null {
  const normalizedToken = token.trim().toLowerCase();

  if (!normalizedToken) {
    return null;
  }

  return projects.find((project) => project.name.toLowerCase() === normalizedToken) ?? null;
}

export function normalizeSlashProjectDisplayInput(
  previousInput: string,
  nextDisplayInput: string,
  command: SlashCommandId,
  projects: Project[],
): string {
  const previousDisplay = stripSlashCommandPrefix(previousInput, command);
  const previousProject = parseDisplayProjectToken(previousDisplay, projects);
  const nextProject = parseDisplayProjectToken(nextDisplayInput, projects);

  if (!previousProject || !nextProject) {
    return nextDisplayInput;
  }

  const previousExactProject = findExactProjectByToken(projects, previousProject.token);

  if (!previousExactProject) {
    return nextDisplayInput;
  }

  if (nextProject.token.length >= previousProject.token.length) {
    return nextDisplayInput;
  }

  if (nextProject.rest.trim()) {
    return `@ ${nextProject.rest}`;
  }

  return '@';
}

export function getSlashCommandDisplayInput(
  input: string,
  slash: SlashCommandQuery | null,
): string {
  if (!slash) {
    return input;
  }

  return stripSlashCommandPrefix(input, slash.command);
}

export function findMatchingSlashCommands(query: string): SlashCommandId[] {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return [];
  }

  return SLASH_COMMANDS.filter((command) => {
    const badge = getSlashCommandMeta(command).badge.toLowerCase();

    return command.startsWith(normalized) || badge.startsWith(normalized);
  });
}

export function buildSlashCommandSuggestions(
  suggestedCommands: SlashCommandId[],
): SlashCommandId[] {
  if (suggestedCommands.length === 0) {
    return SLASH_COMMANDS;
  }

  return suggestedCommands;
}

export function applyAutoProjectToken(query: string, activeProjectName: string | null): string {
  if (!activeProjectName) {
    return query;
  }

  const trimmed = query.trimEnd();
  const exactCommandMatch = trimmed.match(/^\/([a-z]+)$/i);

  if (exactCommandMatch) {
    const command = exactCommandMatch[1].toLowerCase() as SlashCommandId;

    if (SLASH_COMMANDS.includes(command) && getSlashCommandMeta(command).requiresProject) {
      return `${trimmed} @${activeProjectName} `;
    }
  }

  const spacedCommandMatch = trimmed.match(/^\/([a-z]+)\s+$/i);

  if (spacedCommandMatch && !trimmed.includes('@')) {
    const command = spacedCommandMatch[1].toLowerCase() as SlashCommandId;

    if (SLASH_COMMANDS.includes(command) && getSlashCommandMeta(command).requiresProject) {
      return `${trimmed}@${activeProjectName} `;
    }
  }

  return query;
}

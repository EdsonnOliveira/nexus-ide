import {
  Box,
  Cloud,
  Code2,
  Cpu,
  Database,
  Folder,
  GitBranch,
  Globe,
  Layers,
  Package,
  Puzzle,
  Rocket,
  Server,
  Smartphone,
  Terminal,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export const PROJECT_ICON_PRESET_PREFIX = 'preset:';

export const PROJECT_PRESET_ICONS = [
  { id: 'code', Icon: Code2 },
  { id: 'terminal', Icon: Terminal },
  { id: 'globe', Icon: Globe },
  { id: 'mobile', Icon: Smartphone },
  { id: 'server', Icon: Server },
  { id: 'database', Icon: Database },
  { id: 'package', Icon: Package },
  { id: 'layers', Icon: Layers },
  { id: 'puzzle', Icon: Puzzle },
  { id: 'rocket', Icon: Rocket },
  { id: 'zap', Icon: Zap },
  { id: 'box', Icon: Box },
  { id: 'folder', Icon: Folder },
  { id: 'git', Icon: GitBranch },
  { id: 'cpu', Icon: Cpu },
  { id: 'cloud', Icon: Cloud },
] as const satisfies ReadonlyArray<{ id: string; Icon: LucideIcon }>;

export const PROJECT_PRESET_ICON_LABELS: Record<string, string> = {
  code: 'Código',
  terminal: 'Terminal',
  globe: 'Globo',
  mobile: 'Mobile',
  server: 'Servidor',
  database: 'Banco de dados',
  package: 'Pacote',
  layers: 'Camadas',
  puzzle: 'Puzzle',
  rocket: 'Foguete',
  zap: 'Raio',
  box: 'Caixa',
  folder: 'Pasta',
  git: 'Git',
  cpu: 'CPU',
  cloud: 'Nuvem',
};

export type ProjectPresetIconId = (typeof PROJECT_PRESET_ICONS)[number]['id'];

const PRESET_ICON_MAP = new Map<string, LucideIcon>(
  PROJECT_PRESET_ICONS.map((entry) => [entry.id, entry.Icon]),
);

export function isProjectPresetIcon(icon: string): boolean {
  return icon.startsWith(PROJECT_ICON_PRESET_PREFIX);
}

export function getProjectPresetIconId(icon: string): string | null {
  if (!isProjectPresetIcon(icon)) {
    return null;
  }

  return icon.slice(PROJECT_ICON_PRESET_PREFIX.length);
}

export function resolveProjectPresetIcon(icon: string): LucideIcon | null {
  const presetId = getProjectPresetIconId(icon);

  if (!presetId) {
    return null;
  }

  return PRESET_ICON_MAP.get(presetId) ?? null;
}

export function buildProjectPresetIconValue(id: ProjectPresetIconId): string {
  return `${PROJECT_ICON_PRESET_PREFIX}${id}`;
}

export function resolveCustomProjectIcon(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return '';
  }

  const firstCharacter = [...trimmed][0];

  if (!firstCharacter) {
    return '';
  }

  if (/\p{Extended_Pictographic}/u.test(firstCharacter)) {
    return firstCharacter;
  }

  return firstCharacter.toUpperCase();
}

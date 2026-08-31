import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  Box,
  Braces,
  Briefcase,
  CircuitBoard,
  Code2,
  DollarSign,
  FileText,
  Flag,
  Globe,
  ListChecks,
  Megaphone,
  Package,
  Search,
  ShieldCheck,
  Smartphone,
  Terminal,
  UserCog,
  Workflow,
} from 'lucide-react';
import type { MissionNodeKind } from '@/types/mission';

export interface MissionAgentVisual {
  accent: string;
  accentSoft: string;
  accentBorder: string;
  icon: LucideIcon;
  label: string;
}

const BY_TEMPLATE: Record<string, MissionAgentVisual> = {
  'tpl-investigator': {
    accent: '#a855f7',
    accentSoft: 'rgba(168, 85, 247, 0.16)',
    accentBorder: 'rgba(168, 85, 247, 0.55)',
    icon: Search,
    label: 'Investigação',
  },
  'tpl-backend': {
    accent: '#3b82f6',
    accentSoft: 'rgba(59, 130, 246, 0.16)',
    accentBorder: 'rgba(59, 130, 246, 0.55)',
    icon: Code2,
    label: 'Backend',
  },
  'tpl-frontend': {
    accent: '#2563eb',
    accentSoft: 'rgba(37, 99, 235, 0.16)',
    accentBorder: 'rgba(37, 99, 235, 0.55)',
    icon: Code2,
    label: 'Frontend',
  },
  'tpl-mobile': {
    accent: '#1d4ed8',
    accentSoft: 'rgba(29, 78, 216, 0.18)',
    accentBorder: 'rgba(29, 78, 216, 0.55)',
    icon: Smartphone,
    label: 'Mobile',
  },
  'tpl-qa': {
    accent: '#22c55e',
    accentSoft: 'rgba(34, 197, 94, 0.16)',
    accentBorder: 'rgba(34, 197, 94, 0.55)',
    icon: ShieldCheck,
    label: 'QA',
  },
  'tpl-security': {
    accent: '#ef4444',
    accentSoft: 'rgba(239, 68, 68, 0.16)',
    accentBorder: 'rgba(239, 68, 68, 0.55)',
    icon: ShieldCheck,
    label: 'Security',
  },
  'tpl-reviewer': {
    accent: '#f59e0b',
    accentSoft: 'rgba(245, 158, 11, 0.16)',
    accentBorder: 'rgba(245, 158, 11, 0.55)',
    icon: ListChecks,
    label: 'Review',
  },
  'tpl-researcher': {
    accent: '#94a3b8',
    accentSoft: 'rgba(148, 163, 184, 0.16)',
    accentBorder: 'rgba(148, 163, 184, 0.5)',
    icon: BookOpen,
    label: 'Research',
  },
  'tpl-writer': {
    accent: '#f43f5e',
    accentSoft: 'rgba(244, 63, 94, 0.16)',
    accentBorder: 'rgba(244, 63, 94, 0.55)',
    icon: FileText,
    label: 'Docs',
  },
  'tpl-devops': {
    accent: '#6366f1',
    accentSoft: 'rgba(99, 102, 241, 0.16)',
    accentBorder: 'rgba(99, 102, 241, 0.55)',
    icon: Box,
    label: 'Deploy',
  },
  'tpl-supervisor': {
    accent: '#14b8a6',
    accentSoft: 'rgba(20, 184, 166, 0.16)',
    accentBorder: 'rgba(20, 184, 166, 0.55)',
    icon: UserCog,
    label: 'Supervisor',
  },
  'tpl-ceo': {
    accent: '#eab308',
    accentSoft: 'rgba(234, 179, 8, 0.16)',
    accentBorder: 'rgba(234, 179, 8, 0.55)',
    icon: Briefcase,
    label: 'CEO',
  },
  'tpl-cto': {
    accent: '#38bdf8',
    accentSoft: 'rgba(56, 189, 248, 0.16)',
    accentBorder: 'rgba(56, 189, 248, 0.55)',
    icon: CircuitBoard,
    label: 'CTO',
  },
  'tpl-cfo': {
    accent: '#34d399',
    accentSoft: 'rgba(52, 211, 153, 0.16)',
    accentBorder: 'rgba(52, 211, 153, 0.55)',
    icon: DollarSign,
    label: 'CFO',
  },
  'tpl-cmo': {
    accent: '#fb7185',
    accentSoft: 'rgba(251, 113, 133, 0.16)',
    accentBorder: 'rgba(251, 113, 133, 0.55)',
    icon: Megaphone,
    label: 'CMO',
  },
  'tpl-coo': {
    accent: '#a78bfa',
    accentSoft: 'rgba(167, 139, 250, 0.16)',
    accentBorder: 'rgba(167, 139, 250, 0.55)',
    icon: Package,
    label: 'COO',
  },
  'tpl-cpo': {
    accent: '#f97316',
    accentSoft: 'rgba(249, 115, 22, 0.16)',
    accentBorder: 'rgba(249, 115, 22, 0.55)',
    icon: Flag,
    label: 'CPO',
  },
  'tpl-custom': {
    accent: '#64748b',
    accentSoft: 'rgba(100, 116, 139, 0.16)',
    accentBorder: 'rgba(100, 116, 139, 0.5)',
    icon: UserCog,
    label: 'Custom',
  },
};

const BY_ROLE: Record<string, MissionAgentVisual> = {
  'role-investigation': {
    accent: '#a855f7',
    accentSoft: 'rgba(168, 85, 247, 0.16)',
    accentBorder: 'rgba(168, 85, 247, 0.55)',
    icon: Search,
    label: 'Investigação',
  },
  'role-planning': {
    accent: '#8b5cf6',
    accentSoft: 'rgba(139, 92, 246, 0.16)',
    accentBorder: 'rgba(139, 92, 246, 0.55)',
    icon: ListChecks,
    label: 'Planejamento',
  },
  'role-execution': {
    accent: '#3b82f6',
    accentSoft: 'rgba(59, 130, 246, 0.16)',
    accentBorder: 'rgba(59, 130, 246, 0.55)',
    icon: Code2,
    label: 'Execução',
  },
  'role-validation': {
    accent: '#22c55e',
    accentSoft: 'rgba(34, 197, 94, 0.16)',
    accentBorder: 'rgba(34, 197, 94, 0.55)',
    icon: ShieldCheck,
    label: 'Validação',
  },
  'role-qa': {
    accent: '#22c55e',
    accentSoft: 'rgba(34, 197, 94, 0.16)',
    accentBorder: 'rgba(34, 197, 94, 0.55)',
    icon: ShieldCheck,
    label: 'QA',
  },
  'role-review': {
    accent: '#f59e0b',
    accentSoft: 'rgba(245, 158, 11, 0.16)',
    accentBorder: 'rgba(245, 158, 11, 0.55)',
    icon: ListChecks,
    label: 'Review',
  },
  'role-research': {
    accent: '#94a3b8',
    accentSoft: 'rgba(148, 163, 184, 0.16)',
    accentBorder: 'rgba(148, 163, 184, 0.5)',
    icon: BookOpen,
    label: 'Pesquisa',
  },
  'role-documentation': {
    accent: '#f43f5e',
    accentSoft: 'rgba(244, 63, 94, 0.16)',
    accentBorder: 'rgba(244, 63, 94, 0.55)',
    icon: FileText,
    label: 'Docs',
  },
  'role-deploy': {
    accent: '#6366f1',
    accentSoft: 'rgba(99, 102, 241, 0.16)',
    accentBorder: 'rgba(99, 102, 241, 0.55)',
    icon: Box,
    label: 'Deploy',
  },
  'role-supervisor': {
    accent: '#14b8a6',
    accentSoft: 'rgba(20, 184, 166, 0.16)',
    accentBorder: 'rgba(20, 184, 166, 0.55)',
    icon: UserCog,
    label: 'Supervisor',
  },
  'role-ceo': {
    accent: '#eab308',
    accentSoft: 'rgba(234, 179, 8, 0.16)',
    accentBorder: 'rgba(234, 179, 8, 0.55)',
    icon: Briefcase,
    label: 'CEO',
  },
  'role-cto': {
    accent: '#38bdf8',
    accentSoft: 'rgba(56, 189, 248, 0.16)',
    accentBorder: 'rgba(56, 189, 248, 0.55)',
    icon: CircuitBoard,
    label: 'CTO',
  },
  'role-cfo': {
    accent: '#34d399',
    accentSoft: 'rgba(52, 211, 153, 0.16)',
    accentBorder: 'rgba(52, 211, 153, 0.55)',
    icon: DollarSign,
    label: 'CFO',
  },
  'role-cmo': {
    accent: '#fb7185',
    accentSoft: 'rgba(251, 113, 133, 0.16)',
    accentBorder: 'rgba(251, 113, 133, 0.55)',
    icon: Megaphone,
    label: 'CMO',
  },
  'role-coo': {
    accent: '#a78bfa',
    accentSoft: 'rgba(167, 139, 250, 0.16)',
    accentBorder: 'rgba(167, 139, 250, 0.55)',
    icon: Package,
    label: 'COO',
  },
  'role-cpo': {
    accent: '#f97316',
    accentSoft: 'rgba(249, 115, 22, 0.16)',
    accentBorder: 'rgba(249, 115, 22, 0.55)',
    icon: Flag,
    label: 'CPO',
  },
  'role-custom': {
    accent: '#64748b',
    accentSoft: 'rgba(100, 116, 139, 0.16)',
    accentBorder: 'rgba(100, 116, 139, 0.5)',
    icon: UserCog,
    label: 'Custom',
  },
};

const BY_KIND: Record<Exclude<MissionNodeKind, 'agent' | 'mission'>, MissionAgentVisual> = {
  browser: {
    accent: '#22d3ee',
    accentSoft: 'rgba(34, 211, 238, 0.16)',
    accentBorder: 'rgba(34, 211, 238, 0.55)',
    icon: Globe,
    label: 'Navegador',
  },
  emulator: {
    accent: '#a855f7',
    accentSoft: 'rgba(168, 85, 247, 0.16)',
    accentBorder: 'rgba(168, 85, 247, 0.55)',
    icon: Smartphone,
    label: 'Emulador',
  },
  terminal: {
    accent: '#94a3b8',
    accentSoft: 'rgba(148, 163, 184, 0.16)',
    accentBorder: 'rgba(148, 163, 184, 0.5)',
    icon: Terminal,
    label: 'Terminal',
  },
  api: {
    accent: '#f59e0b',
    accentSoft: 'rgba(245, 158, 11, 0.16)',
    accentBorder: 'rgba(245, 158, 11, 0.55)',
    icon: Braces,
    label: 'API',
  },
  automation: {
    accent: '#38bdf8',
    accentSoft: 'rgba(56, 189, 248, 0.16)',
    accentBorder: 'rgba(56, 189, 248, 0.55)',
    icon: Workflow,
    label: 'Nó',
  },
};

const BY_AUTOMATION_CATEGORY: Record<string, MissionAgentVisual> = {
  triggers: {
    accent: '#f59e0b',
    accentSoft: 'rgba(245, 158, 11, 0.16)',
    accentBorder: 'rgba(245, 158, 11, 0.55)',
    icon: Flag,
    label: 'Trigger',
  },
  flow: {
    accent: '#a78bfa',
    accentSoft: 'rgba(167, 139, 250, 0.16)',
    accentBorder: 'rgba(167, 139, 250, 0.55)',
    icon: Workflow,
    label: 'Flow',
  },
  http: {
    accent: '#38bdf8',
    accentSoft: 'rgba(56, 189, 248, 0.16)',
    accentBorder: 'rgba(56, 189, 248, 0.55)',
    icon: Globe,
    label: 'HTTP',
  },
  code: {
    accent: '#94a3b8',
    accentSoft: 'rgba(148, 163, 184, 0.16)',
    accentBorder: 'rgba(148, 163, 184, 0.5)',
    icon: Code2,
    label: 'Code',
  },
  files: {
    accent: '#22c55e',
    accentSoft: 'rgba(34, 197, 94, 0.16)',
    accentBorder: 'rgba(34, 197, 94, 0.55)',
    icon: FileText,
    label: 'Files',
  },
  git: {
    accent: '#f97316',
    accentSoft: 'rgba(249, 115, 22, 0.16)',
    accentBorder: 'rgba(249, 115, 22, 0.55)',
    icon: Box,
    label: 'Git',
  },
  human: {
    accent: '#f43f5e',
    accentSoft: 'rgba(244, 63, 94, 0.16)',
    accentBorder: 'rgba(244, 63, 94, 0.55)',
    icon: UserCog,
    label: 'Human',
  },
  engineering: {
    accent: '#22c55e',
    accentSoft: 'rgba(34, 197, 94, 0.16)',
    accentBorder: 'rgba(34, 197, 94, 0.55)',
    icon: ShieldCheck,
    label: 'Eng',
  },
  browser: {
    accent: '#22d3ee',
    accentSoft: 'rgba(34, 211, 238, 0.16)',
    accentBorder: 'rgba(34, 211, 238, 0.55)',
    icon: Globe,
    label: 'Browser',
  },
  emulator: {
    accent: '#a855f7',
    accentSoft: 'rgba(168, 85, 247, 0.16)',
    accentBorder: 'rgba(168, 85, 247, 0.55)',
    icon: Smartphone,
    label: 'Mobile',
  },
};

export const MISSION_ROOT_VISUAL: MissionAgentVisual = {
  accent: '#22d3ee',
  accentSoft: 'rgba(34, 211, 238, 0.18)',
  accentBorder: 'rgba(139, 92, 246, 0.7)',
  icon: Flag,
  label: 'Missão',
};

const FALLBACK: MissionAgentVisual = {
  accent: '#60a5fa',
  accentSoft: 'rgba(96, 165, 250, 0.16)',
  accentBorder: 'rgba(96, 165, 250, 0.5)',
  icon: Code2,
  label: 'Agent',
};

export function getMissionAgentVisual(input: {
  kind?: MissionNodeKind | null;
  agentTemplateId?: string | null;
  roleId?: string | null;
  automationCategory?: string | null;
}): MissionAgentVisual {
  if (input.kind === 'mission') {
    return MISSION_ROOT_VISUAL;
  }

  if (input.kind === 'automation') {
    if (input.automationCategory && BY_AUTOMATION_CATEGORY[input.automationCategory]) {
      return BY_AUTOMATION_CATEGORY[input.automationCategory]!;
    }
    return BY_KIND.automation;
  }

  if (input.kind && input.kind !== 'agent' && BY_KIND[input.kind]) {
    return BY_KIND[input.kind];
  }

  if (input.roleId === 'role-investigation' || input.roleId === 'role-supervisor') {
    return BY_ROLE[input.roleId] ?? FALLBACK;
  }

  if (input.agentTemplateId && BY_TEMPLATE[input.agentTemplateId]) {
    return BY_TEMPLATE[input.agentTemplateId]!;
  }

  if (input.roleId && BY_ROLE[input.roleId]) {
    return BY_ROLE[input.roleId]!;
  }

  return FALLBACK;
}

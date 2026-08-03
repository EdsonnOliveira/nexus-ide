import { memo } from 'react';
import {
  BookOpen,
  Brain,
  FilePenLine,
  ListChecks,
  ListTodo,
  Map,
  MessageCircleQuestion,
  Search,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { AgentActivity, AgentActivityKind } from '@/types';

export type AgentActivityIconKind =
  | 'ran'
  | 'edit'
  | 'read'
  | 'thinking'
  | 'thought'
  | 'search'
  | 'tools'
  | 'lint'
  | 'task'
  | 'plan'
  | 'question';

const ICON_BY_KIND: Record<AgentActivityIconKind, LucideIcon> = {
  ran: SquareTerminal,
  edit: FilePenLine,
  read: BookOpen,
  thinking: Brain,
  thought: Brain,
  search: Search,
  tools: Wrench,
  lint: ListChecks,
  task: ListTodo,
  plan: Map,
  question: MessageCircleQuestion,
};

export function resolveAgentActivityIconFromLabel(label: string): AgentActivityIconKind {
  const text = label.trim();
  if (!text) {
    return 'tools';
  }

  if (/^Thinking\b/i.test(text)) {
    return 'thinking';
  }

  if (/^(?:Planning|Waiting|Aguardando|Agent executando)\b/i.test(text)) {
    return 'thinking';
  }

  if (/^Thought\b/i.test(text)) {
    return 'thought';
  }

  if (/^(?:Editing|Edited|Edit)\b/i.test(text)) {
    return 'edit';
  }

  if (/^(?:Read|Reading|Explored|Exploring|explored)\b/i.test(text)) {
    return 'read';
  }

  if (/^(?:Ran|Run|Running|Executando)\b/i.test(text)) {
    return 'ran';
  }

  if (/^(?:Glob|Grep|Grepping|Searching|Searched|Search)\b/i.test(text)) {
    return 'search';
  }

  if (/^(?:Loaded tools|Loading tools|Tools)\b/i.test(text)) {
    return 'tools';
  }

  if (/\blint/i.test(text)) {
    return 'lint';
  }

  if (/^Task\b/i.test(text)) {
    return 'task';
  }

  const firstClause = text.split(',')[0]?.trim() ?? text;
  if (firstClause !== text) {
    return resolveAgentActivityIconFromLabel(firstClause);
  }

  return 'tools';
}

export function resolveAgentActivityIconKind(
  activity: Pick<AgentActivity, 'kind' | 'label' | 'streaming'> & {
    verbOverride?: string;
  },
): AgentActivityIconKind {
  const kind = activity.kind as AgentActivityKind;

  if (kind === 'thought') {
    return activity.streaming ? 'thinking' : 'thought';
  }

  if (kind === 'file_edit') {
    return 'edit';
  }

  if (kind === 'file_read') {
    return 'read';
  }

  if (kind === 'task') {
    return 'task';
  }

  if (kind === 'plan') {
    return 'plan';
  }

  if (kind === 'question') {
    return 'question';
  }

  if (kind === 'tool_run') {
    const label = (activity.verbOverride ?? activity.label).trim();
    if (/^(?:Glob|Grep|Grepping|Searching|Searched|Search)\b/i.test(label)) {
      return 'search';
    }
    if (/\blint/i.test(label)) {
      return 'lint';
    }
    if (/^(?:Read|Reading)\b/i.test(label)) {
      return 'read';
    }
    if (/^(?:Edit|Edited|Editing)\b/i.test(label)) {
      return 'edit';
    }
    return 'ran';
  }

  return resolveAgentActivityIconFromLabel(activity.verbOverride ?? activity.label);
}

interface AgentActivityIconProps {
  kind: AgentActivityIconKind;
  className?: string;
}

function AgentActivityIconComponent({ kind, className }: AgentActivityIconProps) {
  const Icon = ICON_BY_KIND[kind];

  return (
    <Icon
      size={14}
      strokeWidth={1.75}
      className={`agent-view__activity-icon${className ? ` ${className}` : ''}`}
      aria-hidden='true'
    />
  );
}

export const AgentActivityIcon = memo(AgentActivityIconComponent);

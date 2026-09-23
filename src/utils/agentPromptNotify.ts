import type { AgentActivity, AgentUserMessage } from '@/types';
import { findPendingAgentPlanActivity } from '@/utils/agentPlanPrompt';
import {
  findPendingAgentQuestionActivity,
  isAgentQuestionOtherOptionId,
} from '@/utils/agentQuestionPrompt';
import { normalizeSkillToken, resolveAgentSkillDisplayState } from '@/utils/agentSkillDisplay';

export type AgentPromptNotifyKind = 'plan' | 'question';

const GIT_FINISH_SKILL_RE = /^(git|git-push)(?:[-/].+)?$/;
const GIT_FINISH_PHRASE_RE =
  /^(?:por favor[,:]?\s+|please[,:]?\s+)?(?:\/git(?:-push)?(?:\s+\S+)*|subir(?:\s+tudo)?\s+para\s+o\s+git|sobe(?:r)?\s+(?:tudo\s+)?(?:pro|para o)\s+git|git\s+push(?:\s+\S+)*|fazer?\s+(?:o\s+)?push|fa[cç]a\s+(?:o\s+)?push|commit(?:ar)?\s+e\s+(?:push|subir)(?:\s+para\s+o\s+git)?)(?:\s+por favor)?\.?$/i;

export function isAgentGitFinishPrompt(
  user?: Pick<AgentUserMessage, 'content' | 'skillLabel' | 'agentPrompt'> | null,
): boolean {
  if (!user) {
    return false;
  }

  const skillState = resolveAgentSkillDisplayState(user);
  if (
    skillState.hasSkillPrompt &&
    GIT_FINISH_SKILL_RE.test(normalizeSkillToken(skillState.skillChipLabel))
  ) {
    return true;
  }

  const content = user.content.trim();
  if (!content) {
    return false;
  }

  return GIT_FINISH_PHRASE_RE.test(content);
}

export interface AgentPromptNotifyOption {
  id: string;
  label: string;
  primary?: boolean;
}

export interface AgentPromptNotifyPayload {
  kind: AgentPromptNotifyKind;
  activityId: string;
  questionId?: string;
  body: string;
  options: AgentPromptNotifyOption[];
}

function truncateNotifyText(value: string, max = 180): string {
  const trimmed = value.trim().replace(/[ \t]+/g, ' ');
  if (trimmed.length <= max) {
    return trimmed;
  }

  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function truncateOptionLabel(value: string, max = 32): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= max) {
    return trimmed;
  }

  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function buildQuestionNotify(question: AgentActivity): AgentPromptNotifyPayload {
  const items = question.questions ?? [];
  const first = items[0];
  const body = truncateNotifyText(
    items
      .map((item, index) => {
        const prompt = item.prompt.trim();
        if (!prompt) {
          return items.length > 1 ? `${index + 1}. Pergunta` : '';
        }

        return items.length > 1 ? `${index + 1}. ${prompt}` : prompt;
      })
      .filter(Boolean)
      .join('\n') ||
      question.questionTitle?.trim() ||
      'O agent fez uma pergunta',
  );

  const optionSource = first?.options ?? [];
  const canAnswerInline =
    items.length === 1 && !first?.allowMultiple && optionSource.length > 0;
  const options = canAnswerInline
    ? optionSource
        .filter((option) => !isAgentQuestionOtherOptionId(option.id))
        .slice(0, 6)
        .map((option, index, list) => ({
          id: `answer:${option.id}`,
          label: truncateOptionLabel(option.label.trim() || option.id),
          primary: index === list.length - 1,
        }))
    : [{ id: 'open', label: 'Responder', primary: true }];

  if (options.length === 0) {
    options.push({ id: 'open', label: 'Responder', primary: true });
  }

  return {
    kind: 'question',
    activityId: question.id,
    questionId: first?.id,
    body,
    options,
  };
}

export function buildAgentPromptNotify(
  activities: AgentActivity[],
): AgentPromptNotifyPayload | null {
  const question = findPendingAgentQuestionActivity(activities);
  if (question?.kind === 'question' && question.questions && question.questions.length > 0) {
    return buildQuestionNotify(question);
  }

  const plan = findPendingAgentPlanActivity(activities);
  if (!plan || plan.kind !== 'plan') {
    return null;
  }

  const overview = plan.planOverview?.trim() || plan.planName?.trim() || '';
  return {
    kind: 'plan',
    activityId: plan.id,
    body: truncateNotifyText(overview || 'O agent pediu revisão do plano'),
    options: [
      { id: 'plan-reject', label: 'Descartar' },
      { id: 'plan-accept', label: 'Build', primary: true },
    ],
  };
}

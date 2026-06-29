import type { AgentQuestionAnswers, AgentQuestionItem, AgentQuestionOption } from '@/types';

export const AGENT_QUESTION_OTHER_OPTION_ID = '__other__';

export function isAgentQuestionOtherOptionId(optionId: string): boolean {
  const normalized = optionId.trim().toLowerCase();
  return normalized === AGENT_QUESTION_OTHER_OPTION_ID || normalized === 'other';
}

export function ensureOtherOption(options: AgentQuestionOption[]): AgentQuestionOption[] {
  const hasOther = options.some(
    (option) =>
      isAgentQuestionOtherOptionId(option.id) ||
      option.label.trim().toLowerCase() === 'other' ||
      option.label.trim().toLowerCase() === 'outro',
  );

  if (hasOther) {
    return options;
  }

  return [...options, { id: AGENT_QUESTION_OTHER_OPTION_ID, label: 'Other' }];
}

export function resolveQuestionOptionLabel(
  question: AgentQuestionItem,
  optionId: string,
  answers: AgentQuestionAnswers,
): string {
  if (isAgentQuestionOtherOptionId(optionId)) {
    const otherText = answers[`${question.id}__other`] ?? answers[question.id];
    return typeof otherText === 'string' ? otherText.trim() : '';
  }

  const option = question.options?.find((entry) => entry.id === optionId);
  return option?.label.trim() ?? optionId;
}

export function buildAgentQuestionAnswerPrompt(
  questions: AgentQuestionItem[],
  answers: AgentQuestionAnswers,
): string {
  const lines = questions
    .map((question) => {
      const rawAnswer = answers[question.id];

      if (Array.isArray(rawAnswer)) {
        const labels = rawAnswer
          .map((optionId) => resolveQuestionOptionLabel(question, optionId, answers))
          .filter(Boolean);

        if (labels.length === 0) {
          return null;
        }

        return `${question.id}: ${labels.join(', ')}`;
      }

      if (typeof rawAnswer === 'string' && rawAnswer.trim()) {
        if (question.options && question.options.length > 0) {
          const label = resolveQuestionOptionLabel(question, rawAnswer, answers);
          return label ? `${question.id}: ${label}` : null;
        }

        return `${question.id}: ${rawAnswer.trim()}`;
      }

      return null;
    })
    .filter((line): line is string => Boolean(line));

  return lines.join('\n');
}

export function isAgentQuestionAnswerComplete(
  questions: AgentQuestionItem[],
  answers: AgentQuestionAnswers,
): boolean {
  return questions.every((question) => {
    const rawAnswer = answers[question.id];

    if (!question.options || question.options.length === 0) {
      return typeof rawAnswer === 'string' && rawAnswer.trim().length > 0;
    }

    if (question.allowMultiple) {
      if (!Array.isArray(rawAnswer) || rawAnswer.length === 0) {
        return false;
      }

      const hasOther = rawAnswer.some((optionId) => isAgentQuestionOtherOptionId(optionId));

      if (hasOther) {
        const otherText = answers[`${question.id}__other`];
        return typeof otherText === 'string' && otherText.trim().length > 0;
      }

      return true;
    }

    if (typeof rawAnswer !== 'string' || !rawAnswer.trim()) {
      return false;
    }

    if (isAgentQuestionOtherOptionId(rawAnswer)) {
      const otherText = answers[`${question.id}__other`];
      return typeof otherText === 'string' && otherText.trim().length > 0;
    }

    return true;
  });
}

export function hasPendingAgentQuestion(activities: { kind: string; questionStatus?: string }[]): boolean {
  return activities.some(
    (entry) => entry.kind === 'question' && entry.questionStatus === 'pending',
  );
}

export function findPendingAgentQuestionActivity<T extends { kind: string; questionStatus?: string }>(
  activities: T[],
): T | undefined {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const entry = activities[index];

    if (entry?.kind === 'question' && entry.questionStatus === 'pending') {
      return entry;
    }
  }

  return undefined;
}

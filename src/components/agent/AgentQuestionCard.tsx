import { memo, useCallback, useMemo, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { AppCheckbox } from '@/components/overlay/AppCheckbox';
import type { AgentActivity, AgentQuestionAnswers, AgentQuestionItem } from '@/types';
import {
  ensureOtherOption,
  isAgentQuestionAnswerComplete,
  isAgentQuestionOtherOptionId,
  resolveQuestionOptionLabel,
} from '@/utils/agentQuestionPrompt';

interface AgentQuestionCardProps {
  activity: AgentActivity;
  interactive: boolean;
  onSubmit: (activityId: string, answers: AgentQuestionAnswers) => boolean | Promise<boolean>;
}

function formatAnswerSummary(question: AgentQuestionItem, answers: AgentQuestionAnswers): string {
  const rawAnswer = answers[question.id];

  if (Array.isArray(rawAnswer)) {
    return rawAnswer
      .map((optionId) => resolveQuestionOptionLabel(question, optionId, answers))
      .filter(Boolean)
      .join(', ');
  }

  if (typeof rawAnswer === 'string' && rawAnswer.trim()) {
    if (question.options && question.options.length > 0) {
      return resolveQuestionOptionLabel(question, rawAnswer, answers);
    }

    return rawAnswer.trim();
  }

  return '';
}

function AgentQuestionCardComponent({ activity, interactive, onSubmit }: AgentQuestionCardProps) {
  const questions = activity.questions ?? [];
  const isAnswered = activity.questionStatus === 'answered';
  const isSkipped = activity.questionStatus === 'skipped';
  const [answers, setAnswers] = useState<AgentQuestionAnswers>(activity.questionAnswers ?? {});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = useMemo(
    () => interactive && isAgentQuestionAnswerComplete(questions, answers),
    [answers, interactive, questions],
  );

  const handleSingleSelect = useCallback((questionId: string, optionId: string) => {
    setAnswers((current) => ({
      ...current,
      [questionId]: optionId,
    }));
  }, []);

  const handleMultiToggle = useCallback((questionId: string, optionId: string, checked: boolean) => {
    setAnswers((current) => {
      const previous = current[questionId];
      const selected = Array.isArray(previous) ? previous : [];

      if (checked) {
        return {
          ...current,
          [questionId]: [...selected.filter((entry) => entry !== optionId), optionId],
        };
      }

      return {
        ...current,
        [questionId]: selected.filter((entry) => entry !== optionId),
      };
    });
  }, []);

  const handleFreeTextChange = useCallback((questionId: string, value: string) => {
    setAnswers((current) => ({
      ...current,
      [questionId]: value,
    }));
  }, []);

  const handleOtherTextChange = useCallback((questionId: string, value: string) => {
    setAnswers((current) => ({
      ...current,
      [`${questionId}__other`]: value,
    }));
  }, []);

  const handleSubmit = useCallback(() => {
    if (!canSubmit || isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    void (async () => {
      try {
        await onSubmit(activity.id, answers);
      } finally {
        setIsSubmitting(false);
      }
    })();
  }, [activity.id, answers, canSubmit, isSubmitting, onSubmit]);

  if (questions.length === 0) {
    return null;
  }

  return (
    <div
      className={`agent-view__question-card app-button--enter${isAnswered ? ' agent-view__question-card--answered' : ''}${isSkipped ? ' agent-view__question-card--skipped' : ''}`}
    >
      {activity.questionTitle ? (
        <div className='agent-view__question-card-title'>{activity.questionTitle}</div>
      ) : null}

      <div className='agent-view__question-list'>
        {questions.map((question) => {
          const options =
            question.options && question.options.length > 0
              ? ensureOtherOption(question.options)
              : [];
          const rawAnswer = isAnswered ? activity.questionAnswers?.[question.id] : answers[question.id];
          const otherTextKey = `${question.id}__other`;
          const otherText = String(
            (isAnswered ? activity.questionAnswers?.[otherTextKey] : answers[otherTextKey]) ?? '',
          );

          if (isAnswered || isSkipped) {
            const summary = formatAnswerSummary(question, activity.questionAnswers ?? {});

            return (
              <div key={question.id} className='agent-view__question-item'>
                <div className='agent-view__question-prompt'>{question.prompt}</div>
                {summary ? <div className='agent-view__question-answer-summary'>{summary}</div> : null}
              </div>
            );
          }

          if (options.length === 0) {
            return (
              <div key={question.id} className='agent-view__question-item'>
                <div className='agent-view__question-prompt'>{question.prompt}</div>
                <textarea
                  className='agent-view__question-textarea'
                  value={typeof rawAnswer === 'string' ? rawAnswer : ''}
                  placeholder='Digite sua resposta'
                  rows={3}
                  onChange={(event) => handleFreeTextChange(question.id, event.target.value)}
                />
              </div>
            );
          }

          return (
            <div key={question.id} className='agent-view__question-item'>
              <div className='agent-view__question-prompt'>{question.prompt}</div>
              <div className='agent-view__question-options'>
                {options.map((option) => {
                  const isOther = isAgentQuestionOtherOptionId(option.id);
                  const isSelected = question.allowMultiple
                    ? Array.isArray(rawAnswer) && rawAnswer.includes(option.id)
                    : rawAnswer === option.id;

                  if (question.allowMultiple) {
                    return (
                      <div key={option.id} className='agent-view__question-option-row'>
                        <AppCheckbox
                          checked={Boolean(isSelected)}
                          aria-label={option.label}
                          onChange={(checked) => handleMultiToggle(question.id, option.id, checked)}
                        />
                        <button
                          type='button'
                          className={`agent-view__question-option app-button app-button--enter${isSelected ? ' agent-view__question-option--active' : ''}`}
                          onClick={() =>
                            handleMultiToggle(question.id, option.id, !Boolean(isSelected))
                          }
                        >
                          {option.label}
                        </button>
                        {isOther && isSelected ? (
                          <input
                            type='text'
                            className='agent-view__question-other-input'
                            value={otherText}
                            placeholder='Descreva…'
                            onChange={(event) => handleOtherTextChange(question.id, event.target.value)}
                          />
                        ) : null}
                      </div>
                    );
                  }

                  return (
                    <div key={option.id} className='agent-view__question-option-row'>
                      <button
                        type='button'
                        className={`agent-view__question-option app-button app-button--enter${isSelected ? ' agent-view__question-option--active' : ''}`}
                        onClick={() => handleSingleSelect(question.id, option.id)}
                      >
                        {option.label}
                      </button>
                      {isOther && isSelected ? (
                        <input
                          type='text'
                          className='agent-view__question-other-input'
                          value={otherText}
                          placeholder='Descreva…'
                          onChange={(event) => handleOtherTextChange(question.id, event.target.value)}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {interactive && !isAnswered && !isSkipped ? (
        <div className='agent-view__question-actions'>
          <button
            type='button'
            className='agent-view__question-submit app-button app-button--enter'
            disabled={!canSubmit || isSubmitting}
            onClick={handleSubmit}
          >
            <ArrowUp size={14} strokeWidth={2.25} />
            <span className='app-button__label'>
              {isSubmitting ? 'Enviando…' : 'Enviar respostas'}
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export const AgentQuestionCard = memo(AgentQuestionCardComponent);

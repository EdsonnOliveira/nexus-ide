import { memo, type CSSProperties } from 'react';
import { CircleHelp } from 'lucide-react';
import { EmptyState } from '@/components/overlay/EmptyState';
import { BrainSectionCard } from '@/components/brain/BrainSectionCard';
import { BRAIN_ACCENTS } from '@/components/brain/brainAccents';
import type { BrainQuestion } from '@/components/brain/brainTypes';

interface BrainQuestionsTabProps {
  questions: BrainQuestion[];
  onAdd?: () => void;
}

const FAQ_ACCENTS = [
  BRAIN_ACCENTS.green,
  BRAIN_ACCENTS.blue,
  BRAIN_ACCENTS.amber,
  BRAIN_ACCENTS.purple,
  BRAIN_ACCENTS.cyan,
  BRAIN_ACCENTS.pink,
];

function BrainQuestionsTabComponent({ questions, onAdd }: BrainQuestionsTabProps) {
  if (questions.length === 0) {
    return (
      <EmptyState
        icon={CircleHelp}
        title='Nenhuma pergunta'
        message='Perguntas frequentes geradas automaticamente aparecerão aqui.'
        className='brain-empty'
      >
        {onAdd ? (
          <button
            type='button'
            className='brain-empty__cta app-button app-button--enter'
            onClick={onAdd}
          >
            Adicionar pergunta
          </button>
        ) : null}
      </EmptyState>
    );
  }

  return (
    <div className='brain-faq'>
      {questions.map((item, index) => {
        const accent = FAQ_ACCENTS[index % FAQ_ACCENTS.length];

        return (
          <BrainSectionCard
            key={item.id}
            icon={CircleHelp}
            title={item.question}
            accent={accent}
            enterDelayMs={40 + index * 40}
          >
            <p className='brain-detail__text'>{item.answer}</p>
            <div className='brain-chip-row'>
              {item.related.map((related) => (
                <span
                  key={related}
                  className='brain-chip brain-chip--accented'
                  style={{ ['--chip-accent' as string]: accent } as CSSProperties}
                >
                  {related}
                </span>
              ))}
            </div>
          </BrainSectionCard>
        );
      })}
    </div>
  );
}

export const BrainQuestionsTab = memo(BrainQuestionsTabComponent);

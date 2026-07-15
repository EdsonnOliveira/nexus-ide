import { memo, type CSSProperties } from 'react';
import { Bot, MessageSquareText, Sparkles } from 'lucide-react';
import { EmptyState } from '@/components/overlay/EmptyState';
import { BrainSectionCard } from '@/components/brain/BrainSectionCard';
import { BRAIN_ACCENTS } from '@/components/brain/brainAccents';
import type { BrainPrompt } from '@/components/brain/brainTypes';

interface BrainPromptsTabProps {
  prompts: BrainPrompt[];
  onAdd?: () => void;
}

function BrainPromptsTabComponent({ prompts, onAdd }: BrainPromptsTabProps) {
  if (prompts.length === 0) {
    return (
      <EmptyState
        icon={MessageSquareText}
        title='Nenhum prompt'
        message='Prompts importantes e reutilizáveis aparecerão aqui.'
        className='brain-empty'
      >
        {onAdd ? (
          <button
            type='button'
            className='brain-empty__cta app-button app-button--enter'
            onClick={onAdd}
          >
            Adicionar prompt
          </button>
        ) : null}
      </EmptyState>
    );
  }

  return (
    <div className='brain-cards-grid'>
      {prompts.map((prompt, index) => (
        <BrainSectionCard
          key={prompt.id}
          icon={MessageSquareText}
          title={prompt.title}
          accent={BRAIN_ACCENTS.pink}
          enterDelayMs={40 + index * 40}
          headerMeta={
            <span className='brain-section__meta'>
              <Bot size={11} strokeWidth={2} aria-hidden='true' />
              {prompt.agentName} · {prompt.updatedAtLabel}
            </span>
          }
        >
          <section className='brain-detail__section'>
            <span className='brain-detail__label'>
              <Sparkles size={12} strokeWidth={2} aria-hidden='true' />
              Resultado
            </span>
            <p className='brain-detail__text'>{prompt.result}</p>
          </section>
          <section className='brain-detail__section'>
            <span className='brain-detail__label'>Criou</span>
            <div className='brain-chip-row'>
              {prompt.created.map((item, chipIndex) => (
                <span
                  key={item}
                  className='brain-chip brain-chip--accented'
                  style={
                    {
                      ['--chip-accent' as string]:
                        [BRAIN_ACCENTS.pink, BRAIN_ACCENTS.purple, BRAIN_ACCENTS.cyan][chipIndex % 3],
                    } as CSSProperties
                  }
                >
                  {item}
                </span>
              ))}
            </div>
          </section>
          <section className='brain-detail__section'>
            <span className='brain-detail__label'>Relacionados</span>
            <div className='brain-chip-row'>
              {prompt.related.map((item) => (
                <span
                  key={item}
                  className='brain-chip brain-chip--accented'
                  style={{ ['--chip-accent' as string]: BRAIN_ACCENTS.blue } as CSSProperties}
                >
                  {item}
                </span>
              ))}
            </div>
          </section>
        </BrainSectionCard>
      ))}
    </div>
  );
}

export const BrainPromptsTab = memo(BrainPromptsTabComponent);

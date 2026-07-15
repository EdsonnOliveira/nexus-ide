import { memo, type CSSProperties } from 'react';
import { Sparkles } from 'lucide-react';
import { EmptyState } from '@/components/overlay/EmptyState';
import { BrainSectionCard } from '@/components/brain/BrainSectionCard';
import { BRAIN_ACCENTS } from '@/components/brain/brainAccents';
import type { BrainMemoryFact } from '@/components/brain/brainTypes';

interface BrainMemoryTabProps {
  memory: BrainMemoryFact[];
  onAdd?: () => void;
}

function BrainMemoryTabComponent({ memory, onAdd }: BrainMemoryTabProps) {
  if (memory.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title='Memória vazia'
        message='Fatos consolidados do projeto aparecerão aqui quando a IA unificar fontes.'
        className='brain-empty'
      >
        {onAdd ? (
          <button
            type='button'
            className='brain-empty__cta app-button app-button--enter'
            onClick={onAdd}
          >
            Adicionar memória
          </button>
        ) : null}
      </EmptyState>
    );
  }

  return (
    <div className='brain-cards-grid'>
      {memory.map((fact, index) => (
        <BrainSectionCard
          key={fact.id}
          icon={Sparkles}
          title={fact.title}
          accent={index % 2 === 0 ? BRAIN_ACCENTS.purple : BRAIN_ACCENTS.cyan}
          enterDelayMs={40 + index * 40}
          headerMeta={
            <span className='brain-section__meta'>Confirmado {fact.lastConfirmedLabel}</span>
          }
        >
          <div className='brain-memory__fields'>
            {fact.fields.map((field) => (
              <div key={field.label} className='brain-memory__field'>
                <span className='brain-detail__label'>{field.label}</span>
                <strong className='brain-metric__value'>{field.value}</strong>
              </div>
            ))}
          </div>
          <section className='brain-detail__section'>
            <span className='brain-detail__label'>Origem</span>
            <div className='brain-chip-row'>
              {fact.origins.map((origin, originIndex) => (
                <span
                  key={origin}
                  className='brain-chip brain-chip--accented'
                  style={
                    {
                      ['--chip-accent' as string]:
                        [
                          BRAIN_ACCENTS.green,
                          BRAIN_ACCENTS.blue,
                          BRAIN_ACCENTS.amber,
                          BRAIN_ACCENTS.pink,
                        ][originIndex % 4],
                    } as CSSProperties
                  }
                >
                  {origin}
                </span>
              ))}
            </div>
          </section>
        </BrainSectionCard>
      ))}
    </div>
  );
}

export const BrainMemoryTab = memo(BrainMemoryTabComponent);

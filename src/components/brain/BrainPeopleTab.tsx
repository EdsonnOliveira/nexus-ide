import { memo, useCallback, useMemo, useState, type CSSProperties } from 'react';
import { Bot, FileText, GitPullRequest, MessageSquare, Mic, Scale, Users } from 'lucide-react';
import { EmptyState } from '@/components/overlay/EmptyState';
import { BRAIN_ACCENTS } from '@/components/brain/brainAccents';
import type { BrainPerson } from '@/components/brain/brainTypes';

interface BrainPeopleTabProps {
  people: BrainPerson[];
  onAdd?: () => void;
}

const PERSON_ACCENTS = [BRAIN_ACCENTS.pink, BRAIN_ACCENTS.blue];

function BrainPeopleTabComponent({ people, onAdd }: BrainPeopleTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(people[0]?.id ?? null);

  const selected = useMemo(
    () => people.find((item) => item.id === selectedId) ?? people[0] ?? null,
    [people, selectedId],
  );

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  if (people.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title='Nenhuma pessoa'
        message='Participantes do projeto e suas contribuições aparecerão aqui.'
        className='brain-empty'
      >
        {onAdd ? (
          <button
            type='button'
            className='brain-empty__cta app-button app-button--enter'
            onClick={onAdd}
          >
            Adicionar pessoa
          </button>
        ) : null}
      </EmptyState>
    );
  }

  return (
    <div className='brain-split app-button--enter'>
      <div className='brain-split__list'>
        {people.map((person, index) => {
          const isActive = selected?.id === person.id;
          const accent = PERSON_ACCENTS[index % PERSON_ACCENTS.length];

          return (
            <button
              key={person.id}
              type='button'
              className={`brain-list-item app-button${isActive ? ' brain-list-item--active app-button--enter' : ''}`}
              style={{ ['--item-accent' as string]: accent } as CSSProperties}
              onClick={() => handleSelect(person.id)}
            >
              <span className='brain-list-item__row'>
                <span className='brain-list-item__avatar' aria-hidden='true'>
                  {person.name.slice(0, 1)}
                </span>
                <span className='brain-list-item__main'>
                  <span className='brain-list-item__title'>{person.name}</span>
                  <span className='brain-list-item__summary'>{person.specialties.join(', ')}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {selected ? (
        <aside
          className='brain-split__detail'
          style={
            {
              ['--card-accent' as string]:
                PERSON_ACCENTS[people.findIndex((item) => item.id === selected.id) % PERSON_ACCENTS.length],
            } as CSSProperties
          }
        >
          <div className='brain-detail__hero'>
            <span className='brain-detail__hero-avatar' aria-hidden='true'>
              {selected.name.slice(0, 1)}
            </span>
            <div>
              <h3 className='brain-detail__title'>{selected.name}</h3>
              <div className='brain-chip-row'>
                {selected.specialties.map((item, index) => (
                  <span
                    key={item}
                    className='brain-chip brain-chip--accented'
                    style={
                      {
                        ['--chip-accent' as string]:
                          [BRAIN_ACCENTS.pink, BRAIN_ACCENTS.blue, BRAIN_ACCENTS.purple][index % 3],
                      } as CSSProperties
                    }
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
          {(
            [
              ['Reuniões', selected.meetings, Mic],
              ['Decisões', selected.decisions, Scale],
              ['PRs', selected.prs, GitPullRequest],
              ['Documentos', selected.documents, FileText],
              ['Comentários', selected.comments, MessageSquare],
              ['Agentes', selected.agents, Bot],
            ] as const
          ).map(([label, items, Icon]) => (
            <section key={label} className='brain-detail__section'>
              <span className='brain-detail__label'>
                <Icon size={12} strokeWidth={2} aria-hidden='true' />
                {label}
              </span>
              {items.length > 0 ? (
                <ul className='brain-list'>
                  {items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className='brain-detail__text'>Nenhum item</p>
              )}
            </section>
          ))}
        </aside>
      ) : null}
    </div>
  );
}

export const BrainPeopleTab = memo(BrainPeopleTabComponent);

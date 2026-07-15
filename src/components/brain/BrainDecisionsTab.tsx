import { memo, useCallback, useMemo, useState, type CSSProperties } from 'react';
import { CalendarDays, CheckCircle2, Scale, Users } from 'lucide-react';
import { EmptyState } from '@/components/overlay/EmptyState';
import { BRAIN_ACCENTS, BRAIN_KIND_ACCENTS } from '@/components/brain/brainAccents';
import type { BrainDecision } from '@/components/brain/brainTypes';

interface BrainDecisionsTabProps {
  decisions: BrainDecision[];
  onAdd?: () => void;
}

function BrainDecisionsTabComponent({ decisions, onAdd }: BrainDecisionsTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(decisions[0]?.id ?? null);

  const selected = useMemo(
    () => decisions.find((item) => item.id === selectedId) ?? decisions[0] ?? null,
    [decisions, selectedId],
  );

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  if (decisions.length === 0) {
    return (
      <EmptyState
        icon={Scale}
        title='Nenhuma decisão'
        message='Decisões importantes do projeto aparecerão aqui como ADR automático.'
        className='brain-empty'
      >
        {onAdd ? (
          <button
            type='button'
            className='brain-empty__cta app-button app-button--enter'
            onClick={onAdd}
          >
            Adicionar decisão
          </button>
        ) : null}
      </EmptyState>
    );
  }

  return (
    <div className='brain-split app-button--enter'>
      <div className='brain-split__list'>
        {decisions.map((decision) => {
          const isActive = selected?.id === decision.id;
          const statusAccent = BRAIN_KIND_ACCENTS[decision.status] ?? BRAIN_ACCENTS.amber;

          return (
            <button
              key={decision.id}
              type='button'
              className={`brain-list-item app-button${isActive ? ' brain-list-item--active app-button--enter' : ''}`}
              style={{ ['--item-accent' as string]: statusAccent } as CSSProperties}
              onClick={() => handleSelect(decision.id)}
            >
              <span className='brain-list-item__row'>
                <span className='brain-list-item__icon' aria-hidden='true'>
                  <Scale size={15} strokeWidth={2} />
                </span>
                <span className='brain-list-item__main'>
                  <span className='brain-list-item__title'>{decision.title}</span>
                  <span className='brain-list-item__meta'>
                    <span
                      className='brain-status-pill'
                      style={{ ['--chip-accent' as string]: statusAccent } as CSSProperties}
                    >
                      {decision.status}
                    </span>
                    <span>{decision.decidedAtLabel}</span>
                  </span>
                </span>
              </span>
              <span className='brain-list-item__summary'>{decision.reason}</span>
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
                BRAIN_KIND_ACCENTS[selected.status] ?? BRAIN_ACCENTS.amber,
            } as CSSProperties
          }
        >
          <div className='brain-detail__hero'>
            <span className='brain-detail__hero-icon' aria-hidden='true'>
              <Scale size={18} strokeWidth={2} />
            </span>
            <div>
              <h3 className='brain-detail__title'>{selected.title}</h3>
              <div className='brain-detail__meta'>
                <span
                  className='brain-status-pill'
                  style={
                    {
                      ['--chip-accent' as string]:
                        BRAIN_KIND_ACCENTS[selected.status] ?? BRAIN_ACCENTS.amber,
                    } as CSSProperties
                  }
                >
                  {selected.status}
                </span>
                <span className='brain-meta-inline'>
                  <CalendarDays size={11} strokeWidth={2} aria-hidden='true' />
                  {selected.decidedAtLabel}
                </span>
              </div>
            </div>
          </div>
          <section className='brain-detail__section'>
            <span className='brain-detail__label'>Motivo</span>
            <p className='brain-detail__text'>{selected.reason}</p>
          </section>
          <section className='brain-detail__section'>
            <span className='brain-detail__label'>Contexto</span>
            <p className='brain-detail__text'>{selected.context}</p>
          </section>
          <section className='brain-detail__section'>
            <span className='brain-detail__label'>Alternativas</span>
            <div className='brain-chip-row'>
              {selected.alternatives.map((item) => (
                <span
                  key={item}
                  className={`brain-chip brain-chip--accented${item === selected.chosen ? ' brain-chip--chosen' : ''}`}
                  style={
                    {
                      ['--chip-accent' as string]:
                        item === selected.chosen ? BRAIN_ACCENTS.green : BRAIN_ACCENTS.slate,
                    } as CSSProperties
                  }
                >
                  {item === selected.chosen ? (
                    <CheckCircle2 size={12} strokeWidth={2} aria-hidden='true' />
                  ) : null}
                  {item}
                </span>
              ))}
            </div>
          </section>
          <section className='brain-detail__section'>
            <span className='brain-detail__label'>Escolhida</span>
            <p className='brain-detail__text'>{selected.chosen}</p>
          </section>
          <section className='brain-detail__section'>
            <span className='brain-detail__label'>Impacto</span>
            <div className='brain-chip-row'>
              {selected.impact.map((item, index) => (
                <span
                  key={item}
                  className='brain-chip brain-chip--accented'
                  style={
                    {
                      ['--chip-accent' as string]:
                        [BRAIN_ACCENTS.blue, BRAIN_ACCENTS.cyan, BRAIN_ACCENTS.amber, BRAIN_ACCENTS.pink][
                          index % 4
                        ],
                    } as CSSProperties
                  }
                >
                  {item}
                </span>
              ))}
            </div>
          </section>
          <section className='brain-detail__section'>
            <span className='brain-detail__label'>
              <Users size={12} strokeWidth={2} aria-hidden='true' />
              Quem aprovou
            </span>
            <div className='brain-chip-row'>
              {selected.decidedBy.map((item, index) => (
                <span
                  key={item}
                  className='brain-chip brain-chip--accented'
                  style={
                    {
                      ['--chip-accent' as string]:
                        index % 2 === 0 ? BRAIN_ACCENTS.pink : BRAIN_ACCENTS.blue,
                    } as CSSProperties
                  }
                >
                  {item}
                </span>
              ))}
            </div>
          </section>
          <section className='brain-detail__section'>
            <span className='brain-detail__label'>Arquivos relacionados</span>
            <ul className='brain-list'>
              {selected.relatedFiles.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section className='brain-detail__section'>
            <span className='brain-detail__label'>Relacionados</span>
            <ul className='brain-list'>
              {selected.relatedPr ? <li>{selected.relatedPr}</li> : null}
              {selected.relatedIssue ? <li>{selected.relatedIssue}</li> : null}
              {selected.relatedMeeting ? <li>{selected.relatedMeeting}</li> : null}
              {selected.relatedDocs.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </aside>
      ) : null}
    </div>
  );
}

export const BrainDecisionsTab = memo(BrainDecisionsTabComponent);

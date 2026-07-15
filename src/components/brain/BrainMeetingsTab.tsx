import { memo, useCallback, useMemo, useState, type ChangeEvent, type CSSProperties } from 'react';
import { Clock3, Mic, Smile, Users } from 'lucide-react';
import { EmptyState } from '@/components/overlay/EmptyState';
import { BRAIN_ACCENTS } from '@/components/brain/brainAccents';
import type { BrainMeeting } from '@/components/brain/brainTypes';

interface BrainMeetingsTabProps {
  meetings: BrainMeeting[];
  onAdd?: () => void;
}

function BrainMeetingsTabComponent({ meetings, onAdd }: BrainMeetingsTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(meetings[0]?.id ?? null);
  const [askValue, setAskValue] = useState('');

  const selected = useMemo(
    () => meetings.find((item) => item.id === selectedId) ?? meetings[0] ?? null,
    [meetings, selectedId],
  );

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const handleAskChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setAskValue(event.target.value);
  }, []);

  if (meetings.length === 0) {
    return (
      <EmptyState
        icon={Mic}
        title='Nenhuma reunião vinculada'
        message='Vincule transcrições do Mac Parakeet que pertencem a este projeto.'
        className='brain-empty'
      >
        {onAdd ? (
          <button
            type='button'
            className='brain-empty__cta app-button app-button--enter'
            onClick={onAdd}
          >
            Vincular transcrições
          </button>
        ) : null}
      </EmptyState>
    );
  }

  return (
    <div className='brain-meetings app-button--enter'>
      <div className='brain-split'>
        <div className='brain-split__list'>
          {meetings.map((meeting) => {
            const isActive = selected?.id === meeting.id;

            return (
              <button
                key={meeting.id}
                type='button'
                className={`brain-list-item app-button${isActive ? ' brain-list-item--active app-button--enter' : ''}`}
                style={{ ['--item-accent' as string]: BRAIN_ACCENTS.green } as CSSProperties}
                onClick={() => handleSelect(meeting.id)}
              >
                <span className='brain-list-item__row'>
                  <span className='brain-list-item__icon' aria-hidden='true'>
                    <Mic size={15} strokeWidth={2} />
                  </span>
                  <span className='brain-list-item__main'>
                    <span className='brain-list-item__title'>{meeting.title}</span>
                    <span className='brain-list-item__meta'>
                      <span className='brain-meta-inline'>
                        <Clock3 size={11} strokeWidth={2} aria-hidden='true' />
                        {meeting.durationLabel}
                      </span>
                      <span className='brain-meta-inline'>
                        <Smile size={11} strokeWidth={2} aria-hidden='true' />
                        {meeting.sentiment}
                      </span>
                    </span>
                  </span>
                </span>
                <span className='brain-list-item__summary'>{meeting.summary}</span>
              </button>
            );
          })}
        </div>
        {selected ? (
          <aside
            className='brain-split__detail'
            style={{ ['--card-accent' as string]: BRAIN_ACCENTS.green } as CSSProperties}
          >
            <div className='brain-detail__hero'>
              <span className='brain-detail__hero-icon' aria-hidden='true'>
                <Mic size={18} strokeWidth={2} />
              </span>
              <div>
                <h3 className='brain-detail__title'>{selected.title}</h3>
                <div className='brain-detail__meta'>
                  <span className='brain-meta-inline'>
                    <Clock3 size={11} strokeWidth={2} aria-hidden='true' />
                    {selected.durationLabel}
                  </span>
                  <span>{selected.sentiment}</span>
                </div>
              </div>
            </div>
            <section className='brain-detail__section'>
              <span className='brain-detail__label'>Resumo</span>
              <p className='brain-detail__text'>{selected.summary}</p>
            </section>
            <section className='brain-detail__section'>
              <span className='brain-detail__label'>
                <Users size={12} strokeWidth={2} aria-hidden='true' />
                Participantes
              </span>
              <div className='brain-chip-row'>
                {selected.participants.map((item, index) => (
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
              <span className='brain-detail__label'>Transcrição</span>
              <p className='brain-detail__text'>{selected.transcriptPreview}</p>
            </section>
            <section className='brain-detail__section'>
              <span className='brain-detail__label'>Insights</span>
              <ul className='brain-list'>
                {selected.insights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
            <section className='brain-detail__section'>
              <span className='brain-detail__label'>Decisões</span>
              <div className='brain-chip-row'>
                {selected.decisions.map((item) => (
                  <span
                    key={item}
                    className='brain-chip brain-chip--accented'
                    style={{ ['--chip-accent' as string]: BRAIN_ACCENTS.amber } as CSSProperties}
                  >
                    {item}
                  </span>
                ))}
              </div>
            </section>
            <section className='brain-detail__section'>
              <span className='brain-detail__label'>Tarefas</span>
              <ul className='brain-list'>
                {selected.tasks.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
            <section className='brain-detail__section'>
              <span className='brain-detail__label'>Arquivos citados</span>
              <ul className='brain-list'>
                {selected.mentionedFiles.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
            <section className='brain-detail__section'>
              <span className='brain-detail__label'>Projetos citados</span>
              <div className='brain-chip-row'>
                {selected.mentionedProjects.map((item) => (
                  <span
                    key={item}
                    className='brain-chip brain-chip--accented'
                    style={{ ['--chip-accent' as string]: BRAIN_ACCENTS.indigo } as CSSProperties}
                  >
                    {item}
                  </span>
                ))}
              </div>
            </section>
            <section className='brain-detail__section'>
              <span className='brain-detail__label'>Perguntas abertas</span>
              <ul className='brain-list'>
                {selected.openQuestions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          </aside>
        ) : null}
      </div>
      <div className='brain-meetings__ask'>
        <input
          type='text'
          className='brain-meetings__ask-input'
          placeholder='Pergunte algo sobre esta reunião'
          value={askValue}
          onChange={handleAskChange}
          aria-label='Pergunte algo sobre esta reunião'
        />
      </div>
    </div>
  );
}

export const BrainMeetingsTab = memo(BrainMeetingsTabComponent);

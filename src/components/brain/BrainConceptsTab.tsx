import { memo, useCallback, useMemo, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  Bot,
  CircleHelp,
  FileText,
  Mic,
  Network,
  Scale,
  MessageSquareText,
} from 'lucide-react';
import { EmptyState } from '@/components/overlay/EmptyState';
import { BRAIN_ACCENTS } from '@/components/brain/brainAccents';
import type { BrainConcept } from '@/components/brain/brainTypes';

interface BrainConceptsTabProps {
  concepts: BrainConcept[];
  onAdd?: () => void;
}

const CONCEPT_ACCENTS = [
  BRAIN_ACCENTS.purple,
  BRAIN_ACCENTS.cyan,
  BRAIN_ACCENTS.amber,
  BRAIN_ACCENTS.blue,
  BRAIN_ACCENTS.green,
  BRAIN_ACCENTS.pink,
];

function BrainConceptsTabComponent({ concepts, onAdd }: BrainConceptsTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(
    () => concepts.find((item) => item.id === selectedId) ?? null,
    [concepts, selectedId],
  );

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedId(null);
  }, []);

  if (concepts.length === 0) {
    return (
      <EmptyState
        icon={Network}
        title='Nenhum conceito'
        message='Conceitos do projeto serão construídos automaticamente aqui.'
        className='brain-empty'
      >
        {onAdd ? (
          <button
            type='button'
            className='brain-empty__cta app-button app-button--enter'
            onClick={onAdd}
          >
            Adicionar conceito
          </button>
        ) : null}
      </EmptyState>
    );
  }

  if (selected) {
    const accent =
      CONCEPT_ACCENTS[concepts.findIndex((item) => item.id === selected.id) % CONCEPT_ACCENTS.length];

    return (
      <div
        className='brain-concept-detail app-button--enter'
        style={{ ['--card-accent' as string]: accent } as CSSProperties}
      >
        <button
          type='button'
          className='brain-back app-button app-button--enter'
          onClick={handleBack}
        >
          <ArrowLeft size={13} strokeWidth={2} aria-hidden='true' />
          Voltar aos conceitos
        </button>
        <div className='brain-detail__hero'>
          <span className='brain-detail__hero-icon' aria-hidden='true'>
            <Network size={18} strokeWidth={2} />
          </span>
          <div>
            <h3 className='brain-detail__title'>{selected.name}</h3>
            <p className='brain-detail__text'>{selected.summary}</p>
          </div>
        </div>
        {(
          [
            ['Arquivos', selected.files, FileText],
            ['Documentos', selected.documents, FileText],
            ['Reuniões', selected.meetings, Mic],
            ['Decisões', selected.decisions, Scale],
            ['Issues', selected.issues, CircleHelp],
            ['Prompts', selected.prompts, MessageSquareText],
            ['Agentes', selected.agents, Bot],
            ['Perguntas frequentes', selected.faqs, CircleHelp],
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
      </div>
    );
  }

  return (
    <div className='brain-concepts-grid'>
      {concepts.map((concept, index) => {
        const accent = CONCEPT_ACCENTS[index % CONCEPT_ACCENTS.length];

        return (
          <button
            key={concept.id}
            type='button'
            className='brain-concept-tile app-button app-button--enter'
            style={
              {
                animationDelay: `${40 + index * 40}ms`,
                ['--card-accent' as string]: accent,
              } as CSSProperties
            }
            onClick={() => handleSelect(concept.id)}
          >
            <span className='brain-concept-tile__icon' aria-hidden='true'>
              <Network size={16} strokeWidth={2} />
            </span>
            <strong className='brain-concept-tile__title'>{concept.name}</strong>
            <p className='brain-concept-tile__text'>{concept.summary}</p>
          </button>
        );
      })}
    </div>
  );
}

export const BrainConceptsTab = memo(BrainConceptsTabComponent);

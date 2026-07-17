import { memo, useCallback, useMemo, useState, type CSSProperties } from 'react';
import {
  Bot,
  Braces,
  FileCode2,
  FileText,
  Figma,
  BookOpen,
  FileType,
  NotebookPen,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { EmptyState } from '@/components/overlay/EmptyState';
import { BRAIN_ACCENTS, BRAIN_KIND_ACCENTS } from '@/components/brain/brainAccents';
import type { BrainDocument, BrainDocumentKind } from '@/components/brain/brainTypes';

interface BrainDocumentsTabProps {
  documents: BrainDocument[];
  onAdd?: () => void;
}

const KIND_ICONS: Record<BrainDocumentKind, LucideIcon> = {
  markdown: BookOpen,
  pdf: FileType,
  openapi: Braces,
  notion: NotebookPen,
  figma: Figma,
  word: FileText,
  wiki: BookOpen,
  readme: FileCode2,
};

function BrainDocumentsTabComponent({ documents, onAdd }: BrainDocumentsTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(documents[0]?.id ?? null);

  const selected = useMemo(
    () => documents.find((item) => item.id === selectedId) ?? documents[0] ?? null,
    [documents, selectedId],
  );

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  if (documents.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title='Nenhum documento indexado'
        message='Documentos, PDFs e contratos aparecerão aqui quando forem adicionados ao Cérebro.'
        className='brain-empty'
      >
        {onAdd ? (
          <button
            type='button'
            className='brain-empty__cta app-button app-button--enter'
            onClick={onAdd}
          >
            Adicionar arquivos
          </button>
        ) : null}
      </EmptyState>
    );
  }

  return (
    <div className='brain-split app-button--enter'>
      <div className='brain-split__list' role='list'>
        {documents.map((doc) => {
          const isActive = selected?.id === doc.id;
          const Icon = KIND_ICONS[doc.kind];
          const accent = BRAIN_KIND_ACCENTS[doc.kind] ?? BRAIN_ACCENTS.blue;

          return (
            <button
              key={doc.id}
              type='button'
              role='listitem'
              className={`brain-list-item app-button${isActive ? ' brain-list-item--active app-button--enter' : ''}`}
              style={{ ['--item-accent' as string]: accent } as CSSProperties}
              onClick={() => handleSelect(doc.id)}
            >
              <span className='brain-list-item__row'>
                <span className='brain-list-item__icon' aria-hidden='true'>
                  <Icon size={15} strokeWidth={2} />
                </span>
                <span className='brain-list-item__main'>
                  <span className='brain-list-item__title'>{doc.name}</span>
                  <span className='brain-list-item__meta'>
                    <span
                      className='brain-status-pill'
                      style={
                        {
                          ['--chip-accent' as string]:
                            BRAIN_KIND_ACCENTS[doc.status] ?? BRAIN_ACCENTS.slate,
                        } as CSSProperties
                      }
                    >
                      {doc.status}
                    </span>
                    <span>
                      {doc.kind} · {doc.origin}
                    </span>
                  </span>
                </span>
              </span>
              <span className='brain-list-item__summary'>{doc.aiSummary}</span>
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
                BRAIN_KIND_ACCENTS[selected.kind] ?? BRAIN_ACCENTS.blue,
            } as CSSProperties
          }
        >
          <div className='brain-detail__hero'>
            <span className='brain-detail__hero-icon' aria-hidden='true'>
              {(() => {
                const Icon = KIND_ICONS[selected.kind];
                return <Icon size={18} strokeWidth={2} />;
              })()}
            </span>
            <div>
              <h3 className='brain-detail__title'>{selected.name}</h3>
              <div className='brain-detail__meta'>
                <span
                  className='brain-status-pill'
                  style={
                    {
                      ['--chip-accent' as string]:
                        BRAIN_KIND_ACCENTS[selected.status] ?? BRAIN_ACCENTS.slate,
                    } as CSSProperties
                  }
                >
                  {selected.status}
                </span>
                <span>{selected.origin}</span>
                <span>{selected.updatedAtLabel}</span>
              </div>
            </div>
          </div>
          <div className='brain-chip-row'>
            {selected.tags.map((tag) => (
              <span
                key={tag}
                className='brain-chip brain-chip--accented'
                style={{ ['--chip-accent' as string]: BRAIN_ACCENTS.blue } as CSSProperties}
              >
                {tag}
              </span>
            ))}
          </div>
          <section className='brain-detail__section'>
            <span className='brain-detail__label'>
              <Sparkles size={12} strokeWidth={2} aria-hidden='true' />
              Resumo IA
            </span>
            <p className='brain-detail__text'>{selected.aiSummary}</p>
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
            <span className='brain-detail__label'>Decisões relacionadas</span>
            {selected.relatedDecisions.length > 0 ? (
              <ul className='brain-list'>
                {selected.relatedDecisions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className='brain-detail__text'>Nenhuma</p>
            )}
          </section>
          <section className='brain-detail__section'>
            <span className='brain-detail__label'>Reuniões relacionadas</span>
            {selected.relatedMeetings.length > 0 ? (
              <ul className='brain-list'>
                {selected.relatedMeetings.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className='brain-detail__text'>Nenhuma</p>
            )}
          </section>
          <section className='brain-detail__section'>
            <span className='brain-detail__label'>Issues relacionadas</span>
            {selected.relatedIssues.length > 0 ? (
              <ul className='brain-list'>
                {selected.relatedIssues.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className='brain-detail__text'>Nenhuma</p>
            )}
          </section>
          <section className='brain-detail__section'>
            <span className='brain-detail__label'>
              <Bot size={12} strokeWidth={2} aria-hidden='true' />
              Agentes que modificaram
            </span>
            {selected.agentsModified.length > 0 ? (
              <ul className='brain-list'>
                {selected.agentsModified.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className='brain-detail__text'>Nenhum</p>
            )}
          </section>
          <section className='brain-detail__section'>
            <span className='brain-detail__label'>Última alteração</span>
            <p className='brain-detail__text'>{selected.lastChangeLabel}</p>
          </section>
        </aside>
      ) : null}
    </div>
  );
}

export const BrainDocumentsTab = memo(BrainDocumentsTabComponent);

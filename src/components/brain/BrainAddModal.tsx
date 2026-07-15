import { memo, useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import {
  BRAIN_ADD_MODAL_TITLES,
  BRAIN_DECISION_STATUS_OPTIONS,
  splitCommaList,
} from '@/components/brain/brainManualFields';
import type {
  BrainAgentRun,
  BrainConcept,
  BrainDecision,
  BrainDecisionStatus,
  BrainMemoryFact,
  BrainPerson,
  BrainPrompt,
  BrainQuestion,
} from '@/components/brain/brainTypes';
import {
  appendBrainManualItem,
  type BrainManualEditableTabId,
} from '@/utils/brainManualStore';

type BrainAddModalTabId = Exclude<BrainManualEditableTabId, 'documents' | 'meetings'>;

interface BrainAddModalProps {
  projectPath: string;
  tabId: BrainAddModalTabId;
  onClose: () => void;
  onSaved: () => void;
}

function normalizeTagValue(value: string): string {
  return value.trim().replace(/,+$/, '').trim();
}

function BrainAddModalComponent({ projectPath, tabId, onClose, onSaved }: BrainAddModalProps) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [origin, setOrigin] = useState('');
  const [secondary, setSecondary] = useState('');
  const [tertiary, setTertiary] = useState('');
  const [decisionStatus, setDecisionStatus] = useState<BrainDecisionStatus>('proposed');
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle('');
    setSummary('');
    setOrigin('');
    setSecondary('');
    setTertiary('');
    setDecisionStatus('proposed');
    setTags([]);
    setTagDraft('');
    setError(null);
    setSaving(false);
  }, [tabId]);

  const handleAddTag = useCallback((rawValue: string) => {
    const nextTag = normalizeTagValue(rawValue);
    if (!nextTag) {
      return;
    }
    setTags((current) => (current.includes(nextTag) ? current : [...current, nextTag]));
    setTagDraft('');
  }, []);

  const handleRemoveTag = useCallback((tag: string) => {
    setTags((current) => current.filter((item) => item !== tag));
  }, []);

  const handleTagKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        handleAddTag(tagDraft);
      }
    },
    [handleAddTag, tagDraft],
  );

  const buildItem = useCallback(() => {
    const id = `manual:${crypto.randomUUID()}`;
    const nowLabel = 'agora';
    const trimmedTitle = title.trim();

    switch (tabId) {
      case 'decisions': {
        const item: BrainDecision = {
          id,
          title: trimmedTitle,
          status: decisionStatus,
          reason: summary.trim(),
          context: origin.trim(),
          alternatives: [],
          chosen: secondary.trim(),
          decidedBy: splitCommaList(tertiary),
          decidedAtLabel: nowLabel,
          impact: tags,
          relatedFiles: [],
          relatedPr: null,
          relatedIssue: null,
          relatedMeeting: null,
          relatedDocs: [],
        };
        return item;
      }
      case 'prompts': {
        const item: BrainPrompt = {
          id,
          title: trimmedTitle,
          result: summary.trim(),
          created: tags,
          related: [],
          agentName: origin.trim() || 'Manual',
          updatedAtLabel: nowLabel,
        };
        return item;
      }
      case 'agents': {
        const item: BrainAgentRun = {
          id,
          name: trimmedTitle,
          mission: summary.trim(),
          result: secondary.trim(),
          fileCount: 0,
          durationLabel: '—',
          costLabel: '—',
          model: origin.trim() || '—',
          summary: tertiary.trim() || summary.trim(),
        };
        return item;
      }
      case 'concepts': {
        const item: BrainConcept = {
          id,
          name: trimmedTitle,
          summary: summary.trim(),
          files: [],
          documents: [],
          meetings: [],
          decisions: [],
          issues: [],
          prompts: [],
          agents: [],
          faqs: [],
        };
        return item;
      }
      case 'people': {
        const item: BrainPerson = {
          id,
          name: trimmedTitle,
          specialties: tags.length > 0 ? tags : splitCommaList(summary),
          meetings: [],
          decisions: [],
          prs: [],
          documents: [],
          comments: [],
          agents: [],
        };
        return item;
      }
      case 'questions': {
        const item: BrainQuestion = {
          id,
          question: trimmedTitle,
          answer: summary.trim(),
          related: splitCommaList(secondary),
        };
        return item;
      }
      case 'memory': {
        const item: BrainMemoryFact = {
          id,
          title: trimmedTitle,
          fields: summary.trim()
            ? [{ label: 'Detalhe', value: summary.trim() }]
            : [],
          origins: splitCommaList(origin).length > 0 ? splitCommaList(origin) : ['Manual'],
          lastConfirmedLabel: nowLabel,
        };
        return item;
      }
      default:
        return null;
    }
  }, [
    decisionStatus,
    origin,
    secondary,
    summary,
    tabId,
    tags,
    tertiary,
    title,
  ]);

  const handleSubmit = useCallback(
    async (event: FormEvent, requestClose: () => void) => {
      event.preventDefault();
      const trimmedTitle = title.trim();
      if (!trimmedTitle) {
        setError('Informe um título');
        return;
      }

      const item = buildItem();
      if (!item) {
        setError('Tipo inválido');
        return;
      }

      setSaving(true);
      setError(null);
      const result = await appendBrainManualItem(projectPath, tabId, item);
      setSaving(false);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      onSaved();
      requestClose();
    },
    [buildItem, onSaved, projectPath, tabId, title],
  );

  const titleLabel =
    tabId === 'people'
      ? 'Nome'
      : tabId === 'questions'
        ? 'Pergunta'
        : tabId === 'concepts'
          ? 'Nome do conceito'
          : 'Título';

  return (
    <AnimatedModal onClose={onClose} panelClassName='project-dialog brain-add-modal'>
      {(requestClose) => (
        <form
          className='brain-add-modal__form'
          onSubmit={(event) => {
            void handleSubmit(event, requestClose);
          }}
        >
          <span className='project-dialog__title'>{BRAIN_ADD_MODAL_TITLES[tabId]}</span>

          <label className='brain-add-modal__field'>
            <span>{titleLabel}</span>
            <input
              value={title}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>

          {tabId === 'decisions' ? (
            <>
              <label className='brain-add-modal__field'>
                <span>Status</span>
                <AnchoredSelect
                  value={decisionStatus}
                  options={BRAIN_DECISION_STATUS_OPTIONS}
                  onChange={(value) => setDecisionStatus(value as BrainDecisionStatus)}
                  triggerClassName='brain-add-modal__select'
                />
              </label>
              <label className='brain-add-modal__field'>
                <span>Motivo</span>
                <textarea
                  value={summary}
                  rows={3}
                  onChange={(event) => setSummary(event.target.value)}
                />
              </label>
              <label className='brain-add-modal__field'>
                <span>Contexto</span>
                <input
                  value={origin}
                  onChange={(event) => setOrigin(event.target.value)}
                />
              </label>
              <label className='brain-add-modal__field'>
                <span>Escolha</span>
                <input
                  value={secondary}
                  onChange={(event) => setSecondary(event.target.value)}
                />
              </label>
              <label className='brain-add-modal__field'>
                <span>Decidido por</span>
                <input
                  value={tertiary}
                  placeholder='Separados por vírgula'
                  onChange={(event) => setTertiary(event.target.value)}
                />
              </label>
              <label className='brain-add-modal__field'>
                <span>Impacto (tags)</span>
                <div className='brain-add-modal__tags'>
                  {tags.map((tag) => (
                    <span key={tag} className='brain-add-modal__tag'>
                      <span>{tag}</span>
                      <button
                        type='button'
                        className='brain-add-modal__tag-remove app-button'
                        aria-label={`Remover tag ${tag}`}
                        onClick={() => handleRemoveTag(tag)}
                      >
                        <X size={12} strokeWidth={2} />
                      </button>
                    </span>
                  ))}
                  <input
                    className='brain-add-modal__tag-input'
                    value={tagDraft}
                    placeholder='Digite e pressione Enter'
                    onChange={(event) => setTagDraft(event.target.value)}
                    onKeyDown={handleTagKeyDown}
                    onBlur={() => handleAddTag(tagDraft)}
                  />
                </div>
              </label>
            </>
          ) : null}

          {tabId === 'prompts' ? (
            <>
              <label className='brain-add-modal__field'>
                <span>Resultado</span>
                <textarea
                  value={summary}
                  rows={4}
                  onChange={(event) => setSummary(event.target.value)}
                />
              </label>
              <label className='brain-add-modal__field'>
                <span>Agente</span>
                <input
                  value={origin}
                  placeholder='Opcional'
                  onChange={(event) => setOrigin(event.target.value)}
                />
              </label>
              <label className='brain-add-modal__field'>
                <span>Criou (tags)</span>
                <div className='brain-add-modal__tags'>
                  {tags.map((tag) => (
                    <span key={tag} className='brain-add-modal__tag'>
                      <span>{tag}</span>
                      <button
                        type='button'
                        className='brain-add-modal__tag-remove app-button'
                        aria-label={`Remover tag ${tag}`}
                        onClick={() => handleRemoveTag(tag)}
                      >
                        <X size={12} strokeWidth={2} />
                      </button>
                    </span>
                  ))}
                  <input
                    className='brain-add-modal__tag-input'
                    value={tagDraft}
                    placeholder='Digite e pressione Enter'
                    onChange={(event) => setTagDraft(event.target.value)}
                    onKeyDown={handleTagKeyDown}
                    onBlur={() => handleAddTag(tagDraft)}
                  />
                </div>
              </label>
            </>
          ) : null}

          {tabId === 'agents' ? (
            <>
              <label className='brain-add-modal__field'>
                <span>Missão</span>
                <textarea
                  value={summary}
                  rows={3}
                  onChange={(event) => setSummary(event.target.value)}
                />
              </label>
              <label className='brain-add-modal__field'>
                <span>Resultado</span>
                <textarea
                  value={secondary}
                  rows={3}
                  onChange={(event) => setSecondary(event.target.value)}
                />
              </label>
              <label className='brain-add-modal__field'>
                <span>Modelo</span>
                <input
                  value={origin}
                  placeholder='Opcional'
                  onChange={(event) => setOrigin(event.target.value)}
                />
              </label>
            </>
          ) : null}

          {tabId === 'concepts' ? (
            <label className='brain-add-modal__field'>
              <span>Resumo</span>
              <textarea
                value={summary}
                rows={4}
                onChange={(event) => setSummary(event.target.value)}
              />
            </label>
          ) : null}

          {tabId === 'people' ? (
            <label className='brain-add-modal__field'>
              <span>Especialidades</span>
              <div className='brain-add-modal__tags'>
                {tags.map((tag) => (
                  <span key={tag} className='brain-add-modal__tag'>
                    <span>{tag}</span>
                    <button
                      type='button'
                      className='brain-add-modal__tag-remove app-button'
                      aria-label={`Remover ${tag}`}
                      onClick={() => handleRemoveTag(tag)}
                    >
                      <X size={12} strokeWidth={2} />
                    </button>
                  </span>
                ))}
                <input
                  className='brain-add-modal__tag-input'
                  value={tagDraft}
                  placeholder='Digite e pressione Enter'
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={handleTagKeyDown}
                  onBlur={() => handleAddTag(tagDraft)}
                />
              </div>
            </label>
          ) : null}

          {tabId === 'questions' ? (
            <>
              <label className='brain-add-modal__field'>
                <span>Resposta</span>
                <textarea
                  value={summary}
                  rows={4}
                  onChange={(event) => setSummary(event.target.value)}
                />
              </label>
              <label className='brain-add-modal__field'>
                <span>Relacionados</span>
                <input
                  value={secondary}
                  placeholder='Separados por vírgula'
                  onChange={(event) => setSecondary(event.target.value)}
                />
              </label>
            </>
          ) : null}

          {tabId === 'memory' ? (
            <>
              <label className='brain-add-modal__field'>
                <span>Detalhe</span>
                <textarea
                  value={summary}
                  rows={4}
                  onChange={(event) => setSummary(event.target.value)}
                />
              </label>
              <label className='brain-add-modal__field'>
                <span>Origens</span>
                <input
                  value={origin}
                  placeholder='Separados por vírgula'
                  onChange={(event) => setOrigin(event.target.value)}
                />
              </label>
            </>
          ) : null}

          {error ? <p className='brain-add-modal__error'>{error}</p> : null}

          <div className='project-dialog__actions project-dialog__actions--split'>
            <div className='project-dialog__actions-group'>
              <button
                type='button'
                className='project-dialog__btn project-dialog__btn--ghost app-button'
                onClick={requestClose}
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                type='submit'
                className='project-dialog__btn project-dialog__btn--primary app-button'
                disabled={saving}
              >
                Salvar
              </button>
            </div>
          </div>
        </form>
      )}
    </AnimatedModal>
  );
}

export const BrainAddModal = memo(BrainAddModalComponent);

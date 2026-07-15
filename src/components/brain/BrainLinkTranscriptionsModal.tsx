import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Mic } from 'lucide-react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { AppCheckbox } from '@/components/overlay/AppCheckbox';
import { EmptyState } from '@/components/overlay/EmptyState';
import type { MacParakeetTranscriptionItem } from '@/types';
import {
  formatMacParakeetDate,
  formatMacParakeetDuration,
  resolveMacParakeetSourceLabel,
} from '@/utils/macParakeetLabels';
import {
  loadBrainManual,
  saveBrainLinkedTranscriptionIds,
} from '@/utils/brainManualStore';

interface BrainLinkTranscriptionsModalProps {
  projectPath: string;
  onClose: () => void;
  onSaved: () => void;
}

interface BrainLinkTranscriptionItemProps {
  item: MacParakeetTranscriptionItem;
  checked: boolean;
  onToggle: (id: string, checked: boolean) => void;
}

function BrainLinkTranscriptionItemComponent({
  item,
  checked,
  onToggle,
}: BrainLinkTranscriptionItemProps) {
  const handleToggle = useCallback(
    (nextChecked: boolean) => {
      onToggle(item.id, nextChecked);
    },
    [item.id, onToggle],
  );

  const handleRowClick = useCallback(() => {
    onToggle(item.id, !checked);
  }, [checked, item.id, onToggle]);

  return (
    <div
      className={`brain-link-transcriptions__item app-button app-button--enter${checked ? ' brain-link-transcriptions__item--active' : ''}`}
      onClick={handleRowClick}
      role='button'
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleRowClick();
        }
      }}
    >
      <span
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <AppCheckbox
          checked={checked}
          aria-label={`Vincular ${item.title || 'transcrição'}`}
          onChange={handleToggle}
        />
      </span>
      <span className='brain-link-transcriptions__item-icon' aria-hidden='true'>
        <Mic size={14} strokeWidth={2} />
      </span>
      <span className='brain-link-transcriptions__item-copy'>
        <span className='brain-link-transcriptions__item-title'>{item.title || 'Sem título'}</span>
        <span className='brain-link-transcriptions__item-meta'>
          {resolveMacParakeetSourceLabel(item.sourceType)} · {formatMacParakeetDuration(item.durationMs)} ·{' '}
          {formatMacParakeetDate(item.createdAt)}
        </span>
        {item.snippet ? (
          <span className='brain-link-transcriptions__item-snippet'>{item.snippet}</span>
        ) : null}
      </span>
    </div>
  );
}

const BrainLinkTranscriptionItem = memo(BrainLinkTranscriptionItemComponent);

function BrainLinkTranscriptionsModalComponent({
  projectPath,
  onClose,
  onSaved,
}: BrainLinkTranscriptionsModalProps) {
  const [items, setItems] = useState<MacParakeetTranscriptionItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);

      try {
        const [manual, snapshot] = await Promise.all([
          loadBrainManual(projectPath),
          window.nexus.macParakeet.getTranscriptions(null, true),
        ]);

        if (cancelled) {
          return;
        }

        setSelectedIds([...manual.linkedTranscriptionIds]);
        setItems(snapshot.available ? snapshot.transcriptions : []);
      } catch {
        if (!cancelled) {
          setError('Não foi possível carregar as transcrições');
          setItems([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedCount = selectedIds.length;

  const sortedItems = useMemo(
    () => [...items].sort((left, right) => right.createdAt - left.createdAt),
    [items],
  );

  const handleToggle = useCallback((id: string, checked: boolean) => {
    setSelectedIds((current) => {
      if (checked) {
        return current.includes(id) ? current : [...current, id];
      }
      return current.filter((item) => item !== id);
    });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);

    try {
      const result = await saveBrainLinkedTranscriptionIds(projectPath, selectedIds);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const verified = await loadBrainManual(projectPath);
      const savedCount = verified.linkedTranscriptionIds.length;
      if (selectedIds.length > 0 && savedCount === 0) {
        setError('A seleção não foi gravada no projeto');
        return;
      }

      onSaved();
    } catch {
      setError('Falha ao salvar as transcrições vinculadas');
    } finally {
      setSaving(false);
    }
  }, [onSaved, projectPath, selectedIds]);

  return (
    <AnimatedModal onClose={onClose} panelClassName='project-dialog brain-link-transcriptions'>
      {() => (
        <>
          <span className='project-dialog__title'>Vincular transcrições</span>
          <p className='project-dialog__message'>
            Selecione quais reuniões do Mac Parakeet fazem parte deste projeto.
          </p>

          {loading ? (
            <p className='brain-link-transcriptions__loading'>Carregando transcrições…</p>
          ) : null}

          {!loading && sortedItems.length === 0 ? (
            <EmptyState
              icon={Mic}
              title='Nenhuma transcrição'
              message='Não há gravações disponíveis no Mac Parakeet.'
              compact
              className='brain-link-transcriptions__empty'
            />
          ) : null}

          {!loading && sortedItems.length > 0 ? (
            <div className='brain-link-transcriptions__list' role='list'>
              {sortedItems.map((item) => (
                <BrainLinkTranscriptionItem
                  key={item.id}
                  item={item}
                  checked={selectedSet.has(item.id)}
                  onToggle={handleToggle}
                />
              ))}
            </div>
          ) : null}

          {error ? <p className='brain-add-modal__error'>{error}</p> : null}

          <div className='project-dialog__actions project-dialog__actions--split'>
            <span className='brain-link-transcriptions__count'>
              {selectedCount} selecionada{selectedCount === 1 ? '' : 's'}
            </span>
            <div className='project-dialog__actions-group'>
              <button
                type='button'
                className='project-dialog__btn project-dialog__btn--ghost app-button'
                onClick={onClose}
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                type='button'
                className='project-dialog__btn project-dialog__btn--primary app-button'
                onClick={() => {
                  void handleSave();
                }}
                disabled={saving || loading}
              >
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

export const BrainLinkTranscriptionsModal = memo(BrainLinkTranscriptionsModalComponent);

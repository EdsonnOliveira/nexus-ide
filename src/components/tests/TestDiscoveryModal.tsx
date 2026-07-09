import { FlaskConical, Loader2, Search } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { AppCheckbox } from '@/components/overlay/AppCheckbox';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { EmptyState } from '@/components/overlay/EmptyState';
import type { DiscoveredTestTarget, ProjectTestEntry, TestRunnerKind } from '@/types/test';
import { getTestRunnerLabel } from '@/utils/testLabels';
import { createProjectTestEntry } from '@/utils/testOutputTracker';

interface TestDiscoveryModalProps {
  kind: TestRunnerKind;
  projectPath: string;
  existingEntries: ProjectTestEntry[];
  onClose: () => void;
  onConfirm: (entries: ProjectTestEntry[]) => void;
}

function TestDiscoveryModalComponent({
  kind,
  projectPath,
  existingEntries,
  onClose,
  onConfirm,
}: TestDiscoveryModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [targets, setTargets] = useState<DiscoveredTestTarget[]>([]);
  const [query, setQuery] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const discovered = await window.nexus.tests.discover(projectPath, kind);

        if (cancelled) {
          return;
        }

        setTargets(discovered);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : 'Falha ao buscar testes');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [kind, projectPath]);

  const existingPaths = useMemo(
    () => new Set(existingEntries.map((entry) => `${entry.kind}:${entry.targetPath}`)),
    [existingEntries],
  );

  const filteredTargets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return targets;
    }

    return targets.filter(
      (target) =>
        target.name.toLowerCase().includes(normalizedQuery) ||
        target.relativePath.toLowerCase().includes(normalizedQuery),
    );
  }, [query, targets]);

  const selectableTargets = useMemo(
    () =>
      filteredTargets.filter(
        (target) => !existingPaths.has(`${target.kind}:${target.relativePath}`),
      ),
    [existingPaths, filteredTargets],
  );

  const allSelectableTargets = useMemo(
    () =>
      targets.filter((target) => !existingPaths.has(`${target.kind}:${target.relativePath}`)),
    [existingPaths, targets],
  );

  const allFilteredSelected = useMemo(
    () =>
      selectableTargets.length > 0 &&
      selectableTargets.every((target) =>
        selectedPaths.has(`${target.kind}:${target.relativePath}`),
      ),
    [selectableTargets, selectedPaths],
  );

  const togglePath = useCallback((pathKey: string, checked: boolean) => {
    setSelectedPaths((current) => {
      const next = new Set(current);

      if (checked) {
        next.add(pathKey);
      } else {
        next.delete(pathKey);
      }

      return next;
    });
  }, []);

  const handleToggleAllFiltered = useCallback(
    (checked: boolean) => {
      setSelectedPaths((current) => {
        const next = new Set(current);

        for (const target of selectableTargets) {
          const pathKey = `${target.kind}:${target.relativePath}`;

          if (checked) {
            next.add(pathKey);
          } else {
            next.delete(pathKey);
          }
        }

        return next;
      });
    },
    [selectableTargets],
  );

  const buildEntriesFromTargets = useCallback(
    (items: DiscoveredTestTarget[]) =>
      items.map((target) =>
        createProjectTestEntry(target.kind, target.relativePath, target.isDirectory),
      ),
    [],
  );

  const handleConfirm = useCallback(
    (requestClose: () => void) => {
      const entries = buildEntriesFromTargets(
        filteredTargets.filter((target) =>
          selectedPaths.has(`${target.kind}:${target.relativePath}`),
        ),
      ).filter((entry) => !existingPaths.has(`${entry.kind}:${entry.targetPath}`));

      onConfirm(entries);
      requestClose();
    },
    [buildEntriesFromTargets, existingPaths, filteredTargets, onConfirm, selectedPaths],
  );

  const handleAddAll = useCallback(
    (requestClose: () => void) => {
      onConfirm(buildEntriesFromTargets(allSelectableTargets));
      requestClose();
    },
    [allSelectableTargets, buildEntriesFromTargets, onConfirm],
  );

  const showSelectionUi = !loading && !error && targets.length > 0;

  return (
    <AnimatedModal panelClassName='project-dialog tests-discovery-modal' onClose={onClose}>
      {(requestClose) => (
        <>
          <span className='project-dialog__title'>Adicionar {getTestRunnerLabel(kind)}</span>
          {showSelectionUi ? (
            <p className='project-dialog__message'>Selecione os testes encontrados no projeto.</p>
          ) : null}

          {showSelectionUi ? (
            <label className='tests-discovery-modal__search'>
              <Search size={14} strokeWidth={2} aria-hidden='true' />
              <input
                type='search'
                className='tests-discovery-modal__search-input'
                placeholder='Buscar teste...'
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          ) : null}

          <div className='tests-discovery-modal__list'>
            {loading ? (
              <div className='tests-discovery-modal__loading'>
                <Loader2 size={18} className='tests-discovery-modal__spinner' />
                <span>Buscando testes...</span>
              </div>
            ) : error ? (
              <p className='tests-discovery-modal__error'>{error}</p>
            ) : filteredTargets.length === 0 ? (
              <EmptyState
                icon={FlaskConical}
                message={`Nenhum teste ${getTestRunnerLabel(kind)} encontrado`}
                compact
                className='tests-discovery-modal__empty'
              />
            ) : (
              <>
                {selectableTargets.length > 0 ? (
                  <div className='tests-discovery-modal__select-all'>
                    <AppCheckbox
                      checked={allFilteredSelected}
                      aria-label={allFilteredSelected ? 'Desmarcar todos' : 'Selecionar todos'}
                      onChange={handleToggleAllFiltered}
                    />
                    <span className='tests-discovery-modal__select-all-label'>
                      {allFilteredSelected ? 'Desmarcar todos' : 'Selecionar todos'}
                    </span>
                  </div>
                ) : null}
                {filteredTargets.map((target) => {
                const pathKey = `${target.kind}:${target.relativePath}`;
                const alreadyAdded = existingPaths.has(pathKey);
                const checked = selectedPaths.has(pathKey);

                return (
                  <label
                    key={pathKey}
                    className={`tests-discovery-modal__item app-button app-button--enter${alreadyAdded ? ' tests-discovery-modal__item--added' : ''}`}
                  >
                    <AppCheckbox
                      checked={checked}
                      disabled={alreadyAdded}
                      aria-label={`Selecionar ${target.name}`}
                      onChange={(nextChecked) => togglePath(pathKey, nextChecked)}
                    />
                    <span className='tests-discovery-modal__item-main'>
                      <span className='tests-discovery-modal__item-name'>{target.name}</span>
                      <span className='tests-discovery-modal__item-path'>{target.relativePath}</span>
                    </span>
                    {alreadyAdded ? (
                      <span className='tests-discovery-modal__item-badge'>Adicionado</span>
                    ) : null}
                  </label>
                );
              })}
              </>
            )}
          </div>

          <div className='project-dialog__actions tests-discovery-modal__actions'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--ghost app-button'
              onClick={requestClose}
            >
              Cancelar
            </button>
            {showSelectionUi ? (
              <>
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--ghost app-button'
                  disabled={allSelectableTargets.length === 0}
                  onClick={() => handleAddAll(requestClose)}
                >
                  Adicionar todos
                </button>
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--primary app-button'
                  disabled={selectedPaths.size === 0}
                  onClick={() => handleConfirm(requestClose)}
                >
                  Adicionar
                </button>
              </>
            ) : null}
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

export const TestDiscoveryModal = memo(TestDiscoveryModalComponent);

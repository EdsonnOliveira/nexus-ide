import { Search } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { AppCheckbox } from '@/components/overlay/AppCheckbox';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import type { ProjectTask, TaskFilterCategory, TaskListFilters } from '@/types/task';
import {
  buildTaskFilterOptions,
  countActiveTaskFilters,
  EMPTY_TASK_FILTERS,
  getTaskFilterSearchPlaceholder,
  TASK_FILTER_CATEGORIES,
} from '@/utils/taskFilters';

interface TaskFilterModalProps {
  tasks: ProjectTask[];
  filters: TaskListFilters;
  onClose: () => void;
  onApply: (filters: TaskListFilters) => void;
}

function TaskFilterModalComponent({ tasks, filters, onClose, onApply }: TaskFilterModalProps) {
  const [draftFilters, setDraftFilters] = useState<TaskListFilters>(filters);
  const [activeCategory, setActiveCategory] = useState<TaskFilterCategory>('parent');
  const [optionQuery, setOptionQuery] = useState('');

  const categoryOptions = useMemo(
    () => buildTaskFilterOptions(tasks, activeCategory),
    [activeCategory, tasks],
  );

  const filteredOptions = useMemo(() => {
    const normalizedQuery = optionQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return categoryOptions;
    }

    return categoryOptions.filter((option) => option.label.toLowerCase().includes(normalizedQuery));
  }, [categoryOptions, optionQuery]);

  const activeCategoryCount = useMemo(
    () => draftFilters[activeCategory].length,
    [activeCategory, draftFilters],
  );

  const handleCategoryChange = useCallback((category: TaskFilterCategory) => {
    setActiveCategory(category);
    setOptionQuery('');
  }, []);

  const handleToggleOption = useCallback(
    (value: string) => {
      setDraftFilters((current) => {
        const selected = current[activeCategory];
        const nextValues = selected.includes(value)
          ? selected.filter((item) => item !== value)
          : [...selected, value];

        return {
          ...current,
          [activeCategory]: nextValues,
        };
      });
    },
    [activeCategory],
  );

  const handleClearCategory = useCallback(() => {
    setDraftFilters((current) => ({
      ...current,
      [activeCategory]: [],
    }));
  }, [activeCategory]);

  const handleClearAll = useCallback(() => {
    setDraftFilters(EMPTY_TASK_FILTERS);
  }, []);

  const handleApply = useCallback(
    (requestClose: () => void) => {
      onApply(draftFilters);
      requestClose();
    },
    [draftFilters, onApply],
  );

  return (
    <AnimatedModal onClose={onClose} panelClassName='project-dialog task-filter-modal'>
      {(requestClose) => (
        <>
          <span className='project-dialog__title'>Filtrar tarefas</span>
          <div className='task-filter-modal__layout'>
            <div className='task-filter-modal__categories' role='tablist' aria-label='Categorias de filtro'>
              {TASK_FILTER_CATEGORIES.map((category) => {
                const selectedCount = draftFilters[category.id].length;

                return (
                  <button
                    key={category.id}
                    type='button'
                    role='tab'
                    aria-selected={activeCategory === category.id}
                    className={`task-filter-modal__category app-button${activeCategory === category.id ? ' task-filter-modal__category--active app-button--enter' : ''}`}
                    onClick={() => handleCategoryChange(category.id)}
                  >
                    <span>{category.label}</span>
                    {selectedCount > 0 ? (
                      <span className='task-filter-modal__category-count'>{selectedCount}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className='task-filter-modal__panel'>
              <label className='task-filter-modal__search'>
                <Search size={14} strokeWidth={2} aria-hidden />
                <input
                  value={optionQuery}
                  placeholder={getTaskFilterSearchPlaceholder(activeCategory)}
                  onChange={(event) => setOptionQuery(event.target.value)}
                />
              </label>
              <div className='task-filter-modal__options'>
                {filteredOptions.length === 0 ? (
                  <span className='task-filter-modal__empty'>Nenhuma opção encontrada</span>
                ) : (
                  filteredOptions.map((option) => {
                    const checked = draftFilters[activeCategory].includes(option.value);

                    return (
                      <div
                        key={option.value}
                        className={`task-filter-modal__option app-button${checked ? ' task-filter-modal__option--active app-button--enter' : ''}`}
                      >
                        <AppCheckbox
                          checked={checked}
                          aria-label={option.label}
                          onChange={() => handleToggleOption(option.value)}
                        />
                        <button
                          type='button'
                          className='task-filter-modal__option-label'
                          onClick={() => handleToggleOption(option.value)}
                        >
                          {option.label}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
              <div className='task-filter-modal__panel-footer'>
                <span>
                  {activeCategoryCount} de {categoryOptions.length}
                </span>
                {activeCategoryCount > 0 ? (
                  <button
                    type='button'
                    className='task-filter-modal__clear-category app-button'
                    onClick={handleClearCategory}
                  >
                    Limpar categoria
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <div className='project-dialog__actions'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--ghost app-button'
              onClick={requestClose}
            >
              Cancelar
            </button>
            {countActiveTaskFilters(draftFilters) > 0 ? (
              <button
                type='button'
                className='project-dialog__btn project-dialog__btn--ghost app-button'
                onClick={handleClearAll}
              >
                Limpar tudo
              </button>
            ) : null}
            <button
              type='button'
              className='project-dialog__btn app-button'
              onClick={() => handleApply(requestClose)}
            >
              Aplicar
            </button>
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

export const TaskFilterModal = memo(TaskFilterModalComponent);

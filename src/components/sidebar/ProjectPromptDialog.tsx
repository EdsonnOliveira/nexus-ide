import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import {
  PROJECT_PRESET_ICONS,
  PROJECT_PRESET_ICON_LABELS,
  buildProjectPresetIconValue,
  getProjectPresetIconId,
  isProjectPresetIcon,
  resolveCustomProjectIcon,
  type ProjectPresetIconId,
} from '@/constants/projectPresetIcons';
import type { ProjectPromptMode } from '@/types';

interface ProjectPromptDialogProps {
  mode: ProjectPromptMode;
  initialValue: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
  dialogTitle?: string;
  dialogLabel?: string;
}

function ProjectPromptDialogComponent({
  mode,
  initialValue,
  onConfirm,
  onClose,
  dialogTitle,
  dialogLabel,
}: ProjectPromptDialogProps) {
  const [customValue, setCustomValue] = useState(() =>
    isProjectPresetIcon(initialValue) ? '' : initialValue,
  );
  const [selectedPresetId, setSelectedPresetId] = useState<ProjectPresetIconId | null>(() => {
    const presetId = getProjectPresetIconId(initialValue);
    return PROJECT_PRESET_ICONS.some((entry) => entry.id === presetId)
      ? (presetId as ProjectPresetIconId)
      : null;
  });
  const inputRef = useRef<HTMLInputElement>(null);

  const title =
    dialogTitle ??
    (mode === 'rename' ? 'Renomear projeto' : mode === 'workspace' ? 'Nova workspace' : 'Definir ícone');
  const label =
    dialogLabel ??
    (mode === 'rename' ? 'Nome do projeto' : mode === 'workspace' ? 'Nome da workspace' : 'Caractere do ícone');

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handlePresetSelect = useCallback((presetId: ProjectPresetIconId) => {
    setSelectedPresetId(presetId);
    setCustomValue('');
  }, []);

  const handleCustomChange = useCallback((nextValue: string) => {
    setCustomValue(nextValue);
    setSelectedPresetId(null);
  }, []);

  const handleSubmit = useCallback(
    (requestClose: () => void) => (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (mode === 'icon') {
        if (selectedPresetId) {
          onConfirm(buildProjectPresetIconValue(selectedPresetId));
          requestClose();
          return;
        }

        const resolvedIcon = resolveCustomProjectIcon(customValue);

        if (!resolvedIcon) {
          return;
        }

        onConfirm(resolvedIcon);
        requestClose();
        return;
      }

      const trimmed = customValue.trim();

      if (!trimmed) {
        return;
      }

      onConfirm(trimmed);
      requestClose();
    },
    [customValue, mode, onConfirm, selectedPresetId],
  );

  return (
    <AnimatedModal
      onClose={onClose}
      panelClassName={`project-dialog${mode === 'icon' ? ' project-dialog--icon' : ''}`}
    >
      {(requestClose) => (
        <form onSubmit={handleSubmit(requestClose)}>
          <span className='project-dialog__title'>{title}</span>
          <label className='project-dialog__label'>
            {label}
            <input
              ref={inputRef}
              className='project-dialog__input'
              value={customValue}
              maxLength={mode === 'icon' ? 8 : 64}
              onChange={(event) =>
                mode === 'icon'
                  ? handleCustomChange(event.target.value)
                  : setCustomValue(event.target.value)
              }
            />
          </label>
          {mode === 'icon' ? (
            <div className='project-dialog__presets'>
              <span className='project-dialog__presets-label'>Ícones</span>
              <div className='project-dialog__presets-grid'>
                {PROJECT_PRESET_ICONS.map(({ id, Icon }) => (
                  <button
                    key={id}
                    type='button'
                    className={`project-dialog__preset${selectedPresetId === id ? ' project-dialog__preset--active' : ''}`}
                    aria-label={PROJECT_PRESET_ICON_LABELS[id] ?? id}
                    aria-pressed={selectedPresetId === id}
                    onClick={() => handlePresetSelect(id)}
                  >
                    <Icon size={15} strokeWidth={2} aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className='project-dialog__actions'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--ghost'
              onClick={requestClose}
            >
              Cancelar
            </button>
            <button type='submit' className='project-dialog__btn project-dialog__btn--primary'>
              Salvar
            </button>
          </div>
        </form>
      )}
    </AnimatedModal>
  );
}

export const ProjectPromptDialog = memo(ProjectPromptDialogComponent);

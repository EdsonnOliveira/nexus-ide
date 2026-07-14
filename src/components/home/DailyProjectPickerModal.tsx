import { FolderPlus } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { AppCheckbox } from '@/components/overlay/AppCheckbox';
import { EmptyState } from '@/components/overlay/EmptyState';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import type { Project } from '@/types';

interface DailyProjectPickerModalProps {
  projects: Project[];
  selectedProjectIds: Set<string>;
  onClose: () => void;
  onApply: (projectIds: string[]) => void;
}

interface DailyProjectPickerItemProps {
  project: Project;
  checked: boolean;
  onToggle: (projectId: string, checked: boolean) => void;
}

function DailyProjectPickerItemComponent({
  project,
  checked,
  onToggle,
}: DailyProjectPickerItemProps) {
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setLogoSrc(null);
    setLogoFailed(false);

    if (!project.logo || !window.nexus) {
      return;
    }

    void window.nexus.files.readImageAsDataUrl(project.logo).then((dataUrl) => {
      if (cancelled) {
        return;
      }

      if (dataUrl) {
        setLogoSrc(dataUrl);
        return;
      }

      setLogoFailed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [project.logo]);

  const handleToggle = useCallback(
    (nextChecked: boolean) => {
      onToggle(project.id, nextChecked);
    },
    [onToggle, project.id],
  );

  const handleLogoError = useCallback(() => {
    setLogoFailed(true);
    setLogoSrc(null);
  }, []);

  const showLogo = Boolean(logoSrc) && !logoFailed;

  return (
    <label
      className={`home-dashboard__daily-project-picker-item app-button app-button--enter${checked ? ' home-dashboard__daily-project-picker-item--active' : ''}`}
    >
      <AppCheckbox
        checked={checked}
        aria-label={`Selecionar ${project.name}`}
        onChange={handleToggle}
      />
      {showLogo ? (
        <img
          key={project.logo}
          src={logoSrc ?? undefined}
          alt=''
          className='home-dashboard__daily-project-picker-logo'
          onError={handleLogoError}
        />
      ) : (
        <span
          className='home-dashboard__daily-project-picker-icon'
          style={{ backgroundColor: project.color }}
        >
          <ProjectIconMark icon={project.icon} size={12} strokeWidth={2.25} />
        </span>
      )}
      <span className='home-dashboard__daily-project-picker-label'>{project.name}</span>
    </label>
  );
}

const DailyProjectPickerItem = memo(DailyProjectPickerItemComponent);

function DailyProjectPickerModalComponent({
  projects,
  selectedProjectIds,
  onClose,
  onApply,
}: DailyProjectPickerModalProps) {
  const [draftIds, setDraftIds] = useState(() => new Set(selectedProjectIds));

  const allSelected = projects.length > 0 && projects.every((project) => draftIds.has(project.id));

  const sortedProjects = useMemo(
    () => [...projects].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')),
    [projects],
  );

  const handleToggle = useCallback((projectId: string, checked: boolean) => {
    setDraftIds((current) => {
      const next = new Set(current);

      if (checked) {
        next.add(projectId);
      } else {
        next.delete(projectId);
      }

      return next;
    });
  }, []);

  const handleToggleAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setDraftIds(new Set(projects.map((project) => project.id)));
        return;
      }

      setDraftIds(new Set());
    },
    [projects],
  );

  const handleApply = useCallback(
    (requestClose: () => void) => {
      onApply(Array.from(draftIds));
      requestClose();
    },
    [draftIds, onApply],
  );

  return (
    <AnimatedModal onClose={onClose} panelClassName='project-dialog home-dashboard__daily-project-picker'>
      {(requestClose) => (
        <>
          <span className='project-dialog__title'>Selecionar projetos</span>
          <p className='project-dialog__message'>
            Escolha quais projetos aparecem no card Daily do dashboard.
          </p>
          {projects.length === 0 ? (
            <EmptyState icon={FolderPlus} message='Nenhum projeto disponível' compact />
          ) : (
            <div className='home-dashboard__daily-project-picker-list'>
              <label className='home-dashboard__daily-project-picker-select-all'>
                <AppCheckbox
                  checked={allSelected}
                  aria-label={allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
                  onChange={handleToggleAll}
                />
                <span className='home-dashboard__daily-project-picker-select-all-label'>
                  {allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
                </span>
              </label>
              {sortedProjects.map((project) => (
                <DailyProjectPickerItem
                  key={project.id}
                  project={project}
                  checked={draftIds.has(project.id)}
                  onToggle={handleToggle}
                />
              ))}
            </div>
          )}
          <div className='project-dialog__actions'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--ghost app-button'
              onClick={requestClose}
            >
              Cancelar
            </button>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--primary app-button'
              disabled={projects.length === 0}
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

export const DailyProjectPickerModal = memo(DailyProjectPickerModalComponent);

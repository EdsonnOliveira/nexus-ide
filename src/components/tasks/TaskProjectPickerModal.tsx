import { FolderPlus } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { EmptyState } from '@/components/overlay/EmptyState';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import type { Project } from '@/types';

interface TaskProjectPickerModalProps {
  projects: Project[];
  onClose: () => void;
  onSelect: (projectId: string) => void;
}

interface TaskProjectPickerItemProps {
  project: Project;
  onSelect: (projectId: string) => void;
}

function TaskProjectPickerItemComponent({ project, onSelect }: TaskProjectPickerItemProps) {
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

  const handleClick = useCallback(() => {
    onSelect(project.id);
  }, [onSelect, project.id]);

  const handleLogoError = useCallback(() => {
    setLogoFailed(true);
    setLogoSrc(null);
  }, []);

  const showLogo = Boolean(logoSrc) && !logoFailed;

  return (
    <button
      type='button'
      className='task-project-picker-modal__item app-button app-button--enter'
      onClick={handleClick}
    >
      {showLogo ? (
        <img
          key={project.logo}
          src={logoSrc ?? undefined}
          alt=''
          className='task-project-picker-modal__logo'
          onError={handleLogoError}
        />
      ) : (
        <span
          className='task-project-picker-modal__icon'
          style={{ backgroundColor: project.color }}
        >
          <ProjectIconMark icon={project.icon} size={12} strokeWidth={2.25} />
        </span>
      )}
      <span className='task-project-picker-modal__label'>{project.name}</span>
    </button>
  );
}

const TaskProjectPickerItem = memo(TaskProjectPickerItemComponent);

function TaskProjectPickerModalComponent({ projects, onClose, onSelect }: TaskProjectPickerModalProps) {
  return (
    <AnimatedModal onClose={onClose} panelClassName='project-dialog task-project-picker-modal'>
      {(requestClose) => (
        <>
          <span className='project-dialog__title'>Selecionar projeto</span>
          {projects.length === 0 ? (
            <EmptyState icon={FolderPlus} message='Nenhum projeto disponível' compact />
          ) : (
            <div className='task-project-picker-modal__list'>
              {projects.map((project) => (
                <TaskProjectPickerItem
                  key={project.id}
                  project={project}
                  onSelect={(projectId) => {
                    onSelect(projectId);
                    requestClose();
                  }}
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
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

export const TaskProjectPickerModal = memo(TaskProjectPickerModalComponent);

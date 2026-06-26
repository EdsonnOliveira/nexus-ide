import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import type { Project } from '@/types';
import { getProjectPingTone } from '@/utils/projectPingTone';

interface ProjectListItemProps {
  project: Project;
  isActive: boolean;
  isFlagged?: boolean;
  hasNotification?: boolean;
  isAgentRunning?: boolean;
  isAutomationRunning?: boolean;
  enterIndex?: number;
  enterAnimationKey?: number;
  onSelect: (id: string) => void;
  onContextMenu: (project: Project, x: number, y: number) => void;
}

function ProjectListItemComponent({
  project,
  isActive,
  isFlagged = false,
  hasNotification = false,
  isAgentRunning = false,
  isAutomationRunning = false,
  enterIndex = 0,
  enterAnimationKey = 0,
  onSelect,
  onContextMenu,
}: ProjectListItemProps) {
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

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      onContextMenu(project, event.clientX, event.clientY);
    },
    [onContextMenu, project],
  );

  const handleLogoError = useCallback(() => {
    setLogoFailed(true);
    setLogoSrc(null);
  }, []);

  const showLogo = Boolean(logoSrc) && !logoFailed;
  const [isEntering, setIsEntering] = useState(false);

  useEffect(() => {
    if (enterAnimationKey <= 0) {
      setIsEntering(false);
      return;
    }

    setIsEntering(true);

    const delay = enterIndex * 42;
    const duration = 220;
    const timerId = window.setTimeout(() => {
      setIsEntering(false);
    }, delay + duration);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [enterAnimationKey, enterIndex]);

  const pingClassName = useMemo(
    () => `project-item__ping project-item__ping--${getProjectPingTone(project.color)}`,
    [project.color],
  );

  return (
    <button
      type='button'
      className={`project-item${isActive ? ' project-item--active' : ''}${hasNotification ? ' project-item--notified' : ''}${isFlagged ? ' project-item--flagged' : ''}${isEntering ? ' project-item--enter' : ''}`}
      style={isEntering ? { ['--enter-index' as string]: enterIndex } : undefined}
      title={project.name}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {showLogo ? (
        <span className='project-item__icon-wrap'>
          <img
            key={project.logo}
            src={logoSrc ?? undefined}
            alt=''
            className='project-item__logo'
            onError={handleLogoError}
          />
          {hasNotification ? <span className={pingClassName} aria-hidden='true' /> : null}
        </span>
      ) : (
        <span className='project-item__icon-wrap'>
          <span className='project-item__icon' style={{ backgroundColor: project.color }}>
            <ProjectIconMark icon={project.icon} />
          </span>
          {hasNotification ? <span className={pingClassName} aria-hidden='true' /> : null}
        </span>
      )}
      <span className='project-item__name'>{project.name}</span>
      {isAgentRunning || isAutomationRunning ? (
        <span className='project-item__indicators'>
          {isAutomationRunning ? (
            <span className='project-item__automation project-item__automation--loading' aria-label='Automação em execução' />
          ) : null}
          {isAgentRunning ? (
            <span className='project-item__agent project-item__agent--loading' aria-label='Agent em execução' />
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

export const ProjectListItem = memo(ProjectListItemComponent);

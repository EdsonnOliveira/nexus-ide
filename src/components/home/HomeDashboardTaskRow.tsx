import { Play } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import type { HomeDashboardTaskEntry } from '@/hooks/useHomeDashboardData';
import { formatTaskSource } from '@/utils/taskLabels';

interface HomeDashboardTaskRowProps {
  entry: HomeDashboardTaskEntry;
  enterDelayMs?: number;
  onOpen: (entry: HomeDashboardTaskEntry) => void;
  onExecute: (entry: HomeDashboardTaskEntry) => void;
}

function HomeDashboardTaskRowComponent({
  entry,
  enterDelayMs = 0,
  onOpen,
  onExecute,
}: HomeDashboardTaskRowProps) {
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setLogoSrc(null);
    setLogoFailed(false);

    if (!entry.project.logo || !window.nexus) {
      return;
    }

    void window.nexus.files.readImageAsDataUrl(entry.project.logo).then((dataUrl) => {
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
  }, [entry.project.logo]);

  const handleOpen = useCallback(() => {
    onOpen(entry);
  }, [entry, onOpen]);

  const handlePlay = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onExecute(entry);
    },
    [entry, onExecute],
  );

  const sourceLabel = entry.task.source === 'local' ? entry.project.name : formatTaskSource(entry.task.source);
  const showLogo = Boolean(logoSrc) && !logoFailed;

  return (
    <div
      className='home-dashboard__task-row app-button--enter'
      style={{
        animationDelay: `${enterDelayMs}ms`,
        ['--project-accent' as string]: entry.project.color,
        ['--card-accent' as string]: entry.project.color,
      }}
    >
      <button type='button' className='home-dashboard__task-main app-button' onClick={handleOpen}>
        <span className='home-dashboard__task-project-icon' aria-hidden='true'>
          {showLogo ? (
            <img src={logoSrc ?? undefined} alt='' className='home-dashboard__task-project-logo' />
          ) : (
            <span
              className='home-dashboard__task-project-fallback'
              style={{ backgroundColor: entry.project.color }}
            >
              <ProjectIconMark icon={entry.project.icon} />
            </span>
          )}
        </span>
        <span className='home-dashboard__task-copy'>
          <span className='home-dashboard__task-title'>{entry.task.title}</span>
          <span className='home-dashboard__task-meta'>
            <span className='home-dashboard__task-chip'>{sourceLabel}</span>
            {entry.task.externalId ? (
              <span className='home-dashboard__task-chip home-dashboard__task-chip--muted'>
                {entry.task.externalId}
              </span>
            ) : null}
          </span>
        </span>
      </button>
      <button
        type='button'
        className='home-dashboard__task-play app-button app-button--enter'
        aria-label={`Executar ${entry.task.title}`}
        onClick={handlePlay}
      >
        <Play size={16} strokeWidth={2.25} />
      </button>
    </div>
  );
}

export const HomeDashboardTaskRow = memo(HomeDashboardTaskRowComponent);

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, X } from 'lucide-react';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import { aiProviderLabel, cliAgentToAiProvider } from '@/constants/aiProviders';
import { useProjectStore } from '@/stores/useProjectStore';
import type { AgentTab, Project } from '@/types';
import { moveAgentPaneToMaestro } from '@/utils/homeDashboardAgents';
import { formatVercelDeployFinishedAt } from '@/utils/vercelDeployment';

interface SidebarMaestroAgentCardProps {
  project: Project;
  pane: AgentTab;
  notifiedAt: number;
  onDismiss: () => void;
}

function truncatePrompt(value: string, maxLength = 72): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function SidebarMaestroAgentCardComponent({
  project,
  pane,
  notifiedAt,
  onDismiss,
}: SidebarMaestroAgentCardProps) {
  const leaveActiveProject = useProjectStore((state) => state.leaveActiveProject);
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

  const showLogo = Boolean(logoSrc) && !logoFailed;
  const providerLabel = useMemo(
    () => aiProviderLabel(cliAgentToAiProvider(pane.cliAgent)),
    [pane.cliAgent],
  );
  const promptLabel = useMemo(() => {
    const turns = pane.turns ?? [];
    const lastUser = turns[turns.length - 1]?.user.content.trim();
    return lastUser ? truncatePrompt(lastUser) : null;
  }, [pane.turns]);
  const eyebrowLabel = formatVercelDeployFinishedAt(notifiedAt);
  const statusClassName = 'sidebar-vercel-deploy-card__status-dot--ready';
  const statusPingClassName = 'sidebar-vercel-deploy-card__status-dot--ping-ready';

  const handleOpen = useCallback(() => {
    moveAgentPaneToMaestro(project.id, pane.id);
    void leaveActiveProject();
  }, [leaveActiveProject, pane.id, project.id]);

  const handleDismiss = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onDismiss();
    },
    [onDismiss],
  );

  return (
    <section
      className='sidebar-vercel-deploy-card sidebar-vercel-deploy-card--copyable app-button app-button--enter'
      title={`${project.name} · ${pane.title}`}
      onClick={handleOpen}
    >
      <div className='sidebar-vercel-deploy-card__header'>
        <span
          className='sidebar-vercel-deploy-card__project-icon'
          style={showLogo ? undefined : { background: project.color }}
          aria-hidden='true'
        >
          {showLogo && logoSrc ? (
            <img src={logoSrc} alt='' />
          ) : (
            <ProjectIconMark icon={project.icon} size={14} />
          )}
        </span>
        <div className='sidebar-vercel-deploy-card__meta'>
          <span className='sidebar-vercel-deploy-card__eyebrow'>{eyebrowLabel}</span>
          <span className='sidebar-vercel-deploy-card__project' title={project.name}>
            {project.name}
          </span>
        </div>
        <button
          type='button'
          className='sidebar-vercel-deploy-card__close app-button app-button--enter'
          aria-label='Fechar card do agent'
          title='Fechar'
          onClick={handleDismiss}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      <div className='sidebar-vercel-deploy-card__body'>
        <div className='sidebar-vercel-deploy-card__row'>
          <span className='sidebar-vercel-deploy-card__label'>Agent</span>
          <span
            className='sidebar-vercel-deploy-card__value sidebar-vercel-deploy-card__value--with-icon'
            title={pane.title}
          >
            <Bot
              size={11}
              strokeWidth={2}
              className='sidebar-vercel-deploy-card__value-icon'
              aria-hidden='true'
            />
            <span className='sidebar-vercel-deploy-card__value-text'>{pane.title}</span>
          </span>
        </div>
        {promptLabel ? (
          <div className='sidebar-vercel-deploy-card__row'>
            <span className='sidebar-vercel-deploy-card__label'>Pedido</span>
            <span className='sidebar-vercel-deploy-card__value' title={promptLabel}>
              {promptLabel}
            </span>
          </div>
        ) : (
          <div className='sidebar-vercel-deploy-card__row'>
            <span className='sidebar-vercel-deploy-card__label'>Modelo</span>
            <span className='sidebar-vercel-deploy-card__value' title={providerLabel}>
              {providerLabel}
            </span>
          </div>
        )}
        <div className='sidebar-vercel-deploy-card__row sidebar-vercel-deploy-card__row--status'>
          <span className='sidebar-vercel-deploy-card__label'>Status</span>
          <span className='sidebar-vercel-deploy-card__status'>
            <span
              className={`sidebar-vercel-deploy-card__status-dot ${statusClassName} ${statusPingClassName}`}
              aria-hidden='true'
            />
            <span className='sidebar-vercel-deploy-card__status-label'>Pronto</span>
          </span>
        </div>
      </div>
    </section>
  );
}

export const SidebarMaestroAgentCard = memo(SidebarMaestroAgentCardComponent);

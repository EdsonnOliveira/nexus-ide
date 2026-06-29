import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch, GitCommit, X } from 'lucide-react';
import { SidebarVercelIcon } from '@/components/sidebar/SidebarVercelIcon';
import { SidebarVercelDeploysPopup } from '@/components/sidebar/SidebarVercelDeploysPopup';
import { useVercelDeploymentLogsCopy } from '@/hooks/useVercelDeploymentLogsCopy';
import type { VercelActiveDeployment, VercelDeploymentState } from '@/types';
import {
  getVercelDeploySoundKind,
  playVercelDeployNotificationSound,
} from '@/utils/vercelDeployNotificationSound';
import {
  formatVercelCommitSha,
  formatVercelDeployElapsed,
  formatVercelDeployFinishedAt,
  getVercelDeploymentStatusClassName,
  getVercelDeploymentStatusLabel,
  getVercelDeploymentStatusPingClassName,
  isVercelFailedDeployment,
} from '@/utils/vercelDeployment';

const DEPLOY_SOUND_INTERVAL_MS = 5_000;

interface SidebarVercelDeployCardProps {
  deployment: VercelActiveDeployment;
  onDismiss: () => void;
}

function SidebarVercelDeployCardComponent({ deployment, onDismiss }: SidebarVercelDeployCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const [deploysPopupOpen, setDeploysPopupOpen] = useState(false);
  const [deploysPopupAnchor, setDeploysPopupAnchor] = useState<DOMRect | null>(null);
  const previousStateRef = useRef<VercelDeploymentState | null>(null);
  const soundKind = useMemo(() => getVercelDeploySoundKind(deployment.state), [deployment.state]);
  const statusPingClassName = useMemo(
    () => getVercelDeploymentStatusPingClassName(deployment.state),
    [deployment.state],
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      playVercelDeployNotificationSound(soundKind);
    }, DEPLOY_SOUND_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [deployment.uid, soundKind]);

  useEffect(() => {
    previousStateRef.current = null;
  }, [deployment.uid]);

  useEffect(() => {
    if (previousStateRef.current !== null && previousStateRef.current !== deployment.state) {
      playVercelDeployNotificationSound(soundKind);
    }

    previousStateRef.current = deployment.state;
  }, [deployment.state, soundKind]);

  useEffect(() => {
    if (deployment.state !== 'BUILDING') {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [deployment.state]);

  const commitLabel = useMemo(() => {
    const sha = formatVercelCommitSha(deployment.commitSha);
    const message = deployment.commitMessage.trim();

    if (message) {
      return `${sha} · ${message}`;
    }

    return sha;
  }, [deployment.commitMessage, deployment.commitSha]);

  const statusLabel = getVercelDeploymentStatusLabel(deployment.state);
  const statusClassName = getVercelDeploymentStatusClassName(deployment.state);
  const canCopyLogs = isVercelFailedDeployment(deployment.state);
  const { copyLogs, loading: logsLoading, copied: logsCopied } = useVercelDeploymentLogsCopy(
    deployment.uid,
  );
  const statusDisplayLabel = logsCopied ? 'Copiado' : logsLoading ? 'Copiando...' : statusLabel;
  const eyebrowLabel = useMemo(() => {
    if (deployment.state === 'BUILDING') {
      const startedAt = deployment.buildingAt ?? deployment.createdAt;
      return formatVercelDeployElapsed(startedAt, now);
    }

    const finishedAt = deployment.readyAt ?? deployment.createdAt;
    return formatVercelDeployFinishedAt(finishedAt, now);
  }, [
    deployment.buildingAt,
    deployment.createdAt,
    deployment.readyAt,
    deployment.state,
    now,
  ]);

  const handleOpenCommit = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();

      if (!deployment.commitUrl || !window.nexus?.tasks) {
        return;
      }

      void window.nexus.tasks.openExternalUrl(deployment.commitUrl);
    },
    [deployment.commitUrl],
  );

  const handleOpenDeploysPopup = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setDeploysPopupAnchor(rect);
    setDeploysPopupOpen(true);
  }, []);

  const handleCloseDeploysPopup = useCallback(() => {
    setDeploysPopupOpen(false);
    setDeploysPopupAnchor(null);
  }, []);

  const handleDismiss = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onDismiss();
    },
    [onDismiss],
  );

  const cardClassName = `sidebar-vercel-deploy-card app-button--enter${canCopyLogs ? ` sidebar-vercel-deploy-card--copyable app-button${logsCopied ? ' sidebar-vercel-deploy-card--copied app-button--enter' : ''}` : ''}`;
  const cardTitle = canCopyLogs
    ? 'Copiar logs do deploy'
    : `${deployment.projectName} · ${statusLabel}`;

  return (
    <>
      <section
        className={cardClassName}
        title={cardTitle}
        onClick={canCopyLogs ? copyLogs : undefined}
      >
      <div className='sidebar-vercel-deploy-card__header'>
        <span className='sidebar-vercel-deploy-card__project-icon' aria-hidden='true'>
          <SidebarVercelIcon size={14} />
        </span>
        <div className='sidebar-vercel-deploy-card__meta'>
          <span className='sidebar-vercel-deploy-card__eyebrow'>{eyebrowLabel}</span>
          <button
            type='button'
            className='sidebar-vercel-deploy-card__project sidebar-vercel-deploy-card__project-link sidebar-vercel-deploy-card__inline-link app-button'
            title={deployment.projectName}
            onClick={handleOpenDeploysPopup}
          >
            {deployment.projectName}
          </button>
        </div>
        <button
          type='button'
          className='sidebar-vercel-deploy-card__close app-button app-button--enter'
          aria-label='Fechar card de deploy'
          title='Fechar'
          onClick={handleDismiss}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      <div className='sidebar-vercel-deploy-card__body'>
        <div className='sidebar-vercel-deploy-card__row'>
          <span className='sidebar-vercel-deploy-card__label'>Branch</span>
          <span className='sidebar-vercel-deploy-card__value sidebar-vercel-deploy-card__value--with-icon' title={deployment.branch}>
            <GitBranch size={11} strokeWidth={2} className='sidebar-vercel-deploy-card__value-icon' aria-hidden='true' />
            <span className='sidebar-vercel-deploy-card__value-text'>{deployment.branch}</span>
          </span>
        </div>
        <div className='sidebar-vercel-deploy-card__row'>
          <span className='sidebar-vercel-deploy-card__label'>Commit</span>
          {deployment.commitUrl ? (
            <button
              type='button'
              className='sidebar-vercel-deploy-card__value sidebar-vercel-deploy-card__value--with-icon sidebar-vercel-deploy-card__inline-link app-button'
              title={commitLabel}
              onClick={handleOpenCommit}
            >
              <GitCommit size={11} strokeWidth={2} className='sidebar-vercel-deploy-card__value-icon' aria-hidden='true' />
              <span className='sidebar-vercel-deploy-card__value-text'>{commitLabel}</span>
            </button>
          ) : (
            <span className='sidebar-vercel-deploy-card__value sidebar-vercel-deploy-card__value--with-icon' title={commitLabel}>
              <GitCommit size={11} strokeWidth={2} className='sidebar-vercel-deploy-card__value-icon' aria-hidden='true' />
              <span className='sidebar-vercel-deploy-card__value-text'>{commitLabel}</span>
            </span>
          )}
        </div>
        <div className='sidebar-vercel-deploy-card__row sidebar-vercel-deploy-card__row--status'>
          <span className='sidebar-vercel-deploy-card__label'>Status</span>
          <span className='sidebar-vercel-deploy-card__status'>
            <span
              className={`sidebar-vercel-deploy-card__status-dot ${statusClassName} ${statusPingClassName}`}
              aria-hidden='true'
            />
            <span className='sidebar-vercel-deploy-card__status-label'>
              {canCopyLogs ? statusDisplayLabel : statusLabel}
            </span>
          </span>
        </div>
      </div>
      </section>

      {deploysPopupOpen && deploysPopupAnchor ? (
        <SidebarVercelDeploysPopup anchorRect={deploysPopupAnchor} onClose={handleCloseDeploysPopup} />
      ) : null}
    </>
  );
}

export const SidebarVercelDeployCard = memo(SidebarVercelDeployCardComponent);

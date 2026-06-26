import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { GitBranch, GitCommit, Rocket } from 'lucide-react';
import { SidebarVercelIcon } from '@/components/sidebar/SidebarVercelIcon';
import { EmptyState } from '@/components/overlay/EmptyState';
import {
  positionDropdownAboveAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import { useVercelDeploymentLogsCopy } from '@/hooks/useVercelDeploymentLogsCopy';
import type { VercelActiveDeployment } from '@/types';
import {
  formatVercelCommitSha,
  formatVercelDeployElapsed,
  formatVercelDeployFinishedAt,
  getVercelDeploymentPreviewUrl,
  getVercelDeploymentStatusClassName,
  getVercelDeploymentStatusLabel,
  getVercelProjectColor,
  getVercelProjectInitial,
  isVercelFailedDeployment,
} from '@/utils/vercelDeployment';

interface SidebarVercelDeploysPopupProps {
  anchorRect: DOMRect;
  onClose: () => void;
}

function DeployListSkeleton() {
  return (
    <div className='sidebar-vercel-deploys-popup__skeleton' aria-hidden='true'>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className='sidebar-vercel-deploys-popup__skeleton-row' />
      ))}
    </div>
  );
}

interface SidebarVercelDeployListItemProps {
  deployment: VercelActiveDeployment;
  now: number;
  onOpen: (deployment: VercelActiveDeployment) => void;
}

function SidebarVercelDeployListItem({ deployment, now, onOpen }: SidebarVercelDeployListItemProps) {
  const canCopyLogs = isVercelFailedDeployment(deployment.state);
  const { copyLogs, loading: logsLoading, copied: logsCopied } = useVercelDeploymentLogsCopy(
    deployment.uid,
  );

  const commitSha = formatVercelCommitSha(deployment.commitSha);
  const commitMessage = deployment.commitMessage.trim();
  const commitLabel = commitMessage ? `${commitSha} · ${commitMessage}` : commitSha;
  const statusLabel = getVercelDeploymentStatusLabel(deployment.state);
  const statusClassName = getVercelDeploymentStatusClassName(deployment.state);
  const statusDisplayLabel = logsCopied ? 'Copiado' : logsLoading ? 'Copiando...' : statusLabel;
  const timeLabel =
    deployment.state === 'BUILDING'
      ? formatVercelDeployElapsed(deployment.buildingAt ?? deployment.createdAt, now)
      : formatVercelDeployFinishedAt(deployment.readyAt ?? deployment.createdAt, now);
  const canOpen = Boolean(getVercelDeploymentPreviewUrl(deployment.url) || deployment.commitUrl);
  const itemClassName = `sidebar-vercel-deploys-popup__item app-button app-button--enter${canCopyLogs && logsCopied ? ' sidebar-vercel-deploys-popup__item--copied app-button--enter' : ''}`;

  const projectInitial = getVercelProjectInitial(deployment.projectName);
  const projectColor = getVercelProjectColor(deployment.projectId, deployment.projectName);

  const projectIcon = (
    <span
      className='sidebar-vercel-deploys-popup__project-icon'
      style={{ backgroundColor: projectColor }}
      aria-hidden='true'
    >
      {projectInitial}
    </span>
  );

  const statusContent = (
    <>
      <span
        className={`sidebar-vercel-deploy-card__status-dot ${statusClassName}`}
        aria-hidden='true'
      />
      <span className='sidebar-vercel-deploys-popup__status-label'>
        {canCopyLogs ? statusDisplayLabel : statusLabel}
      </span>
    </>
  );

  const itemContent = (
    <>
      {projectIcon}
      <span className='sidebar-vercel-deploys-popup__item-content'>
        <span className='sidebar-vercel-deploys-popup__item-top'>
          <span className='sidebar-vercel-deploys-popup__project' title={deployment.projectName}>
            {deployment.projectName}
          </span>
          <span className='sidebar-vercel-deploys-popup__time'>{timeLabel}</span>
        </span>
        <span className='sidebar-vercel-deploys-popup__item-bottom'>
          <span className='sidebar-vercel-deploys-popup__meta' title={`${deployment.branch} · ${commitLabel}`}>
            <span className='sidebar-vercel-deploys-popup__meta-segment'>
              <GitBranch
                size={11}
                strokeWidth={2}
                className='sidebar-vercel-deploys-popup__meta-icon'
                aria-hidden='true'
              />
              <span className='sidebar-vercel-deploys-popup__meta-text'>{deployment.branch}</span>
            </span>
            <span className='sidebar-vercel-deploys-popup__meta-separator' aria-hidden='true'>
              ·
            </span>
            <span className='sidebar-vercel-deploys-popup__meta-segment'>
              <GitCommit
                size={11}
                strokeWidth={2}
                className='sidebar-vercel-deploys-popup__meta-icon'
                aria-hidden='true'
              />
              <span className='sidebar-vercel-deploys-popup__meta-text'>{commitLabel}</span>
            </span>
          </span>
          <span className='sidebar-vercel-deploys-popup__status'>{statusContent}</span>
        </span>
      </span>
    </>
  );

  const handleItemClick = useCallback(() => {
    if (canCopyLogs) {
      void copyLogs();
      return;
    }

    onOpen(deployment);
  }, [canCopyLogs, copyLogs, deployment, onOpen]);

  return (
    <li>
      <button
        type='button'
        className={itemClassName}
        disabled={canCopyLogs ? logsLoading : !canOpen}
        title={canCopyLogs ? 'Copiar logs do deploy' : undefined}
        onClick={handleItemClick}
      >
        {itemContent}
      </button>
    </li>
  );
}

const SidebarVercelDeployListItemMemo = memo(SidebarVercelDeployListItem);

function SidebarVercelDeploysPopupComponent({ anchorRect, onClose }: SidebarVercelDeploysPopupProps) {
  const [deployments, setDeployments] = useState<VercelActiveDeployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAboveAnchor(menu, anchorRect, 'start'),
    [anchorRect],
    'modal',
  );

  useEffect(() => {
    let cancelled = false;

    const loadDeployments = async () => {
      if (!window.nexus?.vercel) {
        if (!cancelled) {
          setLoading(false);
          setError('Integração Vercel indisponível');
        }

        return;
      }

      try {
        const items = await window.nexus.vercel.listDeployments();

        if (!cancelled) {
          setDeployments(items);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setDeployments([]);
          setError('Não foi possível carregar deploys na Vercel');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadDeployments();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (menuRef.current?.contains(target)) {
        return;
      }

      requestClose();
    };

    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [menuRef, requestClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [requestClose]);

  const handleOpenDeployment = useCallback((deployment: VercelActiveDeployment) => {
    if (!window.nexus?.tasks) {
      return;
    }

    const previewUrl = getVercelDeploymentPreviewUrl(deployment.url);

    if (previewUrl) {
      void window.nexus.tasks.openExternalUrl(previewUrl);
      return;
    }

    if (deployment.commitUrl) {
      void window.nexus.tasks.openExternalUrl(deployment.commitUrl);
    }
  }, []);

  const listContent = useMemo(() => {
    if (loading) {
      return <DeployListSkeleton />;
    }

    if (error) {
      return <span className='sidebar-vercel-deploys-popup__error'>{error}</span>;
    }

    if (deployments.length === 0) {
      return (
        <EmptyState icon={Rocket} message='Nenhum deploy encontrado' compact className='sidebar-vercel-deploys-popup__empty' />
      );
    }

    return (
      <ul className='sidebar-vercel-deploys-popup__list'>
        {deployments.map((deployment) => (
          <SidebarVercelDeployListItemMemo
            key={deployment.uid}
            deployment={deployment}
            now={now}
            onOpen={handleOpenDeployment}
          />
        ))}
      </ul>
    );
  }, [deployments, error, handleOpenDeployment, loading, now]);

  return createPortal(
    <div
      ref={menuRef}
      className={`overlay-popup sidebar-vercel-deploys-popup overlay-popup--anchor-start ${animationClass}`}
    >
      <div className='sidebar-vercel-deploys-popup__header'>
        <span className='sidebar-vercel-deploys-popup__badge' aria-hidden='true'>
          <SidebarVercelIcon size={14} />
        </span>
        <div className='sidebar-vercel-deploys-popup__intro'>
          <span className='sidebar-vercel-deploys-popup__title'>Deploys Vercel</span>
          <span className='sidebar-vercel-deploys-popup__subtitle'>Últimos deploys da sua conta</span>
        </div>
      </div>
      <div className='sidebar-vercel-deploys-popup__list-wrap'>{listContent}</div>
    </div>,
    document.body,
  );
}

export const SidebarVercelDeploysPopup = memo(SidebarVercelDeploysPopupComponent);

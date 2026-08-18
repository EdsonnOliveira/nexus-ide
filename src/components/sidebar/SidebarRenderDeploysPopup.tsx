import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { GitBranch, GitCommit, Rocket, Settings2 } from 'lucide-react';
import { SidebarRenderIcon } from '@/components/sidebar/SidebarRenderIcon';
import { EmptyState } from '@/components/overlay/EmptyState';
import {
  positionDropdownAboveAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import { useRenderDeploymentLogsCopy } from '@/hooks/useRenderDeploymentLogsCopy';
import type { RenderActiveDeployment } from '@/types';
import {
  formatRenderCommitSha,
  formatRenderDeployElapsed,
  formatRenderDeployFinishedAt,
  getRenderDeploymentOpenUrl,
  getRenderDeploymentStatusClassName,
  getRenderDeploymentStatusLabel,
  getRenderProjectColor,
  getRenderProjectInitial,
  isRenderFailedDeployment,
  isRenderInProgressDeployment,
} from '@/utils/renderDeployment';

interface SidebarRenderDeploysPopupProps {
  anchorRect: DOMRect;
  onClose: () => void;
  onConfigure?: () => void;
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

interface SidebarRenderDeployListItemProps {
  deployment: RenderActiveDeployment;
  now: number;
  onOpen: (deployment: RenderActiveDeployment) => void;
}

function SidebarRenderDeployListItem({
  deployment,
  now,
  onOpen,
}: SidebarRenderDeployListItemProps) {
  const logsQuery = useMemo(
    () => ({
      credentialId: deployment.credentialId,
      ownerId: deployment.ownerId,
      serviceId: deployment.projectId,
      createdAt: deployment.createdAt,
      readyAt: deployment.readyAt,
    }),
    [
      deployment.createdAt,
      deployment.credentialId,
      deployment.ownerId,
      deployment.projectId,
      deployment.readyAt,
    ],
  );
  const canCopyLogs = isRenderFailedDeployment(deployment.state);
  const { copyLogs, loading: logsLoading, copied: logsCopied } = useRenderDeploymentLogsCopy(
    logsQuery,
  );

  const commitSha = formatRenderCommitSha(deployment.commitSha);
  const commitMessage = deployment.commitMessage.trim();
  const commitLabel = commitMessage ? `${commitSha} · ${commitMessage}` : commitSha;
  const statusLabel = getRenderDeploymentStatusLabel(deployment.state);
  const statusClassName = getRenderDeploymentStatusClassName(deployment.state);
  const statusDisplayLabel = logsCopied ? 'Copiado' : logsLoading ? 'Copiando...' : statusLabel;
  const timeLabel = isRenderInProgressDeployment(deployment.state)
    ? formatRenderDeployElapsed(deployment.buildingAt ?? deployment.createdAt, now)
    : formatRenderDeployFinishedAt(deployment.readyAt ?? deployment.createdAt, now);
  const canOpen = Boolean(
    getRenderDeploymentOpenUrl(deployment.url, deployment.dashboardUrl) || deployment.commitUrl,
  );
  const itemClassName = `sidebar-vercel-deploys-popup__item app-button app-button--enter${canCopyLogs && logsCopied ? ' sidebar-vercel-deploys-popup__item--copied app-button--enter' : ''}`;

  const projectInitial = getRenderProjectInitial(deployment.projectName);
  const projectColor = getRenderProjectColor(deployment.projectId, deployment.projectName);

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
          <span
            className='sidebar-vercel-deploys-popup__meta'
            title={`${deployment.accountLabel} · ${deployment.branch} · ${commitLabel}`}
          >
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

const SidebarRenderDeployListItemMemo = memo(SidebarRenderDeployListItem);

function SidebarRenderDeploysPopupComponent({
  anchorRect,
  onClose,
  onConfigure,
}: SidebarRenderDeploysPopupProps) {
  const [deployments, setDeployments] = useState<RenderActiveDeployment[]>([]);
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
      if (!window.nexus?.render) {
        if (!cancelled) {
          setLoading(false);
          setError('Integração Render indisponível');
        }

        return;
      }

      try {
        const items = await window.nexus.render.listDeployments();

        if (!cancelled) {
          setDeployments(items);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setDeployments([]);
          setError('Não foi possível carregar deploys na Render');
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
      window.addEventListener('mousedown', handlePointerDown, true);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown, true);
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

  const handleOpenDeployment = useCallback((deployment: RenderActiveDeployment) => {
    if (!window.nexus?.tasks) {
      return;
    }

    const openUrl = getRenderDeploymentOpenUrl(deployment.url, deployment.dashboardUrl);

    if (openUrl) {
      void window.nexus.tasks.openExternalUrl(openUrl);
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
        <EmptyState
          icon={Rocket}
          message='Nenhum deploy encontrado'
          compact
          className='sidebar-vercel-deploys-popup__empty'
        />
      );
    }

    return (
      <ul className='sidebar-vercel-deploys-popup__list'>
        {deployments.map((deployment) => (
          <SidebarRenderDeployListItemMemo
            key={`${deployment.credentialId}:${deployment.uid}`}
            deployment={deployment}
            now={now}
            onOpen={handleOpenDeployment}
          />
        ))}
      </ul>
    );
  }, [deployments, error, handleOpenDeployment, loading, now]);

  return createPortal(
    <>
      <div
        className='overlay-popup-scrim'
        onMouseDown={(event) => {
          event.preventDefault();
          requestClose();
        }}
      />
      <div
        ref={menuRef}
        className={`overlay-popup sidebar-vercel-deploys-popup overlay-popup--anchor-start ${animationClass}`}
      >
      <div className='sidebar-vercel-deploys-popup__header'>
        <span className='sidebar-vercel-deploys-popup__badge' aria-hidden='true'>
          <SidebarRenderIcon size={14} />
        </span>
        <div className='sidebar-vercel-deploys-popup__intro'>
          <span className='sidebar-vercel-deploys-popup__title'>Deploys Render</span>
          <span className='sidebar-vercel-deploys-popup__subtitle'>Últimos deploys das suas contas</span>
        </div>
        {onConfigure ? (
          <button
            type='button'
            className='sidebar-vercel-deploys-popup__settings app-button app-button--enter'
            aria-label='Configurar API keys da Render'
            title='Configurar API keys'
            onClick={onConfigure}
          >
            <Settings2 size={14} strokeWidth={2} />
          </button>
        ) : null}
      </div>
      <div className='sidebar-vercel-deploys-popup__list-wrap'>{listContent}</div>
    </div>
    </>,
    document.body,
  );
}

export const SidebarRenderDeploysPopup = memo(SidebarRenderDeploysPopupComponent);

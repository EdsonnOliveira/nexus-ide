import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GitBranch, GitCommit, Rocket } from 'lucide-react';
import { WebVercelIcon } from './WebVercelIcon';
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
} from './vercelDeployment';
import type { VercelActiveDeployment } from './vercelTypes';

interface WebVercelDeploysPopupProps {
  anchorRect: DOMRect;
  deployments: VercelActiveDeployment[];
  onClose: () => void;
}

interface WebVercelDeployListItemProps {
  deployment: VercelActiveDeployment;
  now: number;
}

function WebVercelDeployListItem({ deployment, now }: WebVercelDeployListItemProps) {
  const canCopyLogs = isVercelFailedDeployment(deployment.state);
  const commitSha = formatVercelCommitSha(deployment.commitSha);
  const commitMessage = deployment.commitMessage.trim();
  const commitLabel = commitMessage ? `${commitSha} · ${commitMessage}` : commitSha;
  const statusLabel = getVercelDeploymentStatusLabel(deployment.state);
  const statusClassName = getVercelDeploymentStatusClassName(deployment.state);
  const timeLabel =
    deployment.state === 'BUILDING'
      ? formatVercelDeployElapsed(deployment.buildingAt ?? deployment.createdAt, now)
      : formatVercelDeployFinishedAt(deployment.readyAt ?? deployment.createdAt, now);
  const previewUrl = getVercelDeploymentPreviewUrl(deployment.url);
  const canOpen = Boolean(previewUrl || deployment.commitUrl);
  const projectInitial = getVercelProjectInitial(deployment.projectName);
  const projectColor = getVercelProjectColor(deployment.projectId, deployment.projectName);

  const handleOpen = () => {
    const url = previewUrl || deployment.commitUrl;
    if (!url) {
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <li>
      <button
        type='button'
        className='sidebar-vercel-deploys-popup__item app-button app-button--enter'
        disabled={!canOpen && !canCopyLogs}
        onClick={handleOpen}
      >
        <span
          className='sidebar-vercel-deploys-popup__project-icon'
          style={{ backgroundColor: projectColor }}
          aria-hidden='true'
        >
          {projectInitial}
        </span>
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
              title={`${deployment.branch} · ${commitLabel}`}
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
              <span className='sidebar-vercel-deploys-popup__meta-separator'>·</span>
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
            <span className='sidebar-vercel-deploys-popup__status'>
              <span
                className={`sidebar-vercel-deploy-card__status-dot ${statusClassName}`}
                aria-hidden='true'
              />
              <span className='sidebar-vercel-deploys-popup__status-label'>{statusLabel}</span>
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

function WebVercelDeploysPopupComponent({
  anchorRect,
  deployments,
  onClose,
}: WebVercelDeploysPopupProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const [animationClass, setAnimationClass] = useState('overlay-popup--in');

  const sortedDeployments = useMemo(
    () => [...deployments].sort((left, right) => right.createdAt - left.createdAt),
    [deployments],
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }
    const gap = 8;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    let left = anchorRect.left;
    let top = anchorRect.bottom + gap;
    if (left + width > window.innerWidth - gap) {
      left = Math.max(gap, window.innerWidth - width - gap);
    }
    if (top + height > window.innerHeight - gap) {
      top = Math.max(gap, anchorRect.top - height - gap);
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }, [anchorRect, sortedDeployments.length]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      setAnimationClass('overlay-popup--out');
      window.setTimeout(onClose, 160);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setAnimationClass('overlay-popup--out');
        window.setTimeout(onClose, 160);
      }
    };
    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown);
    }, 0);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className={`sidebar-vercel-deploys-popup context-menu overlay-popup ${animationClass}`}
      role='dialog'
      aria-label='Deploys Vercel'
    >
      <div className='sidebar-vercel-deploys-popup__header'>
        <span className='sidebar-vercel-deploys-popup__badge' aria-hidden='true'>
          <WebVercelIcon size={14} />
        </span>
        <div className='sidebar-vercel-deploys-popup__intro'>
          <strong className='sidebar-vercel-deploys-popup__title'>Deploys</strong>
          <span className='sidebar-vercel-deploys-popup__subtitle'>
            Últimos deploys sincronizados da Vercel
          </span>
        </div>
      </div>
      <div className='sidebar-vercel-deploys-popup__list-wrap'>
        {sortedDeployments.length === 0 ? (
          <div className='web-vercel-empty'>
            <Rocket size={22} aria-hidden='true' />
            <span>Nenhum deploy recente</span>
          </div>
        ) : (
          <ul className='sidebar-vercel-deploys-popup__list'>
            {sortedDeployments.map((deployment) => (
              <WebVercelDeployListItem key={deployment.uid} deployment={deployment} now={now} />
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}

export const WebVercelDeploysPopup = memo(WebVercelDeploysPopupComponent);

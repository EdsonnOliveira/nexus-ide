import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Smartphone } from 'lucide-react';
import { SidebarMobileReleasePlatformIcon } from '@/components/sidebar/SidebarMobileReleasePlatformIcon';
import { EmptyState } from '@/components/overlay/EmptyState';
import {
  positionDropdownAboveAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import { useMobileReleaseLogsCopy } from '@/hooks/useMobileReleaseLogsCopy';
import { useMobileReleaseStore } from '@/stores/useMobileReleaseStore';
import type { MobileActiveRelease, MobileReleaseKind } from '@/types';
import {
  formatMobileReleaseElapsed,
  formatMobileReleaseFinishedAt,
  formatMobileReleaseVersion,
  getMobileReleaseKindLabel,
  getMobileReleaseStatusClassName,
  getMobileReleaseStatusLabel,
  isMobileReleaseFailed,
} from '@/utils/mobileRelease';
import {
  getVercelProjectColor,
  getVercelProjectInitial,
} from '@/utils/vercelDeployment';

interface SidebarMobileReleasesPopupProps {
  anchorRect: DOMRect;
  projectId: string;
  onClose: () => void;
}

interface SidebarMobileReleaseListItemProps {
  release: MobileActiveRelease;
  now: number;
  onOpen: (release: MobileActiveRelease) => void;
}

function SidebarMobileReleaseListItem({ release, now, onOpen }: SidebarMobileReleaseListItemProps) {
  const canCopyLogs = isMobileReleaseFailed(release.state);
  const { copyLogs, loading: logsLoading, copied: logsCopied } = useMobileReleaseLogsCopy(release.uid);
  const kindLabel = getMobileReleaseKindLabel(release.kind);
  const versionLabel = formatMobileReleaseVersion(release.version, release.versionCode);
  const statusLabel = getMobileReleaseStatusLabel(release.state);
  const statusClassName = getMobileReleaseStatusClassName(release.state);
  const statusDisplayLabel = logsCopied ? 'Copiado' : logsLoading ? 'Copiando...' : statusLabel;
  const timeLabel =
    release.state === 'BUILDING'
      ? formatMobileReleaseElapsed(release.buildingAt, now)
      : formatMobileReleaseFinishedAt(release.readyAt ?? release.createdAt, now);
  const canOpen = release.state === 'READY' && Boolean(release.artifactPath?.includes('/'));
  const itemClassName = `sidebar-mobile-releases-popup__item app-button app-button--enter${canCopyLogs && logsCopied ? ' sidebar-mobile-releases-popup__item--copied app-button--enter' : ''}`;
  const projectInitial = getVercelProjectInitial(release.projectName);
  const projectColor = getVercelProjectColor(release.projectId, release.projectName);

  const handleItemClick = useCallback(() => {
    if (canCopyLogs) {
      void copyLogs();
      return;
    }

    onOpen(release);
  }, [canCopyLogs, copyLogs, onOpen, release]);

  return (
    <li>
      <button
        type='button'
        className={itemClassName}
        disabled={canCopyLogs ? logsLoading : !canOpen}
        title={canCopyLogs ? 'Copiar logs do release' : undefined}
        onClick={handleItemClick}
      >
        <span
          className='sidebar-mobile-releases-popup__project-icon'
          style={{ backgroundColor: projectColor }}
          aria-hidden='true'
        >
          {projectInitial}
        </span>
        <span className='sidebar-mobile-releases-popup__item-content'>
          <span className='sidebar-mobile-releases-popup__item-top'>
            <span className='sidebar-mobile-releases-popup__project' title={release.projectName}>
              {release.projectName}
            </span>
            <span className='sidebar-mobile-releases-popup__time'>{timeLabel}</span>
          </span>
          <span className='sidebar-mobile-releases-popup__item-bottom'>
            <span className='sidebar-mobile-releases-popup__meta' title={`${kindLabel} · ${versionLabel}`}>
              <span className='sidebar-mobile-releases-popup__meta-segment sidebar-mobile-releases-popup__meta-segment--platform'>
                <SidebarMobileReleasePlatformIcon kind={release.kind} size={11} />
                <span className='sidebar-mobile-releases-popup__meta-text'>{kindLabel}</span>
              </span>
              <span className='sidebar-mobile-releases-popup__meta-separator' aria-hidden='true'>
                ·
              </span>
              <span className='sidebar-mobile-releases-popup__meta-segment'>
                <span className='sidebar-mobile-releases-popup__meta-text'>{versionLabel}</span>
              </span>
            </span>
            <span className='sidebar-mobile-releases-popup__status'>
              <span
                className={`sidebar-vercel-deploy-card__status-dot ${statusClassName}`}
                aria-hidden='true'
              />
              <span className='sidebar-mobile-releases-popup__status-label'>
                {canCopyLogs ? statusDisplayLabel : statusLabel}
              </span>
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

const SidebarMobileReleaseListItemMemo = memo(SidebarMobileReleaseListItem);

function SidebarMobileReleasesPopupComponent({
  anchorRect,
  projectId,
  onClose,
}: SidebarMobileReleasesPopupProps) {
  const [now, setNow] = useState(() => Date.now());
  const getProjectHistory = useMobileReleaseStore((state) => state.getProjectHistory);
  const releases = useMobileReleaseStore((state) => state.releases);
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownAboveAnchor(menu, anchorRect, 'start'),
    [anchorRect],
    'modal',
  );

  const history = useMemo(() => {
    const stored = getProjectHistory(projectId);
    const active = Object.values(releases).filter((entry) => entry.projectId === projectId);
    const merged = new Map<string, MobileActiveRelease>();

    for (const entry of [...active, ...stored]) {
      merged.set(entry.uid, entry);
    }

    return [...merged.values()].sort((left, right) => right.createdAt - left.createdAt);
  }, [getProjectHistory, projectId, releases]);

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

  const handleOpenRelease = useCallback((release: MobileActiveRelease) => {
    if (!release.artifactPath || !window.nexus?.files) {
      return;
    }

    void window.nexus.files.revealInFolder(release.artifactPath);
  }, []);

  const listContent = useMemo(() => {
    if (history.length === 0) {
      return (
        <EmptyState
          icon={Smartphone}
          message='Nenhum release encontrado'
          compact
          className='sidebar-mobile-releases-popup__empty'
        />
      );
    }

    return (
      <ul className='sidebar-mobile-releases-popup__list'>
        {history.map((release) => (
          <SidebarMobileReleaseListItemMemo
            key={release.uid}
            release={release}
            now={now}
            onOpen={handleOpenRelease}
          />
        ))}
      </ul>
    );
  }, [handleOpenRelease, history, now]);

  return createPortal(
    <div
      ref={menuRef}
      className={`overlay-popup sidebar-mobile-releases-popup overlay-popup--anchor-start ${animationClass}`}
    >
      <div className='sidebar-mobile-releases-popup__header'>
        <span className='sidebar-mobile-releases-popup__badge' aria-hidden='true'>
          <SidebarMobileReleasePlatformIcon kind='android-aab' size={14} />
        </span>
        <div className='sidebar-mobile-releases-popup__intro'>
          <span className='sidebar-mobile-releases-popup__title'>Releases mobile</span>
          <span className='sidebar-mobile-releases-popup__subtitle'>Histórico de builds do projeto</span>
        </div>
      </div>
      <div className='sidebar-mobile-releases-popup__list-wrap'>{listContent}</div>
    </div>,
    document.body,
  );
}

export const SidebarMobileReleasesPopup = memo(SidebarMobileReleasesPopupComponent);

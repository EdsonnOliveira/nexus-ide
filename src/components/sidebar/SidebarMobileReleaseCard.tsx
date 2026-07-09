import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { SidebarMobileReleasesPopup } from '@/components/sidebar/SidebarMobileReleasesPopup';
import { SidebarMobileReleasePlatformIcon } from '@/components/sidebar/SidebarMobileReleasePlatformIcon';
import { useMobileReleaseLogsCopy } from '@/hooks/useMobileReleaseLogsCopy';
import type { MobileActiveRelease, MobileReleaseState } from '@/types';
import {
  formatMobileReleaseElapsed,
  formatMobileReleaseFinishedAt,
  formatMobileReleaseVersion,
  getMobileReleaseKindLabel,
  getMobileReleaseStatusClassName,
  getMobileReleaseStatusLabel,
  getMobileReleaseStatusPingClassName,
  isMobileReleaseFailed,
} from '@/utils/mobileRelease';
import { finalizeMobileReleasesForPane, refreshMobileReleaseVersion } from '@/utils/mobileReleaseTracker';
import {
  playVercelDeployNotificationSound,
} from '@/utils/vercelDeployNotificationSound';

const DEPLOY_SOUND_INTERVAL_MS = 5_000;

interface SidebarMobileReleaseCardProps {
  release: MobileActiveRelease;
  onDismiss: () => void;
}

function mapReleaseStateToSound(state: MobileReleaseState): 'building' | 'error' | 'deployed' {
  if (state === 'READY') {
    return 'deployed';
  }

  if (state === 'ERROR') {
    return 'error';
  }

  return 'building';
}

function SidebarMobileReleaseCardComponent({ release, onDismiss }: SidebarMobileReleaseCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const [releasesPopupOpen, setReleasesPopupOpen] = useState(false);
  const [releasesPopupAnchor, setReleasesPopupAnchor] = useState<DOMRect | null>(null);
  const previousStateRef = useRef<MobileReleaseState | null>(null);
  const soundKind = useMemo(() => mapReleaseStateToSound(release.state), [release.state]);
  const statusPingClassName = useMemo(
    () => getMobileReleaseStatusPingClassName(release.state),
    [release.state],
  );

  useEffect(() => {
    if (release.state !== 'BUILDING') {
      return;
    }

    finalizeMobileReleasesForPane(release.paneId);
  }, [release.logTail, release.paneId, release.state]);

  useEffect(() => {
    if (release.version) {
      return;
    }

    void refreshMobileReleaseVersion(release.uid);
  }, [release.uid, release.version]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      playVercelDeployNotificationSound(soundKind);
    }, DEPLOY_SOUND_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [release.uid, soundKind]);

  useEffect(() => {
    previousStateRef.current = null;
  }, [release.uid]);

  useEffect(() => {
    if (previousStateRef.current !== null && previousStateRef.current !== release.state) {
      playVercelDeployNotificationSound(soundKind);
    }

    previousStateRef.current = release.state;
  }, [release.state, soundKind]);

  useEffect(() => {
    if (release.state !== 'BUILDING') {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [release.state]);

  const kindLabel = getMobileReleaseKindLabel(release.kind);
  const statusLabel = release.phase ?? getMobileReleaseStatusLabel(release.state);
  const statusClassName = getMobileReleaseStatusClassName(release.state);
  const canCopyLogs = isMobileReleaseFailed(release.state);
  const { copyLogs, loading: logsLoading, copied: logsCopied } = useMobileReleaseLogsCopy(release.uid);
  const statusDisplayLabel = logsCopied ? 'Copiado' : logsLoading ? 'Copiando...' : statusLabel;
  const versionLabel = formatMobileReleaseVersion(release.version, release.versionCode);
  const eyebrowLabel = useMemo(() => {
    if (release.state === 'BUILDING') {
      return formatMobileReleaseElapsed(release.buildingAt, now);
    }

    const finishedAt = release.readyAt ?? release.createdAt;

    return formatMobileReleaseFinishedAt(finishedAt, now);
  }, [now, release.buildingAt, release.createdAt, release.readyAt, release.state]);

  const handleOpenReleasesPopup = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setReleasesPopupAnchor(rect);
    setReleasesPopupOpen(true);
  }, []);

  const handleCloseReleasesPopup = useCallback(() => {
    setReleasesPopupOpen(false);
    setReleasesPopupAnchor(null);
  }, []);

  const handleDismiss = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onDismiss();
    },
    [onDismiss],
  );

  const handleOpenArtifact = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();

      if (!release.artifactPath || !window.nexus?.files) {
        return;
      }

      void window.nexus.files.revealInFolder(release.artifactPath);
    },
    [release.artifactPath],
  );

  const cardClassName = `sidebar-mobile-release-card app-button--enter${canCopyLogs ? ` sidebar-mobile-release-card--copyable app-button${logsCopied ? ' sidebar-mobile-release-card--copied app-button--enter' : ''}` : ''}`;
  const cardTitle = canCopyLogs
    ? 'Copiar logs do release'
    : `${release.projectName} · ${kindLabel}`;

  return (
    <>
      <section
        className={cardClassName}
        title={cardTitle}
        onClick={canCopyLogs ? copyLogs : undefined}
      >
        <div className='sidebar-mobile-release-card__header'>
          <span
            className={`sidebar-mobile-release-card__project-icon sidebar-mobile-release-card__project-icon--${release.kind === 'ios-testflight' ? 'ios' : 'android'}`}
            aria-hidden='true'
          >
            <SidebarMobileReleasePlatformIcon kind={release.kind} size={14} />
          </span>
          <div className='sidebar-mobile-release-card__meta'>
            <span className='sidebar-mobile-release-card__eyebrow'>{eyebrowLabel}</span>
            <button
              type='button'
              className='sidebar-mobile-release-card__project sidebar-mobile-release-card__project-link sidebar-mobile-release-card__inline-link app-button'
              title={release.projectName}
              onClick={handleOpenReleasesPopup}
            >
              {release.projectName}
            </button>
          </div>
          <button
            type='button'
            className='sidebar-mobile-release-card__close app-button app-button--enter'
            aria-label='Fechar card de release'
            title='Fechar'
            onClick={handleDismiss}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        <div className='sidebar-mobile-release-card__body'>
          <div className='sidebar-mobile-release-card__row'>
            <span className='sidebar-mobile-release-card__label'>Plataforma</span>
            <span className='sidebar-mobile-release-card__value' title={kindLabel}>
              {kindLabel}
            </span>
          </div>
          <div className='sidebar-mobile-release-card__row'>
            <span className='sidebar-mobile-release-card__label'>Versão</span>
            <span className='sidebar-mobile-release-card__value' title={versionLabel}>
              {versionLabel}
            </span>
          </div>
          <div className='sidebar-mobile-release-card__row sidebar-mobile-release-card__row--status'>
            <span className='sidebar-mobile-release-card__label'>Status</span>
            <span className='sidebar-mobile-release-card__status'>
              <span
                className={`sidebar-vercel-deploy-card__status-dot ${statusClassName} ${statusPingClassName}`}
                aria-hidden='true'
              />
              <span className='sidebar-mobile-release-card__status-label'>
                {canCopyLogs ? statusDisplayLabel : statusLabel}
              </span>
            </span>
          </div>
          {release.state === 'READY' && release.artifactPath && release.artifactPath.includes('/') ? (
            <div className='sidebar-mobile-release-card__row'>
              <span className='sidebar-mobile-release-card__label'>Artefato</span>
              <button
                type='button'
                className='sidebar-mobile-release-card__value sidebar-mobile-release-card__inline-link app-button'
                title={release.artifactPath}
                onClick={handleOpenArtifact}
              >
                Abrir no Finder
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {releasesPopupOpen && releasesPopupAnchor ? (
        <SidebarMobileReleasesPopup
          anchorRect={releasesPopupAnchor}
          projectId={release.projectId}
          onClose={handleCloseReleasesPopup}
        />
      ) : null}
    </>
  );
}

export const SidebarMobileReleaseCard = memo(SidebarMobileReleaseCardComponent);

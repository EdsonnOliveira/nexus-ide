import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Smartphone, X } from 'lucide-react';
import { downloadWebMobileArtifact } from './downloadWebMobileArtifact';
import {
  canOpenMobileArtifact,
  formatMobileReleaseElapsed,
  formatMobileReleaseFinishedAt,
  formatMobileReleaseVersion,
  getMobileReleaseKindLabel,
  getMobileReleaseStatusClassName,
  getMobileReleaseStatusLabel,
  getMobileReleaseStatusPingClassName,
  type MobileActiveRelease,
} from './mobileRelease';

interface WebMobileReleaseCardProps {
  release: MobileActiveRelease;
  deviceId: string | null;
  onDismiss: () => void;
}

function WebMobileReleaseCardComponent({
  release,
  deviceId,
  onDismiss,
}: WebMobileReleaseCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const statusPingClassName = useMemo(
    () => getMobileReleaseStatusPingClassName(release.state),
    [release.state],
  );
  const canDownload = release.state === 'READY' && canOpenMobileArtifact(release.artifactPath);

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

  useEffect(() => {
    setDownloadError(null);
  }, [release.uid, release.state]);

  const kindLabel = getMobileReleaseKindLabel(release.kind);
  const statusLabel = release.phase ?? getMobileReleaseStatusLabel(release.state);
  const statusClassName = getMobileReleaseStatusClassName(release.state);
  const versionLabel = formatMobileReleaseVersion(release.version, release.versionCode);
  const eyebrowLabel = useMemo(() => {
    if (release.state === 'BUILDING') {
      return formatMobileReleaseElapsed(release.buildingAt, now);
    }
    const finishedAt = release.readyAt ?? release.createdAt;
    return formatMobileReleaseFinishedAt(finishedAt, now);
  }, [now, release.buildingAt, release.createdAt, release.readyAt, release.state]);

  const handleDismiss = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onDismiss();
    },
    [onDismiss],
  );

  const handleDownload = useCallback(
    async (event?: React.MouseEvent) => {
      event?.stopPropagation();

      if (!canDownload || downloading || !release.artifactPath) {
        return;
      }

      setDownloading(true);
      setDownloadError(null);

      try {
        await downloadWebMobileArtifact({
          artifactPath: release.artifactPath,
          deviceId,
          projectId: release.projectId,
          projectName: release.projectName,
        });
      } catch (error) {
        setDownloadError(
          error instanceof Error && error.message.trim()
            ? error.message
            : 'Falha ao baixar artefato',
        );
      } finally {
        setDownloading(false);
      }
    },
    [
      canDownload,
      deviceId,
      downloading,
      release.artifactPath,
      release.projectId,
      release.projectName,
    ],
  );

  const handleCardClick = useCallback(() => {
    if (canDownload) {
      void handleDownload();
    }
  }, [canDownload, handleDownload]);

  const cardClassName = `sidebar-mobile-release-card web-mobile-release-card app-button--enter${
    canDownload ? ' sidebar-mobile-release-card--copyable app-button' : ''
  }`;
  const cardTitle = canDownload
    ? downloading
      ? 'Baixando...'
      : 'Baixar'
    : `${release.projectName} · ${kindLabel}`;

  return (
    <section
      className={cardClassName}
      title={cardTitle}
      onClick={canDownload ? handleCardClick : undefined}
    >
      <div className='sidebar-mobile-release-card__header'>
        <span
          className={`sidebar-mobile-release-card__project-icon sidebar-mobile-release-card__project-icon--${release.kind === 'ios-testflight' ? 'ios' : 'android'}`}
          aria-hidden='true'
        >
          <Smartphone size={14} />
        </span>
        <div className='sidebar-mobile-release-card__meta'>
          <span className='sidebar-mobile-release-card__eyebrow'>{eyebrowLabel}</span>
          <span className='sidebar-mobile-release-card__project' title={release.projectName}>
            {release.projectName}
          </span>
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
            <span className='sidebar-mobile-release-card__status-label'>{statusLabel}</span>
          </span>
        </div>
        {canDownload ? (
          <div className='sidebar-mobile-release-card__row'>
            <span className='sidebar-mobile-release-card__label'>Artefato</span>
            <button
              type='button'
              className='sidebar-mobile-release-card__value sidebar-mobile-release-card__inline-link app-button'
              title={release.artifactPath ?? undefined}
              disabled={downloading}
              onClick={(event) => void handleDownload(event)}
            >
              {downloading ? 'Baixando...' : 'Baixar'}
            </button>
          </div>
        ) : null}
        {downloadError ? (
          <div className='sidebar-mobile-release-card__row'>
            <span className='sidebar-mobile-release-card__label'>Erro</span>
            <span className='sidebar-mobile-release-card__value' title={downloadError}>
              {downloadError}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export const WebMobileReleaseCard = memo(WebMobileReleaseCardComponent);

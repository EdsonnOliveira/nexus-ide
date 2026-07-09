import type { MobileReleaseKind, MobileReleaseState } from '@/types';
import {
  formatVercelDeployElapsed,
  formatVercelDeployFinishedAt,
  getVercelDeploymentStatusClassName,
  getVercelDeploymentStatusPingClassName,
} from '@/utils/vercelDeployment';

export function getMobileReleaseKindLabel(kind: MobileReleaseKind): string {
  switch (kind) {
    case 'android-aab':
      return 'Android AAB';
    case 'android-apk':
      return 'Android APK';
    case 'ios-testflight':
      return 'TestFlight';
    default:
      return kind;
  }
}

export function getMobileReleaseStatusLabel(state: MobileReleaseState): string {
  switch (state) {
    case 'READY':
      return 'Pronto';
    case 'ERROR':
      return 'Erro';
    case 'BUILDING':
      return 'Gerando';
    default:
      return state;
  }
}

export function getMobileReleaseStatusClassName(state: MobileReleaseState): string {
  return getVercelDeploymentStatusClassName(
    state === 'READY' ? 'READY' : state === 'ERROR' ? 'ERROR' : 'BUILDING',
  );
}

export function getMobileReleaseStatusPingClassName(state: MobileReleaseState): string {
  return getVercelDeploymentStatusPingClassName(
    state === 'READY' ? 'READY' : state === 'ERROR' ? 'ERROR' : 'BUILDING',
  );
}

export function formatMobileReleaseElapsed(startedAt: number, now = Date.now()): string {
  return formatVercelDeployElapsed(startedAt, now);
}

export function formatMobileReleaseFinishedAt(timestamp: number, now = Date.now()): string {
  return formatVercelDeployFinishedAt(timestamp, now);
}

export function isMobileReleaseFailed(state: MobileReleaseState): boolean {
  return state === 'ERROR';
}

export function formatMobileReleaseVersion(
  version: string | null,
  versionCode: string | null,
): string {
  const trimmedVersion = version?.trim();
  const trimmedCode = versionCode?.trim();

  if (trimmedVersion && trimmedCode) {
    return `${trimmedVersion} (${trimmedCode})`;
  }

  if (trimmedVersion) {
    return trimmedVersion;
  }

  if (trimmedCode) {
    return trimmedCode;
  }

  return '—';
}

export type MobileReleaseKind = 'android-aab' | 'android-apk' | 'ios-testflight';

export type MobileReleaseState = 'BUILDING' | 'READY' | 'ERROR';

export interface MobileActiveRelease {
  uid: string;
  projectId: string;
  projectName: string;
  paneId: string;
  kind: MobileReleaseKind;
  state: MobileReleaseState;
  version: string | null;
  versionCode: string | null;
  artifactPath: string | null;
  phase: string | null;
  createdAt: number;
  buildingAt: number;
  readyAt: number | null;
  logTail: string;
}

export function isMobileActiveRelease(value: unknown): value is MobileActiveRelease {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const release = value as Record<string, unknown>;

  return (
    typeof release.uid === 'string' &&
    typeof release.projectId === 'string' &&
    typeof release.projectName === 'string' &&
    typeof release.kind === 'string' &&
    typeof release.state === 'string' &&
    typeof release.createdAt === 'number'
  );
}

export function parseMobileReleases(value: unknown): MobileActiveRelease[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isMobileActiveRelease);
}

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
  if (state === 'READY') {
    return 'sidebar-vercel-deploy-card__status-dot--ready';
  }
  if (state === 'ERROR') {
    return 'sidebar-vercel-deploy-card__status-dot--error';
  }
  return 'sidebar-vercel-deploy-card__status-dot--building';
}

export function getMobileReleaseStatusPingClassName(state: MobileReleaseState): string {
  if (state === 'BUILDING') {
    return 'sidebar-vercel-deploy-card__status-dot--ping';
  }
  return '';
}

export function formatMobileReleaseElapsed(startedAt: number, now = Date.now()): string {
  const elapsedMs = Math.max(0, now - startedAt);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatMobileReleaseFinishedAt(timestamp: number, now = Date.now()): string {
  const diffMs = Math.max(0, now - timestamp);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) {
    return 'agora';
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
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

export function canOpenMobileArtifact(artifactPath: string | null | undefined): boolean {
  if (!artifactPath?.trim()) {
    return false;
  }
  return /\.(?:aab|apk|ipa)\b/i.test(artifactPath) || artifactPath.includes('/');
}

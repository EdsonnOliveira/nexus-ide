import { PROJECT_COLORS, type VercelDeploymentState } from '@/types';

function hashString(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash);
}

export function resolveVercelProjectColorKey(projectId: string, projectName: string): string {
  const trimmedProjectId = projectId.trim();

  if (trimmedProjectId) {
    return trimmedProjectId;
  }

  return projectName.trim();
}

export function getVercelProjectInitial(projectName: string): string {
  const trimmed = projectName.trim();

  if (!trimmed) {
    return '?';
  }

  return trimmed.charAt(0).toUpperCase();
}

export function getVercelProjectColor(projectId: string, projectName: string): string {
  const key = resolveVercelProjectColorKey(projectId, projectName);

  if (!key) {
    return PROJECT_COLORS[0];
  }

  const hue = hashString(key) % 360;

  return `hsl(${hue}, 62%, 45%)`;
}

export function getVercelDeploymentStatusLabel(state: VercelDeploymentState): string {
  switch (state) {
    case 'READY':
      return 'Deployed';
    case 'ERROR':
      return 'Error';
    case 'BUILDING':
      return 'Building';
    case 'QUEUED':
      return 'Queued';
    case 'INITIALIZING':
      return 'Initializing';
    case 'CANCELED':
      return 'Canceled';
    case 'BLOCKED':
      return 'Blocked';
    default:
      return state;
  }
}

export function getVercelDeploymentStatusClassName(state: VercelDeploymentState): string {
  switch (state) {
    case 'READY':
      return 'sidebar-vercel-deploy-card__status-dot--ready';
    case 'ERROR':
    case 'BLOCKED':
      return 'sidebar-vercel-deploy-card__status-dot--error';
    case 'BUILDING':
      return 'sidebar-vercel-deploy-card__status-dot--building';
    case 'QUEUED':
    case 'INITIALIZING':
    case 'CANCELED':
      return 'sidebar-vercel-deploy-card__status-dot--neutral';
    default:
      return 'sidebar-vercel-deploy-card__status-dot--neutral';
  }
}

export function getVercelDeploymentStatusPingClassName(state: VercelDeploymentState): string {
  switch (state) {
    case 'READY':
      return 'sidebar-vercel-deploy-card__status-dot--ping-ready';
    case 'ERROR':
    case 'BLOCKED':
      return 'sidebar-vercel-deploy-card__status-dot--ping-error';
    default:
      return 'sidebar-vercel-deploy-card__status-dot--ping-building';
  }
}

export function formatVercelCommitSha(sha: string): string {
  const trimmed = sha.trim();

  if (!trimmed) {
    return '—';
  }

  return trimmed.slice(0, 7);
}

export function formatVercelDeployElapsed(startedAt: number, now = Date.now()): string {
  if (!Number.isFinite(startedAt) || startedAt <= 0) {
    return '—';
  }

  const elapsedMs = Math.max(0, now - startedAt);
  const totalSeconds = Math.floor(elapsedMs / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function isSameCalendarDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function formatVercelDeployDateLabel(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  if (isSameCalendarDay(date, today)) {
    return 'Hoje';
  }

  if (isSameCalendarDay(date, yesterday)) {
    return 'Ontem';
  }

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');

  return `${day}/${month}`;
}

export function formatVercelDeployFinishedAt(timestamp: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '—';
  }

  const date = new Date(timestamp);
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dateLabel = formatVercelDeployDateLabel(timestamp, now);

  return `${time} · ${dateLabel}`;
}

export function getVercelDeploymentPreviewUrl(url: string | null): string | null {
  const trimmed = url?.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

export function isVercelFailedDeployment(state: VercelDeploymentState): boolean {
  return state === 'ERROR' || state === 'BLOCKED';
}

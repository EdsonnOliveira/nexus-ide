import { PROJECT_COLORS, type RenderDeploymentState } from '@/types';
import type { VercelDeploySoundKind } from '@/utils/vercelDeployNotificationSound';

function hashString(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash);
}

export function getRenderProjectInitial(projectName: string): string {
  const trimmed = projectName.trim();

  if (!trimmed) {
    return '?';
  }

  return trimmed.charAt(0).toUpperCase();
}

export function getRenderProjectColor(projectId: string, projectName: string): string {
  const key = projectId.trim() || projectName.trim();

  if (!key) {
    return PROJECT_COLORS[0];
  }

  const hue = hashString(key) % 360;

  return `hsl(${hue}, 62%, 45%)`;
}

export function isRenderInProgressDeployment(state: RenderDeploymentState): boolean {
  return (
    state === 'created' ||
    state === 'queued' ||
    state === 'build_in_progress' ||
    state === 'update_in_progress' ||
    state === 'pre_deploy_in_progress'
  );
}

export function isRenderFailedDeployment(state: RenderDeploymentState): boolean {
  return state === 'build_failed' || state === 'update_failed' || state === 'pre_deploy_failed';
}

export function getRenderDeploymentStatusLabel(state: RenderDeploymentState): string {
  switch (state) {
    case 'live':
      return 'Live';
    case 'build_failed':
    case 'update_failed':
    case 'pre_deploy_failed':
      return 'Error';
    case 'build_in_progress':
      return 'Building';
    case 'update_in_progress':
      return 'Updating';
    case 'pre_deploy_in_progress':
      return 'Pre-deploy';
    case 'queued':
      return 'Queued';
    case 'created':
      return 'Created';
    case 'canceled':
      return 'Canceled';
    case 'deactivated':
      return 'Deactivated';
    default:
      return state;
  }
}

export function getRenderDeploymentStatusClassName(state: RenderDeploymentState): string {
  switch (state) {
    case 'live':
      return 'sidebar-vercel-deploy-card__status-dot--ready';
    case 'build_failed':
    case 'update_failed':
    case 'pre_deploy_failed':
      return 'sidebar-vercel-deploy-card__status-dot--error';
    case 'build_in_progress':
    case 'update_in_progress':
    case 'pre_deploy_in_progress':
      return 'sidebar-vercel-deploy-card__status-dot--building';
    default:
      return 'sidebar-vercel-deploy-card__status-dot--neutral';
  }
}

export function getRenderDeploymentStatusPingClassName(state: RenderDeploymentState): string {
  switch (state) {
    case 'live':
      return 'sidebar-vercel-deploy-card__status-dot--ping-ready';
    case 'build_failed':
    case 'update_failed':
    case 'pre_deploy_failed':
      return 'sidebar-vercel-deploy-card__status-dot--ping-error';
    default:
      return 'sidebar-vercel-deploy-card__status-dot--ping-building';
  }
}

export function getRenderDeploySoundKind(state: RenderDeploymentState): VercelDeploySoundKind {
  if (state === 'live') {
    return 'deployed';
  }

  if (isRenderFailedDeployment(state)) {
    return 'error';
  }

  return 'building';
}

export function formatRenderCommitSha(sha: string): string {
  const trimmed = sha.trim();

  if (!trimmed) {
    return '—';
  }

  return trimmed.slice(0, 7);
}

export function formatRenderDeployElapsed(startedAt: number, now = Date.now()): string {
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

function formatRenderDeployDateLabel(timestamp: number, now = Date.now()): string {
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

export function formatRenderDeployFinishedAt(timestamp: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '—';
  }

  const date = new Date(timestamp);
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dateLabel = formatRenderDeployDateLabel(timestamp, now);

  return `${time} · ${dateLabel}`;
}

function toHttpUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed;
  }

  if (trimmed.includes('://')) {
    return null;
  }

  return `https://${trimmed}`;
}

export function getRenderDeploymentOpenUrl(
  url: string | null,
  dashboardUrl: string | null,
): string | null {
  return toHttpUrl(url) ?? toHttpUrl(dashboardUrl);
}

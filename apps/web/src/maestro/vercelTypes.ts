export type VercelDeploymentState =
  | 'READY'
  | 'ERROR'
  | 'BUILDING'
  | 'QUEUED'
  | 'INITIALIZING'
  | 'CANCELED'
  | 'BLOCKED';

export interface VercelActiveDeployment {
  uid: string;
  projectId: string;
  projectName: string;
  branch: string;
  commitSha: string;
  commitMessage: string;
  state: VercelDeploymentState;
  url: string | null;
  framework: string | null;
  createdAt: number;
  buildingAt: number | null;
  readyAt: number | null;
  commitUrl: string | null;
  projectAvatarUrl: string | null;
}

export function isVercelActiveDeployment(value: unknown): value is VercelActiveDeployment {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.uid === 'string' && typeof record.projectName === 'string';
}

export function parseVercelDeployments(value: unknown): VercelActiveDeployment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isVercelActiveDeployment);
}

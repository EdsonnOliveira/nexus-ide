export interface DeploySnapshotLike {
  active_deployment?: unknown;
  deployments?: unknown;
  updated_at?: unknown;
}

export interface DeployStateRecord {
  key: string;
  uid: string;
  projectName: string;
  branch: string;
  state: string;
  createdAt: number;
  readyAt: number | null;
}

function readTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function readDeployRecord(value: unknown): DeployStateRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const uid = typeof record.uid === 'string' ? record.uid.trim() : '';
  const state = typeof record.state === 'string' ? record.state.trim() : '';
  if (!uid || !state) {
    return null;
  }
  const credentialId = typeof record.credentialId === 'string' ? record.credentialId.trim() : '';
  const projectName =
    typeof record.projectName === 'string' && record.projectName.trim()
      ? record.projectName.trim()
      : 'Projeto';
  const branch =
    typeof record.branch === 'string' && record.branch.trim() ? record.branch.trim() : '—';
  const createdAt = readTimestamp(record.createdAt) ?? Date.now();
  const readyAt = readTimestamp(record.readyAt);
  return {
    key: credentialId ? `${credentialId}:${uid}` : uid,
    uid,
    projectName,
    branch,
    state,
    createdAt,
    readyAt,
  };
}

export function collectDeployRecords(snapshot: DeploySnapshotLike | null): DeployStateRecord[] {
  const items: unknown[] = [];
  if (Array.isArray(snapshot?.deployments)) {
    items.push(...snapshot.deployments);
  }
  if (snapshot?.active_deployment) {
    items.push(snapshot.active_deployment);
  }
  const records: DeployStateRecord[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const record = readDeployRecord(item);
    if (!record || seen.has(record.key)) {
      continue;
    }
    seen.add(record.key);
    records.push(record);
  }
  return records;
}

export function collectDeployStates(snapshot: DeploySnapshotLike | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const record of collectDeployRecords(snapshot)) {
    map.set(record.key, record.state);
  }
  return map;
}

export function readSnapshotUpdatedAt(snapshot: DeploySnapshotLike | null): number | null {
  return readTimestamp(snapshot?.updated_at);
}

export function isVercelTerminalState(state: string): boolean {
  const normalized = state.trim().toUpperCase();
  return normalized === 'READY' || normalized === 'ERROR' || normalized === 'BLOCKED';
}

export function isRenderTerminalState(state: string): boolean {
  const normalized = state.trim().toLowerCase();
  return (
    normalized === 'live' ||
    normalized === 'build_failed' ||
    normalized === 'update_failed' ||
    normalized === 'pre_deploy_failed'
  );
}

export function shouldNotifyDeploy(input: {
  hadSnapshot: boolean;
  previousState: string | undefined;
  isTerminal: boolean;
  createdAt: number;
  readyAt: number | null;
  previousUpdatedAt: number | null;
  currentState: string;
}): boolean {
  if (!input.hadSnapshot || !input.isTerminal) {
    return false;
  }
  if (input.previousState) {
    return input.previousState !== input.currentState;
  }
  const finishedAt = input.readyAt && input.readyAt > 0 ? input.readyAt : input.createdAt;
  if (input.previousUpdatedAt == null) {
    return false;
  }
  return finishedAt >= input.previousUpdatedAt - 60_000;
}

export function deployPushCopy(input: {
  provider: 'vercel' | 'render';
  state: string;
  projectName: string;
  branch: string;
}): { title: string; body: string } {
  const failed =
    input.provider === 'vercel'
      ? isVercelTerminalState(input.state) && input.state.toUpperCase() !== 'READY'
      : input.state.toLowerCase() !== 'live';
  const platform = input.provider === 'vercel' ? 'Vercel' : 'Render';
  return {
    title: failed ? `Deploy ${platform} com erro` : `Deploy ${platform} pronto`,
    body: `${input.projectName}${input.branch !== '—' ? ` · ${input.branch}` : ''}`,
  };
}

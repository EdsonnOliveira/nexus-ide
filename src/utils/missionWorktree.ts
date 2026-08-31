import type { Mission, MissionAgentNode } from '@/types/mission';
import type { Project } from '@/types';

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'node';
}

export function buildMissionWorktreeBranch(missionId: string, nodeId: string): string {
  return `nexus/mission-${sanitizeSegment(missionId.slice(0, 8))}/${sanitizeSegment(nodeId.slice(0, 8))}`;
}

export function buildMissionWorktreePath(projectPath: string, missionId: string, nodeId: string): string {
  const base = projectPath.replace(/\/+$/, '');
  return `${base}/.nexus/worktrees/mission-${sanitizeSegment(missionId.slice(0, 8))}/${sanitizeSegment(nodeId.slice(0, 8))}`;
}

export async function ensureMissionNodeWorktree(input: {
  project: Project;
  mission: Mission;
  node: MissionAgentNode;
}): Promise<{ path: string; branch: string } | null> {
  if (!window.nexus?.git?.addWorktree) {
    return null;
  }

  const branch = buildMissionWorktreeBranch(input.mission.id, input.node.id);
  const worktreePath = buildMissionWorktreePath(input.project.path, input.mission.id, input.node.id);
  const result = await window.nexus.git.addWorktree(input.project.path, worktreePath, branch);

  if (!result.ok) {
    return null;
  }

  return { path: result.path ?? worktreePath, branch };
}

export async function removeMissionNodeWorktree(input: {
  projectPath: string;
  worktreePath: string;
}): Promise<boolean> {
  if (!window.nexus?.git?.removeWorktree) {
    return false;
  }

  const result = await window.nexus.git.removeWorktree(input.projectPath, input.worktreePath, true);
  return result.ok;
}

export function detectMissionWriteConflicts(mission: Mission): Array<{
  projectId: string;
  nodeIds: string[];
  paths: string[];
}> {
  const runningByProject = new Map<string, MissionAgentNode[]>();

  for (const node of mission.nodes) {
    if (node.status !== 'running') {
      continue;
    }

    const list = runningByProject.get(node.projectId) ?? [];
    list.push(node);
    runningByProject.set(node.projectId, list);
  }

  const conflicts: Array<{ projectId: string; nodeIds: string[]; paths: string[] }> = [];

  for (const [projectId, nodes] of runningByProject) {
    if (nodes.length < 2) {
      continue;
    }

    conflicts.push({
      projectId,
      nodeIds: nodes.map((node) => node.id),
      paths: [],
    });
  }

  return conflicts;
}

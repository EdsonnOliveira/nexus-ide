import type { GitChangeStatus } from '@/types/git';

export interface AgentGitChangeFile {
  path: string;
  status: GitChangeStatus;
  staged: boolean;
  additions: number;
  deletions: number;
}

export interface AgentGitChangeGroup {
  id: string;
  paneId: string;
  projectId: string;
  prompt: string;
  files: AgentGitChangeFile[];
  additions: number;
  deletions: number;
  completedAt: number;
}

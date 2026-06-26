export interface AgentGitChangeFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';
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

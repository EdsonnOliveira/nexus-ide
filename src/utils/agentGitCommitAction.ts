import type { AgentGitChangeGroup } from '@/types/agentGit';
import type { GitCommandResult } from '@/types/git';
import { resolveRepoPathForAgentTurn } from '@/utils/agentGitDiff';
import { emitGitRepoRefresh } from '@/utils/gitRepoRefresh';
import { submitAgentPanePrompt } from '@/utils/agentPaneRegistry';
import { sanitizeAgentPrompt } from '@/utils/terminalShellPrompt';

export type AgentGitCommitActionId =
  | 'branch-commit'
  | 'branch-commit-push'
  | 'commit-push'
  | 'commit'
  | 'commit-pr';

export const AGENT_GIT_COMMIT_ACTION_LABELS: Record<AgentGitCommitActionId, string> = {
  'branch-commit': 'Criar branch e commit',
  'branch-commit-push': 'Criar branch, commit e push',
  'commit-push': 'Commit e push',
  commit: 'Commit',
  'commit-pr': 'Commit e criar PR',
};

export const AGENT_GIT_COMMIT_ACTION_OPTIONS: AgentGitCommitActionId[] = [
  'branch-commit-push',
  'commit-push',
  'commit',
  'commit-pr',
];

function buildCommitMessage(prompt: string): string {
  const sanitized = sanitizeAgentPrompt(prompt);
  const firstLine = sanitized.split('\n')[0]?.trim() ?? '';

  if (!firstLine) {
    return 'Alterações do agent';
  }

  if (firstLine.length <= 72) {
    return firstLine;
  }

  return `${firstLine.slice(0, 69)}...`;
}

function buildBranchName(prompt: string): string {
  const sanitized = sanitizeAgentPrompt(prompt);
  const slug = sanitized
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = Date.now().toString(36).slice(-4);

  return slug ? `agent/${slug}-${suffix}` : `agent/changes-${suffix}`;
}

function shouldCreateBranch(action: AgentGitCommitActionId): boolean {
  return action === 'branch-commit' || action === 'branch-commit-push';
}

function shouldPush(action: AgentGitCommitActionId): boolean {
  return action === 'branch-commit-push' || action === 'commit-push' || action === 'commit-pr';
}

export async function executeAgentGitCommitAction(
  action: AgentGitCommitActionId,
  options: {
    projectPath: string;
    paneId: string;
    group: AgentGitChangeGroup;
  },
): Promise<GitCommandResult> {
  const repoPath = await resolveRepoPathForAgentTurn(options.projectPath, options.paneId);

  if (!repoPath) {
    return { ok: false, error: 'Repositório indisponível' };
  }

  const paths = options.group.files.map((file) => file.path);

  if (shouldCreateBranch(action)) {
    const branchResult = await window.nexus.git.createBranch(repoPath, buildBranchName(options.group.prompt));

    if (!branchResult.ok) {
      return branchResult;
    }
  }

  const stageResult =
    paths.length > 0
      ? await window.nexus.git.stage(repoPath, paths)
      : await window.nexus.git.stage(repoPath, []);

  if (!stageResult.ok) {
    return stageResult;
  }

  const commitResult = await window.nexus.git.commit(repoPath, buildCommitMessage(options.group.prompt));

  if (!commitResult.ok) {
    return commitResult;
  }

  await emitGitRepoRefresh(repoPath);

  if (shouldPush(action)) {
    const pushResult = await window.nexus.git.push(repoPath);

    if (!pushResult.ok) {
      return pushResult;
    }

    await emitGitRepoRefresh(repoPath);
  }

  if (action === 'commit-pr') {
    await submitAgentPanePrompt(
      options.paneId,
      'Crie um pull request para as alterações que acabamos de commitar.',
    );
  }

  return { ok: true };
}

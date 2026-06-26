import { resolveAgentGitPromptsForFile } from '@/utils/resolveAgentGitPromptsForFile';

export function resolveAgentGitPromptForFile(
  projectId: string,
  filePath: string,
  repoPath?: string,
): string | null {
  const prompts = resolveAgentGitPromptsForFile(projectId, filePath, repoPath);
  return prompts[0]?.prompt ?? null;
}

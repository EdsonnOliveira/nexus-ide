export async function ensureMissionLiveSkillInProject(
  projectPath: string,
): Promise<void> {
  if (!projectPath.trim()) {
    return;
  }
  await window.nexus?.missions?.ensureLiveSkill?.(projectPath);
}

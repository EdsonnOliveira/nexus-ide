export function buildRunningAutomationProjectIdSet(
  executingAutomationByProject: Record<string, string | null>,
): Set<string> {
  const running = new Set<string>();

  for (const [projectId, automationId] of Object.entries(executingAutomationByProject)) {
    if (automationId) {
      running.add(projectId);
    }
  }

  return running;
}

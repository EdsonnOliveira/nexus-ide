import type { Automation } from '@/types/automation';
import { executeAutomation } from '@/utils/executeAutomation';

const timersByKey = new Map<string, number>();

function timerKey(projectId: string, automationId: string): string {
  return `${projectId}:${automationId}`;
}

export function syncAutomationSchedulers(
  projectId: string | null,
  automations: Automation[],
): void {
  if (!projectId) {
    return;
  }

  for (const automation of automations) {
    if (automation.trigger !== 'interval') {
      continue;
    }

    const minutes = automation.intervalMinutes ?? 0;

    if (minutes < 1) {
      continue;
    }

    const key = timerKey(projectId, automation.id);

    const timerId = window.setInterval(() => {
      void executeAutomation(automation, projectId);
    }, minutes * 60_000);

    timersByKey.set(key, timerId);
  }
}

export function clearAllAutomationSchedulers(): void {
  for (const timerId of timersByKey.values()) {
    window.clearInterval(timerId);
  }

  timersByKey.clear();
}

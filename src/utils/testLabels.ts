import type { ProjectTestEntry, TestRunnerKind, TestRunStep, TestStepStatus } from '@/types/test';
import { buildTestEntryName } from '@/utils/testOutputTracker';

export const TEST_RUNNER_KINDS: TestRunnerKind[] = [
  'maestro',
  'jest',
  'vitest',
  'playwright',
  'detox',
];

export const TEST_RUNNER_LABELS: Record<TestRunnerKind, string> = {
  maestro: 'Maestro',
  jest: 'Jest',
  vitest: 'Vitest',
  playwright: 'Playwright',
  detox: 'Detox',
};

export function getTestRunnerLabel(kind: TestRunnerKind): string {
  return TEST_RUNNER_LABELS[kind];
}

export function getTestStatusLabel(status: TestStepStatus): string {
  switch (status) {
    case 'pending':
      return 'Pendente';
    case 'running':
      return 'Executando';
    case 'passed':
      return 'Passou';
    case 'failed':
      return 'Falhou';
    case 'skipped':
      return 'Ignorado';
    default:
      return status;
  }
}

export function getTestRunStatusLabel(
  status: 'idle' | 'preparing' | 'running' | 'passed' | 'failed',
): string {
  switch (status) {
    case 'idle':
      return 'Pronto';
    case 'preparing':
      return 'Preparando…';
    case 'running':
      return 'Executando';
    case 'passed':
      return 'Passou';
    case 'failed':
      return 'Falhou';
    default:
      return status;
  }
}

export type TestTabFilter = 'all' | TestRunnerKind;

export function getTestTabLabel(filter: TestTabFilter): string {
  if (filter === 'all') {
    return 'Todos';
  }

  return getTestRunnerLabel(filter);
}

function isTestTargetDirectory(targetPath: string): boolean {
  const last = targetPath.split('/').filter(Boolean).pop() ?? targetPath;
  return !/\.(ya?ml|jsx?|tsx?|mjs)$/i.test(last);
}

export function resolveTestEntrySourceName(entry: ProjectTestEntry): string {
  if (entry.sourceName) {
    return entry.sourceName;
  }

  return buildTestEntryName(entry.targetPath, isTestTargetDirectory(entry.targetPath));
}

export function hasDistinctTestEntrySourceName(entry: ProjectTestEntry): boolean {
  const sourceName = resolveTestEntrySourceName(entry);
  return entry.name.trim().toLowerCase() !== sourceName.trim().toLowerCase();
}

export function migrateProjectTestEntry(entry: ProjectTestEntry): ProjectTestEntry {
  if (entry.sourceName) {
    return entry;
  }

  return {
    ...entry,
    sourceName: buildTestEntryName(entry.targetPath, isTestTargetDirectory(entry.targetPath)),
  };
}

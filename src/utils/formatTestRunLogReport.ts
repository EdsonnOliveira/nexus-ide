import type { TestRunnerKind, TestRunStep } from '@/types/test';
import { getTestRunStatusLabel, getTestRunnerLabel, getTestStatusLabel } from '@/utils/testLabels';
import { stripAnsi } from '@/utils/stripAnsi';

interface FormatTestRunLogReportInput {
  testName: string;
  runnerKind: TestRunnerKind;
  targetPath: string;
  status: 'idle' | 'preparing' | 'running' | 'passed' | 'failed';
  steps: TestRunStep[];
  error: string | null;
  logTail: string;
  startedAt: number | null;
  finishedAt: number | null;
}

function formatTimestamp(value: number | null): string | null {
  if (!value) {
    return null;
  }

  return new Date(value).toLocaleString('pt-BR');
}

function formatStepLine(step: TestRunStep): string {
  const prefix = step.line ? `${step.line}. ` : '';
  return `${prefix}[${getTestStatusLabel(step.status)}] ${step.label}`;
}

export function formatTestRunLogReport(input: FormatTestRunLogReportInput): string {
  const sections: string[] = [
    `Teste: ${input.testName}`,
    `Framework: ${getTestRunnerLabel(input.runnerKind)}`,
    `Arquivo: ${input.targetPath}`,
    `Status: ${getTestRunStatusLabel(input.status)}`,
  ];

  const startedLabel = formatTimestamp(input.startedAt);

  if (startedLabel) {
    sections.push(`Início: ${startedLabel}`);
  }

  const finishedLabel = formatTimestamp(input.finishedAt);

  if (finishedLabel) {
    sections.push(`Fim: ${finishedLabel}`);
  }

  if (input.steps.length > 0) {
    sections.push('', '--- Passos ---', ...input.steps.map(formatStepLine));
  }

  if (input.error?.trim()) {
    sections.push('', '--- Erro ---', input.error.trim());
  }

  const plainLog = stripAnsi(input.logTail).trim();

  if (plainLog) {
    sections.push('', '--- Logs ---', plainLog);
  }

  return sections.join('\n').trim();
}

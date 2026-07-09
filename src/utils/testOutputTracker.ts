import type { ProjectTestEntry, TestRunStep, TestRunnerKind } from '@/types/test';
import { stripAnsi } from '@/utils/stripAnsi';

function normalizeMatchText(value: string): string {
  return stripAnsi(value).replace(/\s+/g, ' ').trim().toLowerCase();
}

function markStepStatus(
  steps: TestRunStep[],
  index: number,
  status: TestRunStep['status'],
): TestRunStep[] {
  return steps.map((step, stepIndex) => {
    if (stepIndex === index) {
      return { ...step, status };
    }

    if (stepIndex < index && step.status === 'pending') {
      return { ...step, status: 'passed' };
    }

    return step;
  });
}

function findStepIndexByLabel(steps: TestRunStep[], labelFragment: string): number {
  const normalizedFragment = normalizeMatchText(labelFragment);

  if (!normalizedFragment) {
    return -1;
  }

  return steps.findIndex((step) => {
    const normalizedLabel = normalizeMatchText(step.label);
    return (
      normalizedLabel.includes(normalizedFragment) ||
      normalizedFragment.includes(normalizedLabel) ||
      normalizedLabel.endsWith(normalizedFragment)
    );
  });
}

function advanceRunningStep(steps: TestRunStep[], nextIndex: number): TestRunStep[] {
  const runningIndex = steps.findIndex((step) => step.status === 'running');

  if (runningIndex >= 0 && runningIndex !== nextIndex) {
    return markStepStatus(steps, nextIndex, 'running');
  }

  if (runningIndex === -1 && nextIndex >= 0) {
    return markStepStatus(steps, nextIndex, 'running');
  }

  return steps;
}

function getStepCommandKey(label: string): string {
  return label.split(':')[0]?.trim().toLowerCase() ?? '';
}

const MAESTRO_OUTPUT_COMMAND_PATTERNS: ReadonlyArray<{ pattern: RegExp; key: string }> = [
  { pattern: /\blaunch\s+app\b/i, key: 'launchApp' },
  { pattern: /\bclear\s+state\b/i, key: 'clearState' },
  { pattern: /\bclear\s+keychain\b/i, key: 'clearKeychain' },
  { pattern: /\brun\s+flow\b/i, key: 'runFlow' },
  { pattern: /\brun\s+.+\.ya?ml\b/i, key: 'runFlow' },
  { pattern: /\bextended\s+wait\s+until\b/i, key: 'extendedWaitUntil' },
  { pattern: /\bassert\s+that\b/i, key: 'assertVisible' },
  { pattern: /\bassert\s+visible\b/i, key: 'assertVisible' },
  { pattern: /\bassert\s+not\s+visible\b/i, key: 'assertNotVisible' },
  { pattern: /\btap\s+on\b/i, key: 'tapOn' },
  { pattern: /\bdouble\s+tap\s+on\b/i, key: 'doubleTapOn' },
  { pattern: /\blong\s+press\s+on\b/i, key: 'longPressOn' },
  { pattern: /\binput\s+text\b/i, key: 'inputText' },
  { pattern: /\bwait\s+for\s+animation\b/i, key: 'waitForAnimationToEnd' },
  { pattern: /\bscroll\b/i, key: 'scroll' },
  { pattern: /\bswipe\b/i, key: 'swipe' },
  { pattern: /\bstop\b/i, key: 'stopApp' },
  { pattern: /\bhide\s+keyboard\b/i, key: 'hideKeyboard' },
  { pattern: /\bpress\s+key\b/i, key: 'pressKey' },
  { pattern: /\bopen\s+link\b/i, key: 'openLink' },
  { pattern: /\bback\b/i, key: 'back' },
];

function extractMaestroCommandKey(description: string): string | null {
  for (const { pattern, key } of MAESTRO_OUTPUT_COMMAND_PATTERNS) {
    if (pattern.test(description)) {
      return key;
    }
  }

  return null;
}

function findStepIndexByCommandKey(
  steps: TestRunStep[],
  key: string,
  fromIndex = 0,
): number {
  const normalizedKey = key.toLowerCase();

  return steps.findIndex((step, index) => {
    if (index < fromIndex || step.status === 'passed') {
      return false;
    }

    const stepKey = getStepCommandKey(step.label);
    return stepKey === normalizedKey;
  });
}

function findStepIndexByQuotedText(
  steps: TestRunStep[],
  description: string,
  fromIndex = 0,
): number {
  const quoteMatch = description.match(/"([^"]+)"/);

  if (!quoteMatch) {
    return -1;
  }

  const fragment = normalizeMatchText(quoteMatch[1]);

  return steps.findIndex((step, index) => {
    if (index < fromIndex || step.status === 'passed') {
      return false;
    }

    return normalizeMatchText(step.label).includes(fragment);
  });
}

function findOpenStepIndex(steps: TestRunStep[]): number {
  const runningIndex = steps.findIndex((step) => step.status === 'running');

  if (runningIndex >= 0) {
    return runningIndex;
  }

  return steps.findIndex((step) => step.status === 'pending');
}

function getExecutionFrontierIndex(steps: TestRunStep[]): number {
  const runningIndex = steps.findIndex((step) => step.status === 'running');

  if (runningIndex >= 0) {
    return runningIndex;
  }

  const firstPending = steps.findIndex((step) => step.status === 'pending');

  if (firstPending >= 0) {
    return firstPending;
  }

  return steps.length - 1;
}

function isRunFlowStepLabel(label: string): boolean {
  return getStepCommandKey(label) === 'runflow';
}

function extractRunFlowTarget(label: string): string | null {
  const fileMatch = label.match(/file:\s*([^\s]+)/i);

  if (fileMatch) {
    return normalizeMatchText(fileMatch[1]);
  }

  const yamlMatch = label.match(/([^\s/]+\.ya?ml)/i);

  return yamlMatch ? normalizeMatchText(yamlMatch[1]) : null;
}

function runFlowDescriptionMatchesStep(description: string, stepLabel: string): boolean {
  const target = extractRunFlowTarget(stepLabel);

  if (!target) {
    return true;
  }

  const normalizedDescription = normalizeMatchText(description);

  return (
    normalizedDescription.includes(target) ||
    target.includes(normalizedDescription) ||
    normalizedDescription.endsWith(target)
  );
}

function isResolvableMaestroStepIndex(
  steps: TestRunStep[],
  stepIndex: number,
  activeRunFlowIndex: number | null,
): boolean {
  if (stepIndex < 0) {
    return false;
  }

  if (activeRunFlowIndex !== null) {
    return stepIndex === activeRunFlowIndex;
  }

  return stepIndex <= getExecutionFrontierIndex(steps);
}

function resolveMaestroStepIndex(steps: TestRunStep[], description: string): number {
  const commandKey = extractMaestroCommandKey(description);

  if (commandKey) {
    const commandIndex = findStepIndexByCommandKey(steps, commandKey);

    if (commandIndex >= 0) {
      return commandIndex;
    }
  }

  const quotedIndex = findStepIndexByQuotedText(steps, description);

  if (quotedIndex >= 0) {
    return quotedIndex;
  }

  const labelIndex = steps.findIndex((step) => {
    if (step.status === 'passed') {
      return false;
    }

    const normalizedLabel = normalizeMatchText(step.label);
    const normalizedDescription = normalizeMatchText(description);

    return (
      normalizedLabel.includes(normalizedDescription) ||
      normalizedDescription.includes(normalizedLabel)
    );
  });

  if (labelIndex >= 0) {
    return labelIndex;
  }

  return findOpenStepIndex(steps);
}

function cleanMaestroOutputLine(line: string): string {
  return stripAnsi(line).replace(/^[║>│\s]+/, '').trim();
}

function applyMaestroOutput(steps: TestRunStep[], plain: string): TestRunStep[] {
  let nextSteps = steps;
  let activeRunFlowIndex: number | null = null;

  for (const line of plain.split('\n')) {
    const trimmed = cleanMaestroOutputLine(line);

    if (!trimmed) {
      continue;
    }

    let description = '';
    let eventStatus: 'completed' | 'running' | 'failed' | 'passed' | null = null;

    const statusSuffixMatch = trimmed.match(/^(.+?)\.{2,}\s*(COMPLETED|RUNNING|FAILED)\s*$/i);

    if (statusSuffixMatch) {
      description = statusSuffixMatch[1].trim();
      const status = statusSuffixMatch[2].toUpperCase();
      eventStatus =
        status === 'COMPLETED' ? 'completed' : status === 'RUNNING' ? 'running' : 'failed';
    }

    const successMatch = trimmed.match(/^(?:✅|✓)\s+(.+)$/i) ?? trimmed.match(/^Passed\s+(.+)$/i);

    if (successMatch && !eventStatus) {
      description = successMatch[1].trim();
      eventStatus = 'passed';
    }

    const failMatch =
      trimmed.match(/^(?:❌|✗)\s+(.+)$/i) ??
      trimmed.match(/^(?:Failed|Assertion is false:|Element not found:)\s+(.+)$/i);

    if (failMatch && !eventStatus) {
      description = failMatch[1].trim();
      eventStatus = 'failed';
    }

    if (!eventStatus || !description) {
      continue;
    }

    const commandKey = extractMaestroCommandKey(description);
    const stepIndex = resolveMaestroStepIndex(nextSteps, description);

    if (stepIndex < 0) {
      continue;
    }

    if (activeRunFlowIndex === null) {
      const frontier = getExecutionFrontierIndex(nextSteps);
      const frontierStep = frontier >= 0 ? nextSteps[frontier] : null;

      if (
        frontierStep &&
        isRunFlowStepLabel(frontierStep.label) &&
        frontierStep.status !== 'passed' &&
        commandKey !== 'runFlow'
      ) {
        activeRunFlowIndex = frontier;
        if (frontierStep.status !== 'running') {
          nextSteps = markStepStatus(nextSteps, frontier, 'running');
        }
      }
    }

    if (!isResolvableMaestroStepIndex(nextSteps, stepIndex, activeRunFlowIndex)) {
      continue;
    }

    const isRunFlowEvent = commandKey === 'runFlow' || isRunFlowStepLabel(nextSteps[stepIndex].label);

    if (eventStatus === 'running' && isRunFlowEvent) {
      activeRunFlowIndex = stepIndex;
      nextSteps = advanceRunningStep(nextSteps, stepIndex);
      continue;
    }

    if (eventStatus === 'failed') {
      if (isRunFlowEvent && activeRunFlowIndex === stepIndex) {
        activeRunFlowIndex = null;
      }

      nextSteps = markStepStatus(nextSteps, stepIndex, 'failed');
      continue;
    }

    if (eventStatus === 'completed' || eventStatus === 'passed') {
      if (isRunFlowEvent) {
        if (!runFlowDescriptionMatchesStep(description, nextSteps[stepIndex].label)) {
          continue;
        }

        if (activeRunFlowIndex === stepIndex) {
          activeRunFlowIndex = null;
        }

        nextSteps = markStepStatus(nextSteps, stepIndex, 'passed');
        continue;
      }

      if (activeRunFlowIndex !== null) {
        continue;
      }

      nextSteps = markStepStatus(nextSteps, stepIndex, 'passed');

      if (/\bclear\s+state\b/i.test(description)) {
        const clearStateIndex = findStepIndexByCommandKey(nextSteps, 'clearState', stepIndex + 1);

        if (clearStateIndex === stepIndex + 1) {
          nextSteps = markStepStatus(nextSteps, clearStateIndex, 'passed');
        }
      }

      continue;
    }

    if (activeRunFlowIndex !== null) {
      continue;
    }

    nextSteps = advanceRunningStep(nextSteps, stepIndex);
  }

  if (activeRunFlowIndex !== null) {
    if (nextSteps[activeRunFlowIndex]?.status !== 'running') {
      nextSteps = markStepStatus(nextSteps, activeRunFlowIndex, 'running');
    }

    return nextSteps;
  }

  const firstPending = nextSteps.findIndex((step) => step.status === 'pending');

  if (firstPending >= 0 && !nextSteps.some((step) => step.status === 'running')) {
    nextSteps = markStepStatus(nextSteps, firstPending, 'running');
  }

  return nextSteps;
}

function applyUnitTestOutput(steps: TestRunStep[], plain: string): TestRunStep[] {
  let nextSteps = steps;

  for (const line of plain.split('\n')) {
    const trimmed = stripAnsi(line).trim();

    if (!trimmed) {
      continue;
    }

    const passMatch = trimmed.match(/(?:✓|√|PASS)\s+(.+)$/i);
    const failMatch = trimmed.match(/(?:✕|×|FAIL)\s+(.+)$/i);

    if (passMatch) {
      const index = findStepIndexByLabel(nextSteps, passMatch[1]);

      if (index >= 0) {
        nextSteps = markStepStatus(nextSteps, index, 'passed');
      }

      continue;
    }

    if (failMatch) {
      const index = findStepIndexByLabel(nextSteps, failMatch[1]);

      if (index >= 0) {
        nextSteps = markStepStatus(nextSteps, index, 'failed');
      }
    }
  }

  return nextSteps;
}

function applyPlaywrightOutput(steps: TestRunStep[], plain: string): TestRunStep[] {
  let nextSteps = steps;

  for (const line of plain.split('\n')) {
    const trimmed = stripAnsi(line).trim();

    if (!trimmed) {
      continue;
    }

    const runningMatch = trimmed.match(/^\[(\d+)\/(\d+)\]\s+(.+)$/);

    if (runningMatch) {
      const index = findStepIndexByLabel(nextSteps, runningMatch[3]);

      if (index >= 0) {
        nextSteps = advanceRunningStep(nextSteps, index);
      }

      continue;
    }

    if (/passed/i.test(trimmed)) {
      const index = nextSteps.findIndex((step) => step.status === 'running');

      if (index >= 0) {
        nextSteps = markStepStatus(nextSteps, index, 'passed');
      }
    }

    if (/failed|error/i.test(trimmed)) {
      const index =
        nextSteps.findIndex((step) => step.status === 'running') ??
        nextSteps.findIndex((step) => step.status === 'pending');

      if (index >= 0) {
        nextSteps = markStepStatus(nextSteps, index, 'failed');
      }
    }
  }

  return nextSteps;
}

function applyDetoxOutput(steps: TestRunStep[], plain: string): TestRunStep[] {
  let nextSteps = steps;

  for (const line of plain.split('\n')) {
    const trimmed = stripAnsi(line).trim();

    if (!trimmed) {
      continue;
    }

    if (/RUNS\s+(.+)/i.test(trimmed)) {
      const match = trimmed.match(/RUNS\s+(.+)/i);
      const index = match ? findStepIndexByLabel(nextSteps, match[1]) : -1;

      if (index >= 0) {
        nextSteps = advanceRunningStep(nextSteps, index);
      }

      continue;
    }

    if (/PASS\s+(.+)/i.test(trimmed)) {
      const match = trimmed.match(/PASS\s+(.+)/i);
      const index = match ? findStepIndexByLabel(nextSteps, match[1]) : -1;

      if (index >= 0) {
        nextSteps = markStepStatus(nextSteps, index, 'passed');
      }

      continue;
    }

    if (/FAIL\s+(.+)/i.test(trimmed)) {
      const match = trimmed.match(/FAIL\s+(.+)/i);
      const index = match ? findStepIndexByLabel(nextSteps, match[1]) : -1;

      if (index >= 0) {
        nextSteps = markStepStatus(nextSteps, index, 'failed');
      }
    }
  }

  return nextSteps;
}

export function applyTestOutputToSteps(
  kind: TestRunnerKind,
  steps: TestRunStep[],
  chunk: string,
  accumulatedLog: string,
): { steps: TestRunStep[]; logTail: string } {
  const logTail = `${accumulatedLog}${chunk}`.slice(-16384);
  const plain = stripAnsi(logTail);

  switch (kind) {
    case 'maestro':
      return { steps: applyMaestroOutput(steps, plain), logTail };
    case 'jest':
    case 'vitest':
      return { steps: applyUnitTestOutput(steps, plain), logTail };
    case 'playwright':
      return { steps: applyPlaywrightOutput(steps, plain), logTail };
    case 'detox':
      return { steps: applyDetoxOutput(steps, plain), logTail };
    default:
      return { steps, logTail };
  }
}

export function finalizeTestSteps(
  steps: TestRunStep[],
  exitCode: number,
): TestRunStep[] {
  if (exitCode === 0) {
    return steps.map((step) =>
      step.status === 'pending' || step.status === 'running'
        ? { ...step, status: 'passed' }
        : step,
    );
  }

  return steps.map((step) => {
    if (step.status === 'running') {
      return { ...step, status: 'failed' };
    }

    if (step.status === 'pending') {
      return { ...step, status: 'skipped' };
    }

    return step;
  });
}

export function buildTestEntryName(relativePath: string, isDirectory: boolean): string {
  const segments = relativePath.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? relativePath;

  if (isDirectory) {
    return last;
  }

  return last.replace(/\.(ya?ml|jsx?|tsx?|mjs)$/i, '');
}

export function createProjectTestEntry(
  kind: TestRunnerKind,
  relativePath: string,
  isDirectory: boolean,
): ProjectTestEntry {
  return {
    id: crypto.randomUUID(),
    kind,
    name: buildTestEntryName(relativePath, isDirectory),
    sourceName: buildTestEntryName(relativePath, isDirectory),
    targetPath: relativePath,
    addedAt: Date.now(),
  };
}

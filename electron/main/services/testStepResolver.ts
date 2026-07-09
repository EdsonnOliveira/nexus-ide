import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProjectTestEntry, TestRunStep, TestRunnerKind } from '../../types/test';

const MAESTRO_COMMAND_KEYS = new Set([
  'tapOn',
  'doubleTapOn',
  'longPressOn',
  'swipe',
  'inputText',
  'assertVisible',
  'assertNotVisible',
  'assertTrue',
  'assertFalse',
  'launchApp',
  'stopApp',
  'runFlow',
  'scroll',
  'back',
  'hideKeyboard',
  'copyTextFrom',
  'pasteText',
  'pressKey',
  'openLink',
  'takeScreenshot',
  'eraseText',
  'setLocation',
  'repeat',
  'evalScript',
  'waitForAnimationToEnd',
  'extendedWaitUntil',
  'clearState',
  'clearKeychain',
]);

const TEST_FILE_PATTERN = /\.(test|spec)\.(jsx?|tsx?)$/;
const PLAYWRIGHT_SPEC_PATTERN = /\.spec\.(ts|js|tsx|jsx|mjs)$/;
const DETOX_FILE_PATTERN = /\.test\.(js|ts|tsx|jsx)$/;

function formatMaestroStepLabel(key: string, value: unknown): string {
  if (typeof value === 'string') {
    return `${key}: ${value}`;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${key}: ${String(value)}`;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const id = record.id;
    const text = record.text;
    const file = record.file;

    if (typeof file === 'string') {
      return `${key}: file: ${file}`;
    }

    if (typeof id === 'string') {
      return `${key}: id "${id}"`;
    }

    if (typeof text === 'string') {
      return `${key}: "${text}"`;
    }
  }

  return key;
}

function resolveMaestroStepsFromContent(content: string): TestRunStep[] {
  const lines = content.split('\n');
  const steps: TestRunStep[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed || trimmed === '---') {
      continue;
    }

    const match = trimmed.match(/^(?:-\s+)?([A-Za-z][A-Za-z0-9_-]*)(?:\s*:\s*(.*))?$/);

    if (!match) {
      continue;
    }

    const key = match[1];

    if (!MAESTRO_COMMAND_KEYS.has(key)) {
      continue;
    }

    const inlineValue = (match[2] ?? '').trim();
    let value: unknown = inlineValue || undefined;

    if (!inlineValue) {
      const nextLine = lines[index + 1];

      if (nextLine && /^\s{2,}\S/.test(nextLine)) {
        const nextMatch = nextLine.trim().match(/^(?:-\s+)?([A-Za-z][A-Za-z0-9_-]*)(?:\s*:\s*(.*))?$/);
        const nextKey = nextMatch?.[1];

        if (!nextKey || !MAESTRO_COMMAND_KEYS.has(nextKey)) {
          value = nextLine.trim();
        }
      }
    }

    steps.push({
      id: randomUUID(),
      label: formatMaestroStepLabel(key, value),
      line: steps.length + 1,
      status: 'pending',
    });
  }

  return steps;
}

function resolveMaestroSteps(absolutePath: string): TestRunStep[] {
  if (!existsSync(absolutePath)) {
    return [];
  }

  try {
    const content = readFileSync(absolutePath, 'utf8');
    return resolveMaestroStepsFromContent(content);
  } catch {
    return [];
  }
}

export function resolveMaestroStepsAtPath(absolutePath: string): TestRunStep[] {
  return resolveMaestroSteps(absolutePath);
}

function extractTestCasesFromContent(content: string): TestRunStep[] {
  const steps: TestRunStep[] = [];
  const patterns = [
    /\bit\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /\btest\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /\btest\.(?:only|skip)?\s*\(\s*['"`]([^'"`]+)['"`]/g,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(content);

    while (match) {
      steps.push({
        id: randomUUID(),
        label: match[1],
        status: 'pending',
      });
      match = pattern.exec(content);
    }
  }

  return steps;
}

function resolveFileTestSteps(absolutePath: string): TestRunStep[] {
  if (!existsSync(absolutePath)) {
    return [];
  }

  try {
    const content = readFileSync(absolutePath, 'utf8');
    return extractTestCasesFromContent(content);
  } catch {
    return [];
  }
}

function collectFilesInDirectory(
  directoryPath: string,
  matcher: (relativeName: string) => boolean,
): string[] {
  const files: string[] = [];

  function walk(currentPath: string): void {
    let entries;

    try {
      entries = readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }

        walk(absolutePath);
        continue;
      }

      if (matcher(entry.name)) {
        files.push(absolutePath);
      }
    }
  }

  walk(directoryPath);
  return files.sort((left, right) => left.localeCompare(right));
}

function resolveDirectorySteps(
  projectPath: string,
  relativePath: string,
  kind: TestRunnerKind,
): TestRunStep[] {
  const absolutePath = path.join(projectPath, relativePath);

  if (!existsSync(absolutePath) || !statSync(absolutePath).isDirectory()) {
    return [];
  }

  const matcher =
    kind === 'playwright'
      ? (name: string) => PLAYWRIGHT_SPEC_PATTERN.test(name)
      : kind === 'detox'
        ? (name: string) => DETOX_FILE_PATTERN.test(name)
        : kind === 'maestro'
          ? (name: string) => /\.(ya?ml)$/i.test(name)
          : (name: string) => TEST_FILE_PATTERN.test(name);

  const files = collectFilesInDirectory(absolutePath, matcher);
  const steps: TestRunStep[] = [];

  for (const filePath of files) {
    const fileRelative = path.relative(projectPath, filePath).replace(/\\/g, '/');
    const fileSteps = kind === 'maestro' ? resolveMaestroSteps(filePath) : resolveFileTestSteps(filePath);

    if (fileSteps.length === 0) {
      steps.push({
        id: randomUUID(),
        label: fileRelative,
        status: 'pending',
      });
      continue;
    }

    for (const step of fileSteps) {
      steps.push({
        ...step,
        id: randomUUID(),
        label: `${path.basename(fileRelative)} — ${step.label}`,
      });
    }
  }

  return steps;
}

export function resolveTestSteps(projectPath: string, entry: ProjectTestEntry): TestRunStep[] {
  const absolutePath = path.join(projectPath, entry.targetPath);

  if (!existsSync(absolutePath)) {
    return [
      {
        id: randomUUID(),
        label: entry.targetPath,
        status: 'pending',
      },
    ];
  }

  if (statSync(absolutePath).isDirectory()) {
    return resolveDirectorySteps(projectPath, entry.targetPath, entry.kind);
  }

  if (entry.kind === 'maestro') {
    const steps = resolveMaestroSteps(absolutePath);

    if (steps.length > 0) {
      return steps;
    }
  }

  const fileSteps = resolveFileTestSteps(absolutePath);

  if (fileSteps.length > 0) {
    return fileSteps;
  }

  return [
    {
      id: randomUUID(),
      label: entry.name,
      status: 'pending',
    },
  ];
}

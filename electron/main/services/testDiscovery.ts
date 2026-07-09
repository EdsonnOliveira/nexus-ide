import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { DiscoveredTestTarget, TestRunnerKind } from '../../types/test';

const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  '.hg',
  '.nexus',
  '.svn',
  '__pycache__',
  'coverage',
  'dist',
  'dist-electron',
  'node_modules',
  'release',
  'build',
  '.next',
  '.turbo',
]);

const MAX_DEPTH = 10;

const TEST_FILE_PATTERN = /\.(test|spec)\.(jsx?|tsx?)$/;
const MAESTRO_FILE_PATTERN = /\.(ya?ml)$/;
const PLAYWRIGHT_SPEC_PATTERN = /\.spec\.(ts|js|tsx|jsx|mjs)$/;
const DETOX_FILE_PATTERN = /\.test\.(js|ts|tsx|jsx)$/;

function shouldSkipDirectory(name: string): boolean {
  return IGNORED_DIRECTORY_NAMES.has(name) || name.startsWith('.') && name !== '.maestro';
}

function readPackageJson(projectPath: string): Record<string, unknown> | null {
  const packagePath = path.join(projectPath, 'package.json');

  if (!existsSync(packagePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(packagePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function packageHasDependency(packageJson: Record<string, unknown> | null, name: string): boolean {
  if (!packageJson) {
    return false;
  }

  const deps = packageJson.dependencies as Record<string, string> | undefined;
  const devDeps = packageJson.devDependencies as Record<string, string> | undefined;

  return Boolean(deps?.[name] || devDeps?.[name]);
}

function packageHasScript(packageJson: Record<string, unknown> | null, pattern: RegExp): boolean {
  if (!packageJson) {
    return false;
  }

  const scripts = packageJson.scripts as Record<string, string> | undefined;

  if (!scripts) {
    return false;
  }

  return Object.values(scripts).some((script) => pattern.test(script));
}

function isMaestroPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');

  if (normalized.startsWith('.maestro/') || normalized.includes('/.maestro/')) {
    return true;
  }

  if (normalized.startsWith('maestro/') || normalized.includes('/maestro/')) {
    return true;
  }

  return normalized.endsWith('.maestro.yaml') || normalized.endsWith('.maestro.yml');
}

function walkDirectory(
  projectPath: string,
  currentPath: string,
  depth: number,
  visit: (absolutePath: string, relativePath: string, isDirectory: boolean) => void,
): void {
  if (depth > MAX_DEPTH) {
    return;
  }

  let entries;

  try {
    entries = readdirSync(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && shouldSkipDirectory(entry.name)) {
      continue;
    }

    const absolutePath = path.join(currentPath, entry.name);
    const relativePath = path.relative(projectPath, absolutePath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      visit(absolutePath, relativePath, true);
      walkDirectory(projectPath, absolutePath, depth + 1, visit);
      continue;
    }

    visit(absolutePath, relativePath, false);
  }
}

function uniqueTargets(targets: DiscoveredTestTarget[]): DiscoveredTestTarget[] {
  const seen = new Set<string>();

  return targets.filter((target) => {
    const key = `${target.kind}:${target.relativePath}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function discoverMaestro(projectPath: string): DiscoveredTestTarget[] {
  const targets: DiscoveredTestTarget[] = [];
  const directories = new Set<string>();

  walkDirectory(projectPath, projectPath, 0, (absolutePath, relativePath, isDirectory) => {
    if (isDirectory) {
      if (isMaestroPath(relativePath) || relativePath === '.maestro' || relativePath === 'maestro') {
        directories.add(relativePath);
      }

      return;
    }

    if (!MAESTRO_FILE_PATTERN.test(relativePath)) {
      return;
    }

    if (!isMaestroPath(relativePath)) {
      return;
    }

    targets.push({
      kind: 'maestro',
      relativePath,
      name: path.basename(relativePath),
      isDirectory: false,
    });
  });

  for (const directory of directories) {
    targets.push({
      kind: 'maestro',
      relativePath: directory,
      name: path.basename(directory) || directory,
      isDirectory: true,
    });
  }

  return uniqueTargets(targets).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function discoverUnitTests(
  projectPath: string,
  kind: 'jest' | 'vitest',
): DiscoveredTestTarget[] {
  const packageJson = readPackageJson(projectPath);
  const dependencyName = kind === 'vitest' ? 'vitest' : 'jest';

  if (!packageHasDependency(packageJson, dependencyName) && !packageHasScript(packageJson, new RegExp(dependencyName))) {
    return [];
  }

  const targets: DiscoveredTestTarget[] = [];

  walkDirectory(projectPath, projectPath, 0, (_absolutePath, relativePath, isDirectory) => {
    if (isDirectory) {
      return;
    }

    if (!TEST_FILE_PATTERN.test(relativePath)) {
      return;
    }

    if (relativePath.includes('/e2e/') || relativePath.startsWith('e2e/')) {
      return;
    }

    targets.push({
      kind,
      relativePath,
      name: path.basename(relativePath),
      isDirectory: false,
    });
  });

  return uniqueTargets(targets).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function discoverPlaywright(projectPath: string): DiscoveredTestTarget[] {
  const packageJson = readPackageJson(projectPath);
  const hasPlaywright =
    packageHasDependency(packageJson, '@playwright/test') ||
    packageHasDependency(packageJson, 'playwright') ||
    existsSync(path.join(projectPath, 'playwright.config.ts')) ||
    existsSync(path.join(projectPath, 'playwright.config.js')) ||
    existsSync(path.join(projectPath, 'playwright.config.mjs'));

  if (!hasPlaywright) {
    return [];
  }

  const targets: DiscoveredTestTarget[] = [];
  const e2eDir = path.join(projectPath, 'e2e');

  if (existsSync(e2eDir) && statSync(e2eDir).isDirectory()) {
    targets.push({
      kind: 'playwright',
      relativePath: 'e2e',
      name: 'e2e',
      isDirectory: true,
    });
  }

  walkDirectory(projectPath, projectPath, 0, (_absolutePath, relativePath, isDirectory) => {
    if (isDirectory) {
      return;
    }

    if (!PLAYWRIGHT_SPEC_PATTERN.test(relativePath)) {
      return;
    }

    targets.push({
      kind: 'playwright',
      relativePath,
      name: path.basename(relativePath),
      isDirectory: false,
    });
  });

  return uniqueTargets(targets).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function discoverDetox(projectPath: string): DiscoveredTestTarget[] {
  const packageJson = readPackageJson(projectPath);
  const hasDetox =
    packageHasDependency(packageJson, 'detox') ||
    existsSync(path.join(projectPath, '.detoxrc.js')) ||
    existsSync(path.join(projectPath, '.detoxrc.json')) ||
    existsSync(path.join(projectPath, 'detox.config.js'));

  if (!hasDetox) {
    return [];
  }

  const targets: DiscoveredTestTarget[] = [];
  const e2eDir = path.join(projectPath, 'e2e');

  if (existsSync(e2eDir) && statSync(e2eDir).isDirectory()) {
    targets.push({
      kind: 'detox',
      relativePath: 'e2e',
      name: 'e2e',
      isDirectory: true,
    });
  }

  walkDirectory(projectPath, projectPath, 0, (_absolutePath, relativePath, isDirectory) => {
    if (isDirectory) {
      return;
    }

    if (!DETOX_FILE_PATTERN.test(relativePath)) {
      return;
    }

    targets.push({
      kind: 'detox',
      relativePath,
      name: path.basename(relativePath),
      isDirectory: false,
    });
  });

  return uniqueTargets(targets).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function discoverTests(projectPath: string, kind: TestRunnerKind): DiscoveredTestTarget[] {
  const resolvedPath = path.resolve(projectPath);

  if (!existsSync(resolvedPath)) {
    return [];
  }

  switch (kind) {
    case 'maestro':
      return discoverMaestro(resolvedPath);
    case 'jest':
      return discoverUnitTests(resolvedPath, 'jest');
    case 'vitest':
      return discoverUnitTests(resolvedPath, 'vitest');
    case 'playwright':
      return discoverPlaywright(resolvedPath);
    case 'detox':
      return discoverDetox(resolvedPath);
    default:
      return [];
  }
}

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getInstalledCliAgentDefinitions } from './cliAgents';

export interface TerminalCommandHint {
  id: string;
  badge: string;
  badgeIcon?:
    | 'expo'
    | 'apple'
    | 'android'
    | 'cursor'
    | 'claude'
    | 'codex'
    | 'gemini'
    | 'mode-agent'
    | 'mode-plan'
    | 'mode-ask'
    | 'mode-debug'
    | 'mode-multitask';
  badgeColor?: string;
  label: string;
  command: string;
  hintKind?: 'skill' | 'mode' | 'model';
  skillOrigin?: 'user' | 'builtin';
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

type PackageManager = 'yarn' | 'npm' | 'pnpm' | 'bun';

const MAX_TOTAL_HINTS = 14;

const ROOT_MARKERS = [
  'package.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'manage.py',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
];

export function findProjectRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  let fallback: string | null = null;

  while (true) {
    for (const marker of ROOT_MARKERS) {
      if (!existsSync(path.join(current, marker))) {
        continue;
      }

      if (marker === 'package.json') {
        return current;
      }

      fallback = current;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      return fallback;
    }

    current = parent;
  }
}

function detectPackageManager(root: string): PackageManager {
  if (existsSync(path.join(root, 'yarn.lock'))) {
    return 'yarn';
  }

  if (existsSync(path.join(root, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }

  if (existsSync(path.join(root, 'bun.lockb'))) {
    return 'bun';
  }

  return 'npm';
}

function pmRun(pm: PackageManager, script: string): string {
  if (pm === 'npm') {
    return `npm run ${script}`;
  }

  return `${pm} ${script}`;
}

function pmExec(pm: PackageManager, command: string): string {
  if (pm === 'npm') {
    return `npx ${command}`;
  }

  if (pm === 'pnpm') {
    return `pnpm exec ${command}`;
  }

  if (pm === 'bun') {
    return `bunx ${command}`;
  }

  return `yarn ${command}`;
}

function readPackageJson(root: string): PackageJson | null {
  try {
    const raw = readFileSync(path.join(root, 'package.json'), 'utf8');
    return JSON.parse(raw) as PackageJson;
  } catch {
    return null;
  }
}

function hasFile(root: string, names: string[]): boolean {
  return names.some((name) => existsSync(path.join(root, name)));
}

function hasDep(pkg: PackageJson, name: string): boolean {
  return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
}

function pushHint(
  hints: TerminalCommandHint[],
  seen: Set<string>,
  hint: TerminalCommandHint,
): void {
  if (seen.has(hint.command)) {
    return;
  }

  seen.add(hint.command);
  hints.push(hint);
}

function pushScript(
  hints: TerminalCommandHint[],
  seen: Set<string>,
  pm: PackageManager,
  script: string,
  badge: string,
  id: string,
  badgeIcon?: TerminalCommandHint['badgeIcon'],
): void {
  pushHint(hints, seen, {
    id,
    badge,
    badgeIcon,
    label: pmRun(pm, script),
    command: `${pmRun(pm, script)}\n`,
  });
}

function buildCliAgentHints(seen: Set<string>): TerminalCommandHint[] {
  const hints: TerminalCommandHint[] = [];

  for (const agent of getInstalledCliAgentDefinitions()) {
    if (agent.command === 'cursor-agent') {
      continue;
    }

    pushHint(hints, seen, {
      id: `cli-${agent.id}`,
      badge: agent.badgeIcon,
      badgeIcon: agent.badgeIcon,
      badgeColor: agent.badgeColor,
      label: agent.label,
      command: `${agent.command}\n`,
    });
  }

  return hints;
}

function buildNodeProjectHints(root: string, pm: PackageManager, seen: Set<string>): TerminalCommandHint[] {
  const pkg = readPackageJson(root);

  if (!pkg) {
    return [];
  }

  const hints: TerminalCommandHint[] = [];
  const scripts = pkg.scripts ?? {};
  const isNext =
    hasDep(pkg, 'next') ||
    hasFile(root, ['next.config.js', 'next.config.mjs', 'next.config.ts']);
  const isExpo = hasDep(pkg, 'expo') || hasFile(root, ['app.json', 'app.config.js', 'app.config.ts']);
  const isReactNative =
    hasDep(pkg, 'react-native') && hasFile(root, ['android', 'ios']) && !isExpo;
  const isVite =
    hasDep(pkg, 'vite') || hasFile(root, ['vite.config.js', 'vite.config.mts', 'vite.config.ts']);
  const isNuxt = hasDep(pkg, 'nuxt') || hasFile(root, ['nuxt.config.js', 'nuxt.config.ts']);
  const isAngular = hasDep(pkg, '@angular/core') || hasFile(root, ['angular.json']);
  const isRemix = hasDep(pkg, '@remix-run/node') || hasDep(pkg, '@remix-run/react');
  const isAstro = hasDep(pkg, 'astro');
  const isSvelteKit = hasDep(pkg, '@sveltejs/kit');
  const isElectron = hasDep(pkg, 'electron');
  const isNest = hasDep(pkg, '@nestjs/core');
  const isPrisma = hasDep(pkg, 'prisma') || hasFile(root, ['prisma/schema.prisma']);
  const isSupabase = hasFile(root, ['supabase/config.toml']);
  const isTauri = hasDep(pkg, '@tauri-apps/api') || hasFile(root, ['src-tauri/tauri.conf.json']);
  const isStorybook = hasDep(pkg, '@storybook/react') || hasDep(pkg, 'storybook');

  if (isNext) {
    if (scripts.dev) {
      pushScript(hints, seen, pm, 'dev', 'dev', 'next-dev');
    }

    if (scripts.build) {
      pushScript(hints, seen, pm, 'build', 'build', 'next-build');
    }

    if (scripts.lint) {
      pushScript(hints, seen, pm, 'lint', 'lint', 'next-lint');
    }

    if (scripts.test) {
      pushScript(hints, seen, pm, 'test', 'test', 'next-test');
    }

    return hints;
  }

  if (isExpo) {
    if (scripts.start) {
      pushScript(hints, seen, pm, 'start', 'expo', 'expo-start', 'expo');
    }

    if (scripts.ios) {
      pushScript(hints, seen, pm, 'ios', 'ios', 'expo-ios', 'apple');
    }

    if (scripts.android) {
      pushScript(hints, seen, pm, 'android', 'android', 'expo-android', 'android');
    }

    if (!scripts.start) {
      pushHint(hints, seen, {
        id: 'expo-go',
        badge: 'expo',
        badgeIcon: 'expo',
        label: pmExec(pm, 'expo start'),
        command: `${pmExec(pm, 'expo start')}\n`,
      });
    }

    return hints;
  }

  if (isReactNative) {
    if (scripts.start) {
      pushScript(hints, seen, pm, 'start', 'metro', 'rn-start');
    }

    if (scripts.ios) {
      pushScript(hints, seen, pm, 'ios', 'ios', 'rn-ios', 'apple');
    } else {
      pushHint(hints, seen, {
        id: 'rn-ios',
        badge: 'ios',
        badgeIcon: 'apple',
        label: pmRun(pm, 'ios'),
        command: `${pmRun(pm, 'ios')}\n`,
      });
    }

    if (scripts.android) {
      pushScript(hints, seen, pm, 'android', 'android', 'rn-android', 'android');
    } else {
      pushHint(hints, seen, {
        id: 'rn-android',
        badge: 'android',
        badgeIcon: 'android',
        label: pmRun(pm, 'android'),
        command: `${pmRun(pm, 'android')}\n`,
      });
    }

    return hints;
  }

  if (isNuxt) {
    if (scripts.dev) {
      pushScript(hints, seen, pm, 'dev', 'dev', 'nuxt-dev');
    }

    if (scripts.build) {
      pushScript(hints, seen, pm, 'build', 'build', 'nuxt-build');
    }

    return hints;
  }

  if (isAngular) {
    if (scripts.start) {
      pushScript(hints, seen, pm, 'start', 'serve', 'ng-start');
    }

    if (scripts.build) {
      pushScript(hints, seen, pm, 'build', 'build', 'ng-build');
    }

    if (scripts.test) {
      pushScript(hints, seen, pm, 'test', 'test', 'ng-test');
    }

    return hints;
  }

  if (isRemix) {
    if (scripts.dev) {
      pushScript(hints, seen, pm, 'dev', 'dev', 'remix-dev');
    }

    if (scripts.build) {
      pushScript(hints, seen, pm, 'build', 'build', 'remix-build');
    }

    return hints;
  }

  if (isAstro) {
    if (scripts.dev) {
      pushScript(hints, seen, pm, 'dev', 'dev', 'astro-dev');
    }

    if (scripts.preview) {
      pushScript(hints, seen, pm, 'preview', 'preview', 'astro-preview');
    }

    return hints;
  }

  if (isSvelteKit) {
    if (scripts.dev) {
      pushScript(hints, seen, pm, 'dev', 'dev', 'svelte-dev');
    }

    if (scripts.check) {
      pushScript(hints, seen, pm, 'check', 'check', 'svelte-check');
    }

    return hints;
  }

  if (isElectron) {
    if (scripts.dev) {
      pushScript(hints, seen, pm, 'dev', 'dev', 'electron-dev');
    }

    if (scripts.build) {
      pushScript(hints, seen, pm, 'build', 'build', 'electron-build');
    }

    return hints;
  }

  if (isNest) {
    if (scripts.start) {
      pushScript(hints, seen, pm, 'start', 'api', 'nest-start');
    }

    if (scripts['start:dev']) {
      pushScript(hints, seen, pm, 'start:dev', 'dev', 'nest-dev');
    }

    if (scripts['start:debug']) {
      pushScript(hints, seen, pm, 'start:debug', 'debug', 'nest-debug');
    }

    return hints;
  }

  if (isTauri) {
    if (scripts.tauri) {
      pushScript(hints, seen, pm, 'tauri', 'tauri', 'tauri-cli');
    }

    if (scripts.dev) {
      pushScript(hints, seen, pm, 'dev', 'dev', 'tauri-dev');
    }

    return hints;
  }

  if (isVite) {
    if (scripts.dev) {
      pushScript(hints, seen, pm, 'dev', 'dev', 'vite-dev');
    }

    if (scripts.preview) {
      pushScript(hints, seen, pm, 'preview', 'preview', 'vite-preview');
    }

    if (scripts.build) {
      pushScript(hints, seen, pm, 'build', 'build', 'vite-build');
    }

    return hints;
  }

  if (isStorybook) {
    if (scripts.storybook) {
      pushScript(hints, seen, pm, 'storybook', 'story', 'storybook');
    }

    if (scripts['build-storybook']) {
      pushScript(hints, seen, pm, 'build-storybook', 'build', 'storybook-build');
    }
  }

  if (isPrisma) {
    pushHint(hints, seen, {
      id: 'prisma-studio',
      badge: 'db',
      label: pmExec(pm, 'prisma studio'),
      command: `${pmExec(pm, 'prisma studio')}\n`,
    });

    pushHint(hints, seen, {
      id: 'prisma-migrate',
      badge: 'db',
      label: pmExec(pm, 'prisma migrate dev'),
      command: `${pmExec(pm, 'prisma migrate dev')}\n`,
    });
  }

  if (isSupabase) {
    pushHint(hints, seen, {
      id: 'supabase-start',
      badge: 'sb',
      label: 'supabase start',
      command: 'supabase start\n',
    });

    pushHint(hints, seen, {
      id: 'supabase-status',
      badge: 'sb',
      label: 'supabase status',
      command: 'supabase status\n',
    });
  }

  if (scripts.dev) {
    pushScript(hints, seen, pm, 'dev', 'dev', 'generic-dev');
  } else if (scripts.start) {
    pushScript(hints, seen, pm, 'start', 'start', 'generic-start');
  }

  if (scripts.test) {
    pushScript(hints, seen, pm, 'test', 'test', 'generic-test');
  }

  if (scripts.lint) {
    pushScript(hints, seen, pm, 'lint', 'lint', 'generic-lint');
  }

  if (scripts.build) {
    pushScript(hints, seen, pm, 'build', 'build', 'generic-build');
  }

  return hints;
}

function buildRustHints(root: string, seen: Set<string>): TerminalCommandHint[] {
  if (!existsSync(path.join(root, 'Cargo.toml'))) {
    return [];
  }

  const hints: TerminalCommandHint[] = [];

  pushHint(hints, seen, {
    id: 'cargo-run',
    badge: 'run',
    label: 'cargo run',
    command: 'cargo run\n',
  });

  pushHint(hints, seen, {
    id: 'cargo-test',
    badge: 'test',
    label: 'cargo test',
    command: 'cargo test\n',
  });

  if (existsSync(path.join(root, 'src/main.rs')) || existsSync(path.join(root, 'src/lib.rs'))) {
    pushHint(hints, seen, {
      id: 'cargo-watch',
      badge: 'watch',
      label: 'cargo watch -x run',
      command: 'cargo watch -x run\n',
    });
  }

  return hints;
}

function buildGoHints(root: string, seen: Set<string>): TerminalCommandHint[] {
  if (!existsSync(path.join(root, 'go.mod'))) {
    return [];
  }

  const hints: TerminalCommandHint[] = [];

  pushHint(hints, seen, {
    id: 'go-run',
    badge: 'run',
    label: 'go run .',
    command: 'go run .\n',
  });

  pushHint(hints, seen, {
    id: 'go-test',
    badge: 'test',
    label: 'go test ./...',
    command: 'go test ./...\n',
  });

  return hints;
}

function buildPythonHints(root: string, seen: Set<string>): TerminalCommandHint[] {
  const hints: TerminalCommandHint[] = [];

  if (existsSync(path.join(root, 'manage.py'))) {
    pushHint(hints, seen, {
      id: 'django-run',
      badge: 'web',
      label: 'python manage.py runserver',
      command: 'python manage.py runserver\n',
    });

    pushHint(hints, seen, {
      id: 'django-migrate',
      badge: 'db',
      label: 'python manage.py migrate',
      command: 'python manage.py migrate\n',
    });
  }

  if (existsSync(path.join(root, 'pyproject.toml'))) {
    pushHint(hints, seen, {
      id: 'uvicorn',
      badge: 'api',
      label: 'uvicorn main:app --reload',
      command: 'uvicorn main:app --reload\n',
    });
  }

  return hints;
}

function buildDockerHints(root: string, seen: Set<string>): TerminalCommandHint[] {
  const composeFile = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].find(
    (name) => existsSync(path.join(root, name)),
  );

  if (!composeFile) {
    return [];
  }

  const hints: TerminalCommandHint[] = [];

  pushHint(hints, seen, {
    id: 'docker-up',
    badge: 'up',
    label: 'docker compose up',
    command: 'docker compose up\n',
  });

  pushHint(hints, seen, {
    id: 'docker-up-d',
    badge: 'up',
    label: 'docker compose up -d',
    command: 'docker compose up -d\n',
  });

  pushHint(hints, seen, {
    id: 'docker-logs',
    badge: 'logs',
    label: 'docker compose logs -f',
    command: 'docker compose logs -f\n',
  });

  return hints;
}

function buildProjectHints(root: string, seen: Set<string>): TerminalCommandHint[] {
  if (existsSync(path.join(root, 'package.json'))) {
    const pm = detectPackageManager(root);
    return buildNodeProjectHints(root, pm, seen);
  }

  return [
    ...buildRustHints(root, seen),
    ...buildGoHints(root, seen),
    ...buildPythonHints(root, seen),
    ...buildDockerHints(root, seen),
  ];
}

export function getTerminalHints(cwd: string): TerminalCommandHint[] {
  const resolvedCwd = path.resolve(cwd);
  const seen = new Set<string>();
  const hints: TerminalCommandHint[] = [];
  const projectRoot = findProjectRoot(resolvedCwd);

  hints.push(...buildCliAgentHints(seen));

  if (projectRoot) {
    hints.push(...buildProjectHints(projectRoot, seen));
  }

  return hints.slice(0, MAX_TOTAL_HINTS);
}

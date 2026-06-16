import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type ProjectKind = 'web' | 'mobile' | 'api';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
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

function detectNodeProjectKind(root: string, pkg: PackageJson): ProjectKind | null {
  const isExpo = hasDep(pkg, 'expo') || hasFile(root, ['app.json', 'app.config.js', 'app.config.ts']);
  const isReactNative =
    hasDep(pkg, 'react-native') && hasFile(root, ['android', 'ios']) && !isExpo;

  if (isExpo || isReactNative) {
    return 'mobile';
  }

  if (hasDep(pkg, '@nestjs/core')) {
    return 'api';
  }

  const isWeb =
    hasDep(pkg, 'next') ||
    hasDep(pkg, 'vite') ||
    hasDep(pkg, 'nuxt') ||
    hasDep(pkg, '@angular/core') ||
    hasDep(pkg, '@remix-run/node') ||
    hasDep(pkg, '@remix-run/react') ||
    hasDep(pkg, 'astro') ||
    hasDep(pkg, '@sveltejs/kit') ||
    hasDep(pkg, 'electron') ||
    hasDep(pkg, 'react') ||
    hasDep(pkg, 'react-dom') ||
    hasDep(pkg, 'vue') ||
    hasFile(root, [
      'next.config.js',
      'next.config.mjs',
      'next.config.ts',
      'vite.config.ts',
      'vite.config.js',
      'vite.config.mts',
      'nuxt.config.ts',
      'angular.json',
    ]);

  if (isWeb) {
    return 'web';
  }

  const isApi =
    hasDep(pkg, 'express') ||
    hasDep(pkg, 'fastify') ||
    hasDep(pkg, 'koa') ||
    hasDep(pkg, '@hono/node-server') ||
    hasDep(pkg, 'hono');

  if (isApi) {
    return 'api';
  }

  return null;
}

export function detectProjectKind(dirPath: string): ProjectKind | null {
  const root = path.resolve(dirPath);

  if (existsSync(path.join(root, 'package.json'))) {
    const pkg = readPackageJson(root);

    if (pkg) {
      return detectNodeProjectKind(root, pkg);
    }
  }

  if (existsSync(path.join(root, 'go.mod'))) {
    return 'api';
  }

  if (existsSync(path.join(root, 'manage.py'))) {
    return 'api';
  }

  if (existsSync(path.join(root, 'pyproject.toml'))) {
    return 'api';
  }

  return null;
}

export function detectProjectKinds(dirPaths: string[]): Record<string, ProjectKind | null> {
  const result: Record<string, ProjectKind | null> = {};

  for (const dirPath of dirPaths) {
    result[dirPath] = detectProjectKind(dirPath);
  }

  return result;
}

export function projectKindBadgeLabel(kind: ProjectKind): string {
  if (kind === 'mobile') {
    return 'APP';
  }

  return kind.toUpperCase();
}

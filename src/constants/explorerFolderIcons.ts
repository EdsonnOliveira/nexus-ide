import logoAndroid from '@/assets/logo-android.svg';
import logoApple from '@/assets/logo-apple.svg';
import logoElectron from '@/assets/logo-electron.svg';
import logoExpo from '@/assets/logo-expo.svg';
import logoSupabase from '@/assets/logo-supabase.svg';
import logoTailwind from '@/assets/logo-tailwindcss.svg';
import logoVite from '@/assets/logo-vite.svg';

export type ExplorerBrandFolderIcon =
  | 'android'
  | 'apple'
  | 'electron'
  | 'expo'
  | 'supabase'
  | 'tailwind'
  | 'vite';

export type ExplorerLucideFolderIcon =
  | 'api'
  | 'app'
  | 'assets'
  | 'bin'
  | 'components'
  | 'config'
  | 'constants'
  | 'context'
  | 'controllers'
  | 'coverage'
  | 'docs'
  | 'domain'
  | 'e2e'
  | 'features'
  | 'fixtures'
  | 'fonts'
  | 'functions'
  | 'helpers'
  | 'hooks'
  | 'images'
  | 'infra'
  | 'jobs'
  | 'layouts'
  | 'lib'
  | 'locales'
  | 'middleware'
  | 'migrations'
  | 'models'
  | 'modules'
  | 'mocks'
  | 'pages'
  | 'plugins'
  | 'providers'
  | 'public'
  | 'routes'
  | 'scripts'
  | 'seeds'
  | 'server'
  | 'services'
  | 'shared'
  | 'src'
  | 'stores'
  | 'styles'
  | 'test'
  | 'tools'
  | 'types'
  | 'utils'
  | 'views'
  | 'workers';

export type ExplorerFolderIconDescriptor =
  | { kind: 'brand'; id: ExplorerBrandFolderIcon }
  | { kind: 'lucide'; id: ExplorerLucideFolderIcon }
  | { kind: 'default' };

export const EXPLORER_BRAND_ICONS: Record<ExplorerBrandFolderIcon, string> = {
  android: logoAndroid,
  apple: logoApple,
  electron: logoElectron,
  expo: logoExpo,
  supabase: logoSupabase,
  tailwind: logoTailwind,
  vite: logoVite,
};

const EXPLORER_BRAND_COLORS: Partial<Record<ExplorerBrandFolderIcon, string>> = {
  android: '#3ddc84',
  apple: '#a2aaad',
  expo: '#7c3aed',
  supabase: '#3ecf8e',
};

const EXACT_FOLDER_ICONS: Record<string, ExplorerFolderIconDescriptor> = {
  android: { kind: 'brand', id: 'android' },
  ios: { kind: 'brand', id: 'apple' },
  apple: { kind: 'brand', id: 'apple' },
  expo: { kind: 'brand', id: 'expo' },
  supabase: { kind: 'brand', id: 'supabase' },
  vite: { kind: 'brand', id: 'vite' },
  tailwind: { kind: 'brand', id: 'tailwind' },
  tailwindcss: { kind: 'brand', id: 'tailwind' },
  electron: { kind: 'brand', id: 'electron' },
  app: { kind: 'lucide', id: 'app' },
  apps: { kind: 'lucide', id: 'app' },
  application: { kind: 'lucide', id: 'app' },
  applications: { kind: 'lucide', id: 'app' },
  assets: { kind: 'lucide', id: 'assets' },
  static: { kind: 'lucide', id: 'assets' },
  media: { kind: 'lucide', id: 'assets' },
  components: { kind: 'lucide', id: 'components' },
  component: { kind: 'lucide', id: 'components' },
  ui: { kind: 'lucide', id: 'components' },
  constants: { kind: 'lucide', id: 'constants' },
  constant: { kind: 'lucide', id: 'constants' },
  context: { kind: 'lucide', id: 'context' },
  contexts: { kind: 'lucide', id: 'context' },
  docs: { kind: 'lucide', id: 'docs' },
  doc: { kind: 'lucide', id: 'docs' },
  documentation: { kind: 'lucide', id: 'docs' },
  e2e: { kind: 'lucide', id: 'e2e' },
  hooks: { kind: 'lucide', id: 'hooks' },
  hook: { kind: 'lucide', id: 'hooks' },
  lib: { kind: 'lucide', id: 'lib' },
  libs: { kind: 'lucide', id: 'lib' },
  library: { kind: 'lucide', id: 'lib' },
  libraries: { kind: 'lucide', id: 'lib' },
  modules: { kind: 'lucide', id: 'modules' },
  module: { kind: 'lucide', id: 'modules' },
  plugins: { kind: 'lucide', id: 'plugins' },
  plugin: { kind: 'lucide', id: 'plugins' },
  scripts: { kind: 'lucide', id: 'scripts' },
  script: { kind: 'lucide', id: 'scripts' },
  stores: { kind: 'lucide', id: 'stores' },
  store: { kind: 'lucide', id: 'stores' },
  state: { kind: 'lucide', id: 'stores' },
  api: { kind: 'lucide', id: 'api' },
  apis: { kind: 'lucide', id: 'api' },
  config: { kind: 'lucide', id: 'config' },
  configs: { kind: 'lucide', id: 'config' },
  configuration: { kind: 'lucide', id: 'config' },
  public: { kind: 'lucide', id: 'public' },
  src: { kind: 'lucide', id: 'src' },
  source: { kind: 'lucide', id: 'src' },
  sources: { kind: 'lucide', id: 'src' },
  test: { kind: 'lucide', id: 'test' },
  tests: { kind: 'lucide', id: 'test' },
  testing: { kind: 'lucide', id: 'test' },
  spec: { kind: 'lucide', id: 'test' },
  specs: { kind: 'lucide', id: 'test' },
  __tests__: { kind: 'lucide', id: 'test' },
  utils: { kind: 'lucide', id: 'utils' },
  util: { kind: 'lucide', id: 'utils' },
  utilities: { kind: 'lucide', id: 'utils' },
  helpers: { kind: 'lucide', id: 'helpers' },
  helper: { kind: 'lucide', id: 'helpers' },
  types: { kind: 'lucide', id: 'types' },
  typings: { kind: 'lucide', id: 'types' },
  interfaces: { kind: 'lucide', id: 'types' },
  pages: { kind: 'lucide', id: 'pages' },
  page: { kind: 'lucide', id: 'pages' },
  views: { kind: 'lucide', id: 'views' },
  view: { kind: 'lucide', id: 'views' },
  layouts: { kind: 'lucide', id: 'layouts' },
  layout: { kind: 'lucide', id: 'layouts' },
  routes: { kind: 'lucide', id: 'routes' },
  route: { kind: 'lucide', id: 'routes' },
  routing: { kind: 'lucide', id: 'routes' },
  server: { kind: 'lucide', id: 'server' },
  servers: { kind: 'lucide', id: 'server' },
  services: { kind: 'lucide', id: 'services' },
  service: { kind: 'lucide', id: 'services' },
  models: { kind: 'lucide', id: 'models' },
  model: { kind: 'lucide', id: 'models' },
  controllers: { kind: 'lucide', id: 'controllers' },
  controller: { kind: 'lucide', id: 'controllers' },
  middleware: { kind: 'lucide', id: 'middleware' },
  middlewares: { kind: 'lucide', id: 'middleware' },
  providers: { kind: 'lucide', id: 'providers' },
  provider: { kind: 'lucide', id: 'providers' },
  features: { kind: 'lucide', id: 'features' },
  feature: { kind: 'lucide', id: 'features' },
  domain: { kind: 'lucide', id: 'domain' },
  infra: { kind: 'lucide', id: 'infra' },
  infrastructure: { kind: 'lucide', id: 'infra' },
  shared: { kind: 'lucide', id: 'shared' },
  common: { kind: 'lucide', id: 'shared' },
  styles: { kind: 'lucide', id: 'styles' },
  style: { kind: 'lucide', id: 'styles' },
  css: { kind: 'lucide', id: 'styles' },
  scss: { kind: 'lucide', id: 'styles' },
  fonts: { kind: 'lucide', id: 'fonts' },
  font: { kind: 'lucide', id: 'fonts' },
  images: { kind: 'lucide', id: 'images' },
  img: { kind: 'lucide', id: 'images' },
  icons: { kind: 'lucide', id: 'images' },
  locales: { kind: 'lucide', id: 'locales' },
  locale: { kind: 'lucide', id: 'locales' },
  i18n: { kind: 'lucide', id: 'locales' },
  l10n: { kind: 'lucide', id: 'locales' },
  translations: { kind: 'lucide', id: 'locales' },
  migrations: { kind: 'lucide', id: 'migrations' },
  migration: { kind: 'lucide', id: 'migrations' },
  functions: { kind: 'lucide', id: 'functions' },
  function: { kind: 'lucide', id: 'functions' },
  workers: { kind: 'lucide', id: 'workers' },
  worker: { kind: 'lucide', id: 'workers' },
  jobs: { kind: 'lucide', id: 'jobs' },
  job: { kind: 'lucide', id: 'jobs' },
  queues: { kind: 'lucide', id: 'jobs' },
  queue: { kind: 'lucide', id: 'jobs' },
  tools: { kind: 'lucide', id: 'tools' },
  tool: { kind: 'lucide', id: 'tools' },
  bin: { kind: 'lucide', id: 'bin' },
  fixtures: { kind: 'lucide', id: 'fixtures' },
  fixture: { kind: 'lucide', id: 'fixtures' },
  mocks: { kind: 'lucide', id: 'mocks' },
  mock: { kind: 'lucide', id: 'mocks' },
  seeds: { kind: 'lucide', id: 'seeds' },
  seed: { kind: 'lucide', id: 'seeds' },
  coverage: { kind: 'lucide', id: 'coverage' },
  cypress: { kind: 'lucide', id: 'e2e' },
  playwright: { kind: 'lucide', id: 'e2e' },
  github: { kind: 'lucide', id: 'tools' },
  gitlab: { kind: 'lucide', id: 'tools' },
};

const PARTIAL_FOLDER_ICONS: Array<{ pattern: string; icon: ExplorerFolderIconDescriptor }> = [
  { pattern: 'supabase', icon: { kind: 'brand', id: 'supabase' } },
  { pattern: 'android', icon: { kind: 'brand', id: 'android' } },
  { pattern: 'tailwind', icon: { kind: 'brand', id: 'tailwind' } },
  { pattern: 'electron', icon: { kind: 'brand', id: 'electron' } },
  { pattern: 'components', icon: { kind: 'lucide', id: 'components' } },
  { pattern: 'constants', icon: { kind: 'lucide', id: 'constants' } },
  { pattern: 'context', icon: { kind: 'lucide', id: 'context' } },
  { pattern: 'documentation', icon: { kind: 'lucide', id: 'docs' } },
  { pattern: 'middleware', icon: { kind: 'lucide', id: 'middleware' } },
  { pattern: 'controllers', icon: { kind: 'lucide', id: 'controllers' } },
  { pattern: 'providers', icon: { kind: 'lucide', id: 'providers' } },
  { pattern: 'migrations', icon: { kind: 'lucide', id: 'migrations' } },
  { pattern: 'translations', icon: { kind: 'lucide', id: 'locales' } },
  { pattern: 'utilities', icon: { kind: 'lucide', id: 'utils' } },
  { pattern: 'helpers', icon: { kind: 'lucide', id: 'helpers' } },
  { pattern: 'fixtures', icon: { kind: 'lucide', id: 'fixtures' } },
  { pattern: 'playwright', icon: { kind: 'lucide', id: 'e2e' } },
  { pattern: 'modules', icon: { kind: 'lucide', id: 'modules' } },
  { pattern: 'plugins', icon: { kind: 'lucide', id: 'plugins' } },
  { pattern: 'scripts', icon: { kind: 'lucide', id: 'scripts' } },
  { pattern: 'stores', icon: { kind: 'lucide', id: 'stores' } },
  { pattern: 'assets', icon: { kind: 'lucide', id: 'assets' } },
  { pattern: 'hooks', icon: { kind: 'lucide', id: 'hooks' } },
  { pattern: 'services', icon: { kind: 'lucide', id: 'services' } },
  { pattern: 'layouts', icon: { kind: 'lucide', id: 'layouts' } },
  { pattern: 'routes', icon: { kind: 'lucide', id: 'routes' } },
  { pattern: 'functions', icon: { kind: 'lucide', id: 'functions' } },
  { pattern: 'workers', icon: { kind: 'lucide', id: 'workers' } },
  { pattern: 'features', icon: { kind: 'lucide', id: 'features' } },
  { pattern: 'images', icon: { kind: 'lucide', id: 'images' } },
  { pattern: 'locales', icon: { kind: 'lucide', id: 'locales' } },
  { pattern: 'coverage', icon: { kind: 'lucide', id: 'coverage' } },
  { pattern: 'expo', icon: { kind: 'brand', id: 'expo' } },
  { pattern: 'vite', icon: { kind: 'brand', id: 'vite' } },
  { pattern: 'ios', icon: { kind: 'brand', id: 'apple' } },
  { pattern: 'docs', icon: { kind: 'lucide', id: 'docs' } },
  { pattern: 'lib', icon: { kind: 'lucide', id: 'lib' } },
  { pattern: 'api', icon: { kind: 'lucide', id: 'api' } },
  { pattern: 'app', icon: { kind: 'lucide', id: 'app' } },
  { pattern: 'src', icon: { kind: 'lucide', id: 'src' } },
  { pattern: 'test', icon: { kind: 'lucide', id: 'test' } },
  { pattern: 'utils', icon: { kind: 'lucide', id: 'utils' } },
  { pattern: 'types', icon: { kind: 'lucide', id: 'types' } },
  { pattern: 'pages', icon: { kind: 'lucide', id: 'pages' } },
  { pattern: 'views', icon: { kind: 'lucide', id: 'views' } },
  { pattern: 'server', icon: { kind: 'lucide', id: 'server' } },
  { pattern: 'models', icon: { kind: 'lucide', id: 'models' } },
  { pattern: 'styles', icon: { kind: 'lucide', id: 'styles' } },
  { pattern: 'fonts', icon: { kind: 'lucide', id: 'fonts' } },
  { pattern: 'tools', icon: { kind: 'lucide', id: 'tools' } },
  { pattern: 'jobs', icon: { kind: 'lucide', id: 'jobs' } },
  { pattern: 'mocks', icon: { kind: 'lucide', id: 'mocks' } },
  { pattern: 'seeds', icon: { kind: 'lucide', id: 'seeds' } },
  { pattern: 'shared', icon: { kind: 'lucide', id: 'shared' } },
  { pattern: 'config', icon: { kind: 'lucide', id: 'config' } },
  { pattern: 'public', icon: { kind: 'lucide', id: 'public' } },
  { pattern: 'infra', icon: { kind: 'lucide', id: 'infra' } },
  { pattern: 'domain', icon: { kind: 'lucide', id: 'domain' } },
  { pattern: 'e2e', icon: { kind: 'lucide', id: 'e2e' } },
];

function normalizeFolderKeys(folderName: string): string[] {
  const lower = folderName.toLowerCase();
  const stripped = lower.replace(/^\.+/, '');
  const compact = stripped.replace(/[-_]/g, '');

  return [...new Set([lower, stripped, compact])];
}

export function resolveExplorerFolderIcon(folderName: string): ExplorerFolderIconDescriptor {
  const keys = normalizeFolderKeys(folderName);

  for (const key of keys) {
    const exact = EXACT_FOLDER_ICONS[key];

    if (exact) {
      return exact;
    }
  }

  let bestMatch: { score: number; icon: ExplorerFolderIconDescriptor } | null = null;

  for (const entry of PARTIAL_FOLDER_ICONS) {
    for (const key of keys) {
      if (!key.includes(entry.pattern)) {
        continue;
      }

      const score = entry.pattern.length;

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { score, icon: entry.icon };
      }
    }
  }

  return bestMatch?.icon ?? { kind: 'default' };
}

export function getExplorerBrandIconColor(id: ExplorerBrandFolderIcon): string | undefined {
  return EXPLORER_BRAND_COLORS[id];
}

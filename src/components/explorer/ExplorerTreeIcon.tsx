import {
  AppWindow,
  BookOpen,
  Boxes,
  Code2,
  Database,
  File,
  FileCode,
  FileJson,
  FileStack,
  FlaskConical,
  Folder,
  Globe,
  Hash,
  Image,
  Languages,
  Layers,
  Library,
  Link2,
  Package,
  Puzzle,
  Server,
  Settings,
  Share2,
  TerminalSquare,
  TestTube,
  Type,
  Wrench,
} from 'lucide-react';
import { useMemo, type ComponentType } from 'react';
import {
  EXPLORER_BRAND_ICONS,
  getExplorerBrandIconColor,
  resolveExplorerFolderIcon,
  type ExplorerLucideFolderIcon,
} from '@/constants/explorerFolderIcons';

export type ExplorerFileIconVariant = 'folder' | 'react' | 'javascript' | 'css' | 'json' | 'generic';

const EXPLORER_LUCIDE_FOLDER_ICONS: Record<
  ExplorerLucideFolderIcon,
  ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
> = {
  api: Server,
  app: AppWindow,
  assets: Image,
  bin: TerminalSquare,
  components: Boxes,
  config: Settings,
  constants: Hash,
  context: Layers,
  controllers: Share2,
  coverage: FlaskConical,
  docs: BookOpen,
  domain: Package,
  e2e: TestTube,
  features: Puzzle,
  fixtures: FileStack,
  fonts: Type,
  functions: Code2,
  helpers: Wrench,
  hooks: Link2,
  images: Image,
  infra: Server,
  jobs: TerminalSquare,
  layouts: Layers,
  lib: Library,
  locales: Languages,
  middleware: Share2,
  migrations: Database,
  models: Database,
  modules: Package,
  mocks: FlaskConical,
  pages: FileStack,
  plugins: Puzzle,
  providers: Share2,
  public: Globe,
  routes: Share2,
  scripts: TerminalSquare,
  seeds: Database,
  server: Server,
  services: Server,
  shared: Boxes,
  src: Code2,
  stores: Database,
  styles: Type,
  test: TestTube,
  tools: Wrench,
  types: Type,
  utils: Wrench,
  views: FileStack,
  workers: TerminalSquare,
};

export function getExplorerFileIconVariant(
  name: string,
  type: 'file' | 'directory',
): ExplorerFileIconVariant {
  if (type === 'directory') {
    return 'folder';
  }

  const extension = name.split('.').pop()?.toLowerCase() ?? '';

  if (extension === 'tsx' || extension === 'jsx') {
    return 'react';
  }

  if (extension === 'ts' || extension === 'js' || extension === 'mjs' || extension === 'cjs') {
    return 'javascript';
  }

  if (extension === 'css' || extension === 'scss' || extension === 'sass') {
    return 'css';
  }

  if (extension === 'json') {
    return 'json';
  }

  return 'generic';
}

export function ExplorerDirectoryIcon({ folderName }: { folderName: string }) {
  const descriptor = useMemo(() => resolveExplorerFolderIcon(folderName), [folderName]);

  if (descriptor.kind === 'brand') {
    const brandColor = getExplorerBrandIconColor(descriptor.id);
    const iconSrc = EXPLORER_BRAND_ICONS[descriptor.id];

    if (brandColor) {
      return (
        <span
          aria-hidden='true'
          className='project-explorer__brand-icon project-explorer__brand-icon--mono'
          style={{
            backgroundColor: brandColor,
            WebkitMaskImage: `url("${iconSrc}")`,
            maskImage: `url("${iconSrc}")`,
          }}
        />
      );
    }

    return (
      <img
        src={iconSrc}
        alt=''
        className='project-explorer__brand-icon'
        draggable={false}
      />
    );
  }

  if (descriptor.kind === 'lucide') {
    const Icon = EXPLORER_LUCIDE_FOLDER_ICONS[descriptor.id];

    if (!Icon) {
      return <Folder size={14} strokeWidth={2} className='project-explorer__icon project-explorer__icon--folder' />;
    }

    return (
      <Icon
        size={14}
        strokeWidth={2}
        className={`project-explorer__icon project-explorer__icon--directory project-explorer__icon--${descriptor.id}`}
      />
    );
  }

  return <Folder size={14} strokeWidth={2} className='project-explorer__icon project-explorer__icon--folder' />;
}

export function ExplorerFileIcon({ variant }: { variant: ExplorerFileIconVariant }) {
  if (variant === 'folder') {
    return <Folder size={14} strokeWidth={2} className='project-explorer__icon project-explorer__icon--folder' />;
  }

  if (variant === 'json') {
    return <FileJson size={14} strokeWidth={2} className='project-explorer__icon project-explorer__icon--json' />;
  }

  if (variant === 'generic') {
    return <File size={14} strokeWidth={2} className='project-explorer__icon project-explorer__icon--generic' />;
  }

  return (
    <FileCode
      size={14}
      strokeWidth={2}
      className={`project-explorer__icon project-explorer__icon--${variant}`}
    />
  );
}

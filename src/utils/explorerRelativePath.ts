export function toProjectRelativePath(rootPath: string, entryPath: string): string {
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedEntry = entryPath.replace(/\\/g, '/');

  if (normalizedEntry === normalizedRoot) {
    return '.';
  }

  const rootPrefix = `${normalizedRoot}/`;

  if (normalizedEntry.startsWith(rootPrefix)) {
    return normalizedEntry.slice(rootPrefix.length);
  }

  return normalizedEntry;
}

export function getProjectRootFolderName(rootPath: string): string {
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const segments = normalizedRoot.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

export function toProjectDisplayPath(rootPath: string, entryPath: string): string {
  const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const rootName = getProjectRootFolderName(normalizedRoot);
  const normalizedEntry = entryPath.replace(/\\/g, '/').trim();

  if (!normalizedEntry) {
    return rootName;
  }

  let relative = toProjectRelativePath(normalizedRoot, normalizedEntry);

  if (relative === normalizedEntry) {
    const homeMatch = normalizedRoot.match(/^(\/Users\/[^/]+|\/home\/[^/]+)/);
    const home = homeMatch?.[1] ?? null;
    const expandedEntry =
      home && (normalizedEntry === '~' || normalizedEntry.startsWith('~/'))
        ? normalizedEntry === '~'
          ? home
          : `${home}${normalizedEntry.slice(1)}`
        : normalizedEntry;

    relative = toProjectRelativePath(normalizedRoot, expandedEntry);

    if (relative === expandedEntry && rootName) {
      const marker = `/${rootName}/`;
      const markerIndex = expandedEntry.indexOf(marker);

      if (markerIndex >= 0) {
        relative = expandedEntry.slice(markerIndex + marker.length);
      }
    }
  }

  if (!rootName) {
    return relative === '.' ? normalizedEntry : relative;
  }

  if (relative === '.' || relative === '') {
    return rootName;
  }

  if (relative === rootName || relative.startsWith(`${rootName}/`)) {
    return relative;
  }

  return `${rootName}/${relative}`;
}

export function getRevealInFolderLabel(): string {
  if (navigator.platform.toLowerCase().includes('mac')) {
    return 'Abrir no Finder';
  }

  if (navigator.userAgent.toLowerCase().includes('windows')) {
    return 'Abrir no Explorador de Arquivos';
  }

  return 'Abrir no gerenciador de arquivos';
}

export function isMarkdownFile(name: string): boolean {
  return name.toLowerCase().endsWith('.md');
}

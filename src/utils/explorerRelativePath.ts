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

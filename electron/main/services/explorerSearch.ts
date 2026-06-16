import { listDirectoryEntries, type DirectoryEntry } from './directoryListing';

export interface ExplorerSearchOptions {
  matchCase: boolean;
  matchWholeWord: boolean;
  useRegex: boolean;
}

export interface ExplorerSearchNode extends DirectoryEntry {
  children?: ExplorerSearchNode[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchesExplorerName(
  name: string,
  query: string,
  options: ExplorerSearchOptions,
): boolean {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return true;
  }

  if (options.useRegex) {
    try {
      const flags = options.matchCase ? '' : 'i';
      return new RegExp(trimmedQuery, flags).test(name);
    } catch {
      return false;
    }
  }

  if (options.matchWholeWord) {
    const pattern = options.matchCase
      ? new RegExp(`\\b${escapeRegExp(trimmedQuery)}\\b`)
      : new RegExp(`\\b${escapeRegExp(trimmedQuery)}\\b`, 'i');

    return pattern.test(name);
  }

  if (options.matchCase) {
    return name.includes(trimmedQuery);
  }

  return name.toLowerCase().includes(trimmedQuery.toLowerCase());
}

export function searchProjectTree(
  rootPath: string,
  query: string,
  options: ExplorerSearchOptions,
): ExplorerSearchNode[] {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return [];
  }

  function walk(dirPath: string): ExplorerSearchNode[] {
    const entries = listDirectoryEntries(dirPath);
    const nodes: ExplorerSearchNode[] = [];

    for (const entry of entries) {
      if (entry.type === 'directory') {
        const childNodes = walk(entry.path);
        const selfMatches = matchesExplorerName(entry.name, trimmedQuery, options);

        if (selfMatches || childNodes.length > 0) {
          nodes.push({
            ...entry,
            children: childNodes,
          });
        }

        continue;
      }

      if (matchesExplorerName(entry.name, trimmedQuery, options)) {
        nodes.push({ ...entry });
      }
    }

    return nodes;
  }

  return walk(rootPath);
}

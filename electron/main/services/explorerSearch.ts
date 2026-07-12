import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { rgPath } from '@vscode/ripgrep';
import { listDirectoryEntries, type DirectoryEntry } from './directoryListing';

export interface ExplorerSearchOptions {
  matchCase: boolean;
  matchWholeWord: boolean;
  useRegex: boolean;
}

export interface ExplorerSearchLineMatch {
  lineNumber: number;
  preview: string;
  submatches: Array<{ start: number; end: number }>;
}

export interface ExplorerSearchNode extends DirectoryEntry {
  children?: ExplorerSearchNode[];
  contentMatches?: ExplorerSearchLineMatch[];
}

const IGNORED_DIRECTORY_NAMES = new Set([
  '.cxx',
  '.expo',
  '.git',
  '.gradle',
  '.hg',
  '.kotlin',
  '.nexus',
  '.svn',
  '__pycache__',
  'DerivedData',
  'Pods',
  'coverage',
  'dist',
  'dist-electron',
  'node_modules',
  'release',
]);

const MAX_CONTENT_MATCH_FILES = 400;
const MAX_CONTENT_FILE_BYTES = 1024 * 1024;
const MAX_MATCHES_PER_FILE = 20;
const MAX_TOTAL_LINE_MATCHES = 400;

let contentSearchGeneration = 0;
let activeContentSearch: ChildProcessWithoutNullStreams | null = null;

interface RipgrepSubmatch {
  match: { text: string };
  start: number;
  end: number;
}

interface RipgrepMatchData {
  path: { text: string };
  lines: { text: string };
  line_number: number;
  submatches: RipgrepSubmatch[];
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

function findLineHighlightRanges(
  line: string,
  query: string,
  options: ExplorerSearchOptions,
): Array<{ start: number; end: number }> {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return [];
  }

  const ranges: Array<{ start: number; end: number }> = [];

  if (options.useRegex) {
    try {
      const flags = options.matchCase ? 'g' : 'gi';
      const regex = new RegExp(trimmedQuery, flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(line)) !== null) {
        ranges.push({
          start: match.index,
          end: match.index + match[0].length,
        });

        if (match[0].length === 0) {
          regex.lastIndex += 1;
        }
      }
    } catch {
      return [];
    }

    return ranges;
  }

  if (options.matchWholeWord) {
    const pattern = options.matchCase
      ? new RegExp(`\\b${escapeRegExp(trimmedQuery)}\\b`, 'g')
      : new RegExp(`\\b${escapeRegExp(trimmedQuery)}\\b`, 'gi');
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(line)) !== null) {
      ranges.push({
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    return ranges;
  }

  if (options.matchCase) {
    let cursor = 0;

    while (cursor < line.length) {
      const index = line.indexOf(trimmedQuery, cursor);

      if (index === -1) {
        break;
      }

      ranges.push({
        start: index,
        end: index + trimmedQuery.length,
      });

      cursor = index + trimmedQuery.length;
    }

    return ranges;
  }

  const lowerLine = line.toLowerCase();
  const lowerQuery = trimmedQuery.toLowerCase();
  let cursor = 0;

  while (cursor < lowerLine.length) {
    const index = lowerLine.indexOf(lowerQuery, cursor);

    if (index === -1) {
      break;
    }

    ranges.push({
      start: index,
      end: index + trimmedQuery.length,
    });

    cursor = index + trimmedQuery.length;
  }

  return ranges;
}

function searchProjectTreeByName(
  rootPath: string,
  query: string,
  options: ExplorerSearchOptions,
): ExplorerSearchNode[] {
  function walk(dirPath: string): ExplorerSearchNode[] {
    const entries = listDirectoryEntries(dirPath);
    const nodes: ExplorerSearchNode[] = [];

    for (const entry of entries) {
      if (entry.type === 'directory') {
        const childNodes = walk(entry.path);
        const selfMatches = matchesExplorerName(entry.name, query, options);

        if (selfMatches || childNodes.length > 0) {
          nodes.push({
            ...entry,
            children: childNodes,
          });
        }

        continue;
      }

      if (matchesExplorerName(entry.name, query, options)) {
        nodes.push({ ...entry });
      }
    }

    return nodes;
  }

  return walk(rootPath);
}

function collectFilePaths(nodes: ExplorerSearchNode[]): Set<string> {
  const paths = new Set<string>();

  function walk(entries: ExplorerSearchNode[]): void {
    for (const entry of entries) {
      if (entry.type === 'file') {
        paths.add(entry.path);
        continue;
      }

      if (entry.children) {
        walk(entry.children);
      }
    }
  }

  walk(nodes);
  return paths;
}

function sortSearchNodes(nodes: ExplorerSearchNode[]): ExplorerSearchNode[] {
  return nodes
    .map((node) =>
      node.children
        ? {
            ...node,
            children: sortSearchNodes(node.children),
          }
        : node,
    )
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === 'directory' ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
}

function insertFilePathIntoTree(
  nodes: ExplorerSearchNode[],
  rootPath: string,
  filePath: string,
): ExplorerSearchNode | null {
  const relativePath = path.relative(rootPath, filePath);

  if (!relativePath || relativePath.startsWith('..')) {
    return null;
  }

  const segments = relativePath.split(path.sep);
  let currentNodes = nodes;
  let currentPath = rootPath;
  let insertedNode: ExplorerSearchNode | null = null;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isFile = index === segments.length - 1;
    const fullPath = path.join(currentPath, segment);
    let node = currentNodes.find((entry) => entry.path === fullPath);

    if (!node) {
      node = {
        name: segment,
        path: fullPath,
        type: isFile ? 'file' : 'directory',
        ...(isFile ? {} : { children: [] }),
      };
      currentNodes.push(node);
    }

    if (isFile) {
      insertedNode = node;
      return insertedNode;
    }

    if (!node.children) {
      node.children = [];
    }

    currentNodes = node.children;
    currentPath = fullPath;
  }

  return insertedNode;
}

function buildRipgrepArgs(
  rootPath: string,
  query: string,
  options: ExplorerSearchOptions,
): string[] | null {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return null;
  }

  const args = [
    '--json',
    '--no-heading',
    '--color',
    'never',
    '--max-filesize',
    String(MAX_CONTENT_FILE_BYTES),
    '--max-count',
    String(MAX_MATCHES_PER_FILE),
    '--max-columns-preview',
    '220',
  ];

  for (const directoryName of IGNORED_DIRECTORY_NAMES) {
    args.push('--glob', `!**/${directoryName}/**`);
  }

  if (!options.matchCase) {
    args.push('--ignore-case');
  }

  if (options.matchWholeWord) {
    args.push('--word-regexp');
  }

  if (options.useRegex) {
    try {
      const flags = options.matchCase ? '' : 'i';
      new RegExp(trimmedQuery, flags);
    } catch {
      return null;
    }

    args.push('--regexp', trimmedQuery);
  } else {
    args.push('--fixed-strings', trimmedQuery);
  }

  args.push(rootPath);
  return args;
}

function normalizePreviewText(text: string): string {
  return text.replace(/\r?\n$/, '');
}

function searchProjectContent(
  rootPath: string,
  query: string,
  options: ExplorerSearchOptions,
): Promise<Map<string, ExplorerSearchLineMatch[]>> {
  const args = buildRipgrepArgs(rootPath, query, options);

  if (!args) {
    return Promise.resolve(new Map());
  }

  const generation = contentSearchGeneration + 1;
  contentSearchGeneration = generation;

  if (activeContentSearch) {
    activeContentSearch.kill();
    activeContentSearch = null;
  }

  return new Promise((resolve) => {
    const child = spawn(rgPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    activeContentSearch = child;

    const matchesByFile = new Map<string, ExplorerSearchLineMatch[]>();
    const matchedFilePaths = new Set<string>();
    let totalMatches = 0;
    let pendingLine = '';

    const pushMatch = (data: RipgrepMatchData): void => {
      if (totalMatches >= MAX_TOTAL_LINE_MATCHES) {
        child.kill();
        return;
      }

      const filePath = path.resolve(data.path.text);

      if (matchedFilePaths.size >= MAX_CONTENT_MATCH_FILES && !matchedFilePaths.has(filePath)) {
        child.kill();
        return;
      }

      const fileMatches = matchesByFile.get(filePath) ?? [];

      if (fileMatches.length >= MAX_MATCHES_PER_FILE) {
        return;
      }

      const preview = normalizePreviewText(data.lines.text);
      const submatches = findLineHighlightRanges(preview, query, options);

      if (submatches.length === 0) {
        return;
      }

      fileMatches.push({
        lineNumber: data.line_number,
        preview,
        submatches,
      });

      matchesByFile.set(filePath, fileMatches);
      matchedFilePaths.add(filePath);
      totalMatches += 1;
    };

    const consumeJsonLine = (line: string): void => {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        return;
      }

      try {
        const parsed = JSON.parse(trimmedLine) as {
          type?: string;
          data?: RipgrepMatchData;
        };

        if (parsed.type === 'match' && parsed.data) {
          pushMatch(parsed.data);
        }
      } catch {
        return;
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      if (generation !== contentSearchGeneration) {
        return;
      }

      const text = pendingLine + chunk.toString('utf8');
      const lines = text.split(/\r?\n/);
      pendingLine = lines.pop() ?? '';

      for (const line of lines) {
        consumeJsonLine(line);
      }
    });

    const finalize = (): void => {
      if (activeContentSearch === child) {
        activeContentSearch = null;
      }

      if (generation !== contentSearchGeneration) {
        return;
      }

      if (pendingLine.trim()) {
        consumeJsonLine(pendingLine);
      }

      resolve(matchesByFile);
    };

    child.on('error', finalize);
    child.on('close', finalize);
  });
}

function findFileNode(nodes: ExplorerSearchNode[], filePath: string): ExplorerSearchNode | null {
  for (const entry of nodes) {
    if (entry.type === 'file' && entry.path === filePath) {
      return entry;
    }

    if (entry.children) {
      const nested = findFileNode(entry.children, filePath);

      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function mergeContentMatches(
  nameMatches: ExplorerSearchNode[],
  rootPath: string,
  contentMatches: Map<string, ExplorerSearchLineMatch[]>,
): ExplorerSearchNode[] {
  const existingPaths = collectFilePaths(nameMatches);

  for (const [filePath, matches] of contentMatches) {
    if (matches.length === 0) {
      continue;
    }

    let fileNode = existingPaths.has(filePath)
      ? findFileNode(nameMatches, filePath)
      : insertFilePathIntoTree(nameMatches, rootPath, filePath);

    if (!fileNode) {
      continue;
    }

    fileNode.contentMatches = matches;
    existingPaths.add(filePath);
  }

  return sortSearchNodes(nameMatches);
}

export async function searchProjectTree(
  rootPath: string,
  query: string,
  options: ExplorerSearchOptions,
): Promise<ExplorerSearchNode[]> {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return [];
  }

  const [nameMatches, contentMatches] = await Promise.all([
    Promise.resolve(searchProjectTreeByName(rootPath, trimmedQuery, options)),
    searchProjectContent(rootPath, trimmedQuery, options),
  ]);

  return mergeContentMatches(nameMatches, rootPath, contentMatches);
}

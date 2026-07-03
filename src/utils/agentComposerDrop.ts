import {
  getDroppedFilePaths,
  getExplorerDragEntryPath,
  isExplorerInternalDrag,
  isExternalFileDrag,
} from '@/utils/explorerExternalDrop';
import { toProjectRelativePath } from '@/utils/explorerRelativePath';
import { isImageFileName } from '@/utils/fileViewMode';

function normalizeFsPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function isPathInsideProject(projectPath: string, absolutePath: string): boolean {
  const normalizedRoot = normalizeFsPath(projectPath);
  const normalizedEntry = absolutePath.replace(/\\/g, '/');

  return normalizedEntry === normalizedRoot || normalizedEntry.startsWith(`${normalizedRoot}/`);
}

export function canAcceptAgentComposerDrop(dataTransfer: DataTransfer): boolean {
  if (isExplorerInternalDrag(dataTransfer)) {
    return Boolean(getExplorerDragEntryPath(dataTransfer));
  }

  return isExternalFileDrag(dataTransfer);
}

export function resolveAgentComposerDropEffect(
  dataTransfer: DataTransfer,
): DataTransfer['dropEffect'] {
  if (isExplorerInternalDrag(dataTransfer)) {
    return 'link';
  }

  if (isExternalFileDrag(dataTransfer)) {
    return 'copy';
  }

  return 'none';
}

export async function resolveAgentComposerPathMention(
  projectPath: string,
  absolutePath: string,
): Promise<string | null> {
  const normalizedPath = absolutePath.replace(/\\/g, '/').trim();

  if (!normalizedPath) {
    return null;
  }

  let resolvedPath = normalizedPath;

  if (!isPathInsideProject(projectPath, normalizedPath)) {
    const results = await window.nexus.files.importEntries(projectPath, [normalizedPath]);
    const imported = results.find((result) => result.ok);

    if (!imported?.path) {
      return null;
    }

    resolvedPath = imported.path;
  }

  const relativePath = toProjectRelativePath(projectPath, resolvedPath).trim();

  if (!relativePath || relativePath === '.') {
    return null;
  }

  return `@${relativePath}`;
}

export async function resolveAgentComposerDropMentions(
  projectPath: string,
  dataTransfer: DataTransfer,
  options?: { includeImages?: boolean },
): Promise<string[]> {
  const includeImages = options?.includeImages ?? false;

  if (isExplorerInternalDrag(dataTransfer)) {
    const entryPath = getExplorerDragEntryPath(dataTransfer);

    if (!entryPath) {
      return [];
    }

    const mention = await resolveAgentComposerPathMention(projectPath, entryPath);
    return mention ? [mention] : [];
  }

  if (!isExternalFileDrag(dataTransfer)) {
    return [];
  }

  const mentions: string[] = [];

  for (const filePath of getDroppedFilePaths(dataTransfer)) {
    const fileName = filePath.split(/[/\\]/).pop() ?? '';

    if (!includeImages && isImageFileName(fileName)) {
      continue;
    }

    const mention = await resolveAgentComposerPathMention(projectPath, filePath);

    if (mention) {
      mentions.push(mention);
    }
  }

  return mentions;
}

export function buildAgentComposerMentionInsertion(
  draft: string,
  selectionStart: number,
  selectionEnd: number,
  mention: string,
): { nextDraft: string; nextCaret: number } {
  const before = draft.slice(0, selectionStart);
  const after = draft.slice(selectionEnd);
  const needsSpaceBefore = before.length > 0 && !/[\s\n]$/.test(before);
  const needsSpaceAfter = after.length > 0 && !/^[\s\n]/.test(after);
  const insertion = `${needsSpaceBefore ? ' ' : ''}${mention}${needsSpaceAfter ? ' ' : ''}`;

  return {
    nextDraft: `${before}${insertion}${after}`,
    nextCaret: selectionStart + insertion.length,
  };
}

export function buildAgentComposerMentionsInsertion(
  draft: string,
  selectionStart: number,
  selectionEnd: number,
  mentions: string[],
): { nextDraft: string; nextCaret: number } {
  if (mentions.length === 0) {
    return { nextDraft: draft, nextCaret: selectionStart };
  }

  let nextDraft = draft;
  let caret = selectionStart;
  let selectionEndCursor = selectionEnd;

  for (const mention of mentions) {
    const result = buildAgentComposerMentionInsertion(
      nextDraft,
      caret,
      selectionEndCursor,
      mention,
    );
    nextDraft = result.nextDraft;
    caret = result.nextCaret;
    selectionEndCursor = caret;
  }

  return { nextDraft, nextCaret: caret };
}

export function buildAgentComposerMentionsAppendFragment(
  currentDraft: string,
  mentions: string[],
): string {
  if (mentions.length === 0) {
    return '';
  }

  const joined = mentions.map((mention) => `${mention} `).join('');

  if (!currentDraft.trim()) {
    return joined;
  }

  return /[\s\n]$/.test(currentDraft) ? joined : ` ${joined}`;
}

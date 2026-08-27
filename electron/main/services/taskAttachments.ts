import { copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TaskAttachment } from '../../types/task';
import { isImageAttachmentName } from '../../types/task';
import { ensureNexusProjectDir } from './nexusProjectGitignore';

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'audio/webm': 'webm',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'video/webm': 'webm',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'text/plain': 'txt',
};

const FILE_MIME_TYPES: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  txt: 'text/plain',
};

function resolveDataUrlExtension(mimeType: string): string {
  const mapped = MIME_EXTENSIONS[mimeType];

  if (mapped) {
    return mapped;
  }

  const subtype = (mimeType.split('/')[1] ?? 'bin').split('+')[0] ?? 'bin';
  return subtype.replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'bin';
}

function sanitizeAttachmentName(fileName: string): string {
  return fileName.replace(/[^\w.\-()+\s]/g, '_');
}

function guessFileMimeType(fileName: string): string | undefined {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  return FILE_MIME_TYPES[extension];
}

function resolveAttachmentKind(fileName: string, mimeType?: string): TaskAttachment['kind'] {
  if (mimeType?.startsWith('image/') || isImageAttachmentName(fileName)) {
    return 'image';
  }

  return 'file';
}

function resolveGeneratedFileName(mimeType: string, fileName?: string): string {
  const trimmed = fileName?.trim();

  if (trimmed) {
    return sanitizeAttachmentName(path.basename(trimmed));
  }

  const extension = resolveDataUrlExtension(mimeType);
  const prefix = mimeType.startsWith('audio/')
    ? 'audio'
    : mimeType.startsWith('video/')
      ? 'video'
      : mimeType.startsWith('text/')
        ? 'texto'
        : mimeType.startsWith('image/')
          ? 'clipboard'
          : 'anexo';

  return `${prefix}-${Date.now()}.${extension}`;
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const match = dataUrl.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/i);

  if (!match?.[1] || !match[2]) {
    throw new Error('Invalid attachment data URL');
  }

  return {
    mimeType: match[1].toLowerCase(),
    base64: match[2],
  };
}

export async function saveTaskAttachment(
  projectPath: string,
  taskId: string,
  sourcePath: string,
): Promise<TaskAttachment> {
  const targetDir = await ensureNexusProjectDir(projectPath, 'tasks', taskId);

  const fileName = path.basename(sourcePath);
  const safeName = sanitizeAttachmentName(fileName);
  const targetPath = path.join(targetDir, `${randomUUID()}-${safeName}`);

  await copyFile(sourcePath, targetPath);

  return {
    id: randomUUID(),
    name: fileName,
    kind: resolveAttachmentKind(fileName),
    path: targetPath,
    mimeType: guessFileMimeType(fileName),
  };
}

export async function saveTaskAttachmentFromDataUrl(
  projectPath: string,
  taskId: string,
  dataUrl: string,
  fileName?: string,
): Promise<TaskAttachment> {
  const { mimeType, base64 } = parseDataUrl(dataUrl);
  const resolvedName = resolveGeneratedFileName(mimeType, fileName);
  const targetDir = await ensureNexusProjectDir(projectPath, 'tasks', taskId);
  const targetPath = path.join(
    targetDir,
    `${randomUUID()}-${sanitizeAttachmentName(resolvedName)}`,
  );

  await writeFile(targetPath, Buffer.from(base64, 'base64'));

  return {
    id: randomUUID(),
    name: resolvedName,
    kind: resolveAttachmentKind(resolvedName, mimeType),
    path: targetPath,
    mimeType,
  };
}

export async function readTaskAttachment(filePath: string): Promise<Buffer> {
  const { readFile } = await import('node:fs/promises');
  return readFile(filePath);
}

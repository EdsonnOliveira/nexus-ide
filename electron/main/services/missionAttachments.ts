import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import type { MissionAttachment } from '../../types/mission';

const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;

function sanitizeMissionId(missionId: string): string {
  const sanitized = missionId.replace(/[^A-Za-z0-9._-]/g, '');

  if (!sanitized || sanitized.includes('..')) {
    throw new Error('Invalid mission id');
  }

  return sanitized;
}

const FILE_MIME_TYPES: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  webm: 'audio/webm',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  zip: 'application/zip',
};

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);

function sanitizeAttachmentName(fileName: string): string {
  return fileName.replace(/[^\w.\-()+\s]/g, '_');
}

function guessFileMimeType(fileName: string): string | undefined {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  return FILE_MIME_TYPES[extension];
}

function resolveAttachmentKind(fileName: string, mimeType?: string): MissionAttachment['kind'] {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  if (mimeType?.startsWith('image/') || IMAGE_EXTENSIONS.has(extension)) {
    return 'image';
  }
  return 'file';
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

function resolveDataUrlExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();

  if (normalized.includes('jpeg') || normalized.includes('jpg')) {
    return 'jpg';
  }
  if (normalized.includes('webp')) {
    return 'webp';
  }
  if (normalized.includes('gif')) {
    return 'gif';
  }
  if (normalized.includes('svg')) {
    return 'svg';
  }

  return 'png';
}

function resolveGeneratedFileName(mimeType: string, fileName?: string): string {
  const trimmed = fileName?.trim();

  if (trimmed) {
    return sanitizeAttachmentName(path.basename(trimmed));
  }

  return `clipboard-${Date.now()}.${resolveDataUrlExtension(mimeType)}`;
}

export function getMissionAttachmentsDir(missionId: string): string {
  return path.join(
    app.getPath('userData'),
    'missions',
    sanitizeMissionId(missionId),
    'attachments',
  );
}

export function getMissionPendingAttachmentsDir(): string {
  return path.join(app.getPath('userData'), 'missions', '_pending', 'attachments');
}

export async function saveMissionPendingAttachmentFromDataUrl(
  dataUrl: string,
  fileName?: string,
): Promise<{ id: string; name: string; sourcePath: string }> {
  const { mimeType, base64 } = parseDataUrl(dataUrl);
  const resolvedName = resolveGeneratedFileName(mimeType, fileName);
  const targetDir = getMissionPendingAttachmentsDir();
  await mkdir(targetDir, { recursive: true });

  const targetPath = path.join(
    targetDir,
    `${randomUUID()}-${sanitizeAttachmentName(resolvedName)}`,
  );

  const bytes = Buffer.from(base64, 'base64');

  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error('Attachment too large');
  }

  await writeFile(targetPath, bytes);

  return {
    id: randomUUID(),
    name: resolvedName,
    sourcePath: targetPath,
  };
}

export async function saveMissionAttachment(
  missionId: string,
  sourcePath: string,
): Promise<MissionAttachment> {
  const targetDir = getMissionAttachmentsDir(missionId);
  await mkdir(targetDir, { recursive: true });

  const fileName = path.basename(sourcePath);
  const safeName = sanitizeAttachmentName(fileName);
  const targetPath = path.join(targetDir, `${randomUUID()}-${safeName}`);

  await copyFile(sourcePath, targetPath);

  const mimeType = guessFileMimeType(fileName);

  return {
    id: randomUUID(),
    name: fileName,
    kind: resolveAttachmentKind(fileName, mimeType),
    path: targetPath,
    mimeType,
  };
}

export async function removeMissionAttachmentsDir(missionId: string): Promise<void> {
  let safeId: string;

  try {
    safeId = sanitizeMissionId(missionId);
  } catch {
    return;
  }

  const targetDir = path.join(app.getPath('userData'), 'missions', safeId);
  const missionsRoot = path.join(app.getPath('userData'), 'missions');
  const relative = path.relative(missionsRoot, targetDir);

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return;
  }

  await rm(targetDir, { recursive: true, force: true });
}

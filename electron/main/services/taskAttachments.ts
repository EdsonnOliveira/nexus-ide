import { copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TaskAttachment } from '../../types/task';
import { isImageAttachmentName } from '../../types/task';
import { ensureNexusProjectDir } from './nexusProjectGitignore';

function resolveImageExtension(mimeType: string): string {
  if (mimeType === 'image/jpeg') {
    return 'jpg';
  }

  if (mimeType === 'image/svg+xml') {
    return 'svg';
  }

  return (mimeType.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
}

function sanitizeAttachmentName(fileName: string): string {
  return fileName.replace(/[^\w.\-()+\s]/g, '_');
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
    kind: isImageAttachmentName(fileName) ? 'image' : 'file',
    path: targetPath,
  };
}

export async function saveTaskAttachmentFromDataUrl(
  projectPath: string,
  taskId: string,
  dataUrl: string,
): Promise<TaskAttachment> {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (!match) {
    throw new Error('Invalid image data URL');
  }

  const mimeType = match[1];
  const base64 = match[2];
  const extension = resolveImageExtension(mimeType);
  const fileName = `clipboard-${Date.now()}.${extension}`;
  const targetDir = await ensureNexusProjectDir(projectPath, 'tasks', taskId);

  const targetPath = path.join(targetDir, `${randomUUID()}-${sanitizeAttachmentName(fileName)}`);

  await writeFile(targetPath, Buffer.from(base64, 'base64'));

  return {
    id: randomUUID(),
    name: fileName,
    kind: 'image',
    path: targetPath,
    mimeType,
  };
}

export async function readTaskAttachment(filePath: string): Promise<Buffer> {
  const { readFile } = await import('node:fs/promises');
  return readFile(filePath);
}

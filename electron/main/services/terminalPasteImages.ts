import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveDirectoryPath } from './directoryListing';
import { ensureNexusProjectDir } from './nexusProjectGitignore';

export interface SavedTerminalPasteImage {
  absolutePath: string;
  relativePath: string;
  fileName: string;
}

function resolveImageExtension(mimeType: string): string {
  if (mimeType === 'image/jpeg') {
    return 'jpg';
  }

  if (mimeType === 'image/svg+xml') {
    return 'svg';
  }

  if (mimeType === 'image/webp') {
    return 'webp';
  }

  return (mimeType.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
}

function sanitizePaneSegment(paneId: string): string {
  return paneId.replace(/[^\w.-]+/g, '_').slice(0, 64) || 'pane';
}

export async function saveTerminalPasteImage(
  projectPath: string,
  paneId: string,
  imageIndex: number,
  dataUrl: string,
): Promise<SavedTerminalPasteImage> {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (!match) {
    throw new Error('Invalid image data URL');
  }

  const mimeType = match[1];
  const base64 = match[2];
  const extension = resolveImageExtension(mimeType);
  const resolvedProject = resolveDirectoryPath(projectPath);
  const paneSegment = sanitizePaneSegment(paneId);
  const targetDir = await ensureNexusProjectDir(resolvedProject, 'terminal-paste', paneSegment);
  const fileName = `paste-${imageIndex}.${extension}`;
  const absolutePath = path.join(targetDir, fileName);

  await writeFile(absolutePath, Buffer.from(base64, 'base64'));

  const relativePath = path
    .relative(resolvedProject, absolutePath)
    .replace(/\\/g, '/');

  return {
    absolutePath,
    relativePath,
    fileName,
  };
}

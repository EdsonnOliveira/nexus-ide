import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

function getLogosDir(): string {
  return path.join(app.getPath('userData'), 'project-logos');
}

function removeExistingProjectLogoFiles(projectId: string, dir: string): void {
  if (!existsSync(dir)) {
    return;
  }

  for (const existing of readdirSync(dir)) {
    if (existing.startsWith(`${projectId}.`)) {
      unlinkSync(path.join(dir, existing));
    }
  }
}

export function saveProjectLogo(projectId: string, sourcePath: string): string {
  if (!existsSync(sourcePath)) {
    throw new Error(`Source image not found: ${sourcePath}`);
  }

  const dir = getLogosDir();
  mkdirSync(dir, { recursive: true });
  removeExistingProjectLogoFiles(projectId, dir);

  const ext = path.extname(sourcePath).toLowerCase() || '.png';
  const destPath = path.join(dir, `${projectId}${ext}`);
  copyFileSync(sourcePath, destPath);

  if (!existsSync(destPath)) {
    throw new Error('Failed to copy logo file');
  }

  return destPath;
}

export function saveProjectLogoFromDataUrl(projectId: string, dataUrl: string): string {
  const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);

  if (!match) {
    throw new Error('Invalid PNG data URL');
  }

  const dir = getLogosDir();
  mkdirSync(dir, { recursive: true });
  removeExistingProjectLogoFiles(projectId, dir);

  const destPath = path.join(dir, `${projectId}.png`);
  writeFileSync(destPath, Buffer.from(match[1], 'base64'));

  if (!existsSync(destPath)) {
    throw new Error('Failed to write logo file');
  }

  return destPath;
}

export function removeProjectLogo(logoPath: string | null): void {
  if (logoPath && existsSync(logoPath)) {
    unlinkSync(logoPath);
  }
}

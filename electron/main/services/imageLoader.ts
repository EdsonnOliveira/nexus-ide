import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import path from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
};

export function bufferToDataUrl(buffer: Buffer, filePath: string): string {
  const mimeType = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

export async function readImageAsDataUrl(filePath: string): Promise<string | null> {
  const resolvedPath = path.resolve(filePath);

  if (!resolvedPath || !existsSync(resolvedPath)) {
    return null;
  }

  const buffer = await readFile(resolvedPath);
  return bufferToDataUrl(buffer, resolvedPath);
}

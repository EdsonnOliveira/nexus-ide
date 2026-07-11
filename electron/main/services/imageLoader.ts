import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import path from 'node:path';

export const MAX_IMAGE_DATA_URL_BYTES = 4 * 1024 * 1024;

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

export function bufferToDataUrlIfWithinLimit(
  buffer: Buffer | null,
  filePath: string,
  maxBytes = MAX_IMAGE_DATA_URL_BYTES,
): string | null {
  if (!buffer || buffer.length === 0 || buffer.length > maxBytes) {
    return null;
  }

  return bufferToDataUrl(buffer, filePath);
}

export async function readImageAsDataUrl(filePath: string): Promise<string | null> {
  const resolvedPath = path.resolve(filePath);

  if (!resolvedPath || !existsSync(resolvedPath)) {
    return null;
  }

  try {
    const fileStats = await stat(resolvedPath);

    if (!fileStats.isFile() || fileStats.size > MAX_IMAGE_DATA_URL_BYTES) {
      return null;
    }
  } catch {
    return null;
  }

  const buffer = await readFile(resolvedPath);
  return bufferToDataUrlIfWithinLimit(buffer, resolvedPath);
}

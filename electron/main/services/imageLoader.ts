import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
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

const SKIP_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'release',
  '.next',
  'coverage',
  'Pods',
  'DerivedData',
]);

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

export function normalizeImageRef(imageRef: string): string {
  let trimmed = imageRef.trim().replace(/&amp;/g, '&');

  if (!trimmed) {
    return '';
  }

  if (/^nexus-file:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      trimmed = decodeURIComponent(url.pathname);
    } catch {
      trimmed = decodeURIComponent(trimmed.replace(/^nexus-file:\/\//i, ''));
    }
  } else if (/^file:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      trimmed = decodeURIComponent(url.pathname);
    } catch {
      trimmed = decodeURIComponent(trimmed.replace(/^file:\/\//i, ''));
    }
  }

  if (process.platform === 'win32' && /^\/[A-Za-z]:\//.test(trimmed)) {
    trimmed = trimmed.slice(1);
  }

  return trimmed;
}

async function findImageByBasename(
  rootDir: string,
  fileName: string,
  maxDepth = 5,
): Promise<string | null> {
  const target = fileName.toLowerCase();
  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      break;
    }

    let entries;

    try {
      entries = await readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== fileName) {
        continue;
      }

      const fullPath = join(current.dir, entry.name);

      if (entry.isDirectory()) {
        if (current.depth >= maxDepth || SKIP_DIR_NAMES.has(entry.name)) {
          continue;
        }

        queue.push({ dir: fullPath, depth: current.depth + 1 });
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase() === target) {
        return fullPath;
      }
    }
  }

  return null;
}

function isPathInsideRoot(filePath: string, root: string): boolean {
  const resolved = path.resolve(filePath);
  const rootResolved = path.resolve(root);
  return resolved === rootResolved || resolved.startsWith(`${rootResolved}${path.sep}`);
}

export async function resolveProjectImageAsDataUrl(
  projectPath: string | null | undefined,
  imageRef: string,
): Promise<string | null> {
  const normalized = normalizeImageRef(imageRef);

  if (!normalized) {
    return null;
  }

  if (/^https?:\/\//i.test(normalized)) {
    return null;
  }

  if (/^data:image\//i.test(normalized)) {
    return normalized;
  }

  const projectRoot = projectPath?.trim() ? path.resolve(projectPath.trim()) : null;

  if (!projectRoot) {
    return null;
  }

  const candidates: string[] = [];

  if (path.isAbsolute(normalized)) {
    if (isPathInsideRoot(normalized, projectRoot)) {
      candidates.push(path.resolve(normalized));
    }
  } else {
    candidates.push(path.resolve(projectRoot, normalized));

    const name = basename(normalized);

    if (name && name !== normalized) {
      const nested = path.resolve(projectRoot, name);
      if (isPathInsideRoot(nested, projectRoot)) {
        candidates.push(nested);
      }
    }
  }

  for (const candidate of candidates) {
    if (!isPathInsideRoot(candidate, projectRoot)) {
      continue;
    }

    const dataUrl = await readImageAsDataUrl(candidate);

    if (dataUrl) {
      return dataUrl;
    }
  }

  const found = await findImageByBasename(projectRoot, basename(normalized));

  if (found && isPathInsideRoot(found, projectRoot)) {
    return readImageAsDataUrl(found);
  }

  return null;
}

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import path from 'node:path';
import { protocol } from 'electron';

const SCHEME = 'nexus-file';

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

export function registerLocalFileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        secure: true,
        standard: true,
        supportFetchAPI: true,
        bypassCSP: true,
        stream: true,
      },
    },
  ]);
}

function resolveFilePath(requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl);

    if (url.protocol !== `${SCHEME}:`) {
      return null;
    }

    let filePath = decodeURIComponent(url.pathname);

    if (!filePath || filePath === '/') {
      return null;
    }

    if (process.platform === 'win32' && filePath.startsWith('/')) {
      filePath = filePath.slice(1);
    }

    return path.resolve(filePath);
  } catch {
    return null;
  }
}

export function registerLocalFileProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    const filePath = resolveFilePath(request.url);

    if (!filePath || !existsSync(filePath)) {
      return new Response('Not Found', { status: 404 });
    }

    const buffer = await readFile(filePath);
    const mimeType = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'no-cache',
      },
    });
  });
}

export function toLocalFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean).map(encodeURIComponent);

  return `${SCHEME}:///${segments.join('/')}`;
}

import { bridge } from '../lib/supabase';
import { waitForCommandResult } from './webCommandResult';

const remoteImageCache = new Map<string, string | null>();

function cacheKey(deviceId: string, projectId: string, imageRef: string): string {
  return `${deviceId}::${projectId}::${imageRef.trim()}`;
}

export async function resolveWebMarkdownImage(
  imageRef: string,
  context: {
    deviceId: string | null;
    projectId: string | null;
  },
): Promise<string | null> {
  const trimmed = imageRef.trim();

  if (!trimmed) {
    return null;
  }

  if (/^data:image\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  const deviceId = context.deviceId?.trim() || null;
  const projectId = context.projectId?.trim() || null;

  if (!deviceId || !projectId) {
    return null;
  }

  const key = cacheKey(deviceId, projectId, trimmed);
  const cached = remoteImageCache.get(key);

  if (cached !== undefined) {
    return cached;
  }

  try {
    const workspaceId = await bridge.getWorkspaceId();

    if (!workspaceId) {
      return null;
    }

    const commandId = await bridge.executeCommand({
      workspace_id: workspaceId,
      project_id: projectId,
      target_device_id: deviceId,
      type: 'file_read_image',
      payload: { path: trimmed },
      idempotency_key: crypto.randomUUID(),
    });
    const result = await waitForCommandResult(commandId, 30000);
    const dataUrl = result.data_url;
    const resolved = typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') ? dataUrl : null;

    if (resolved) {
      remoteImageCache.set(key, resolved);
    }

    return resolved;
  } catch {
    return null;
  }
}

function decodeHtmlAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function buildHydratedImageTag(alt: string, dataUrl: string, imageRef: string): string {
  return `<img class="markdown-preview__img" src="${escapeAttr(dataUrl)}" alt="${escapeAttr(alt)}" data-image-ref="${escapeAttr(imageRef)}" loading="lazy" />`;
}

function buildMissingChip(alt: string, imageRef: string): string {
  const label = escapeAttr(alt || imageRef);
  return `<span class="markdown-preview__img-missing" title="${escapeAttr(imageRef)}">${label}</span>`;
}

export async function hydrateWebMarkdownImages(
  html: string,
  context: {
    deviceId: string | null;
    projectId: string | null;
  },
): Promise<string> {
  if (!html || (!html.includes('markdown-preview__img') && !html.includes('img-missing'))) {
    return html;
  }

  const jobs: Array<{
    fullMatch: string;
    src: string;
    alt: string;
    imageRef: string;
    isPending: boolean;
  }> = [];

  const imgRegex =
    /<img\b([^>]*?\bclass="[^"]*\bmarkdown-preview__img\b[^"]*"[^>]*)\/?>/gi;
  let match = imgRegex.exec(html);

  while (match) {
    const attrs = match[1] ?? '';
    const srcMatch = attrs.match(/\bsrc="([^"]*)"/i);
    const altMatch = attrs.match(/\balt="([^"]*)"/i);
    const refMatch = attrs.match(/\bdata-image-ref="([^"]*)"/i);
    const pathMatch = attrs.match(/\bdata-image-path="([^"]*)"/i);
    const src = decodeHtmlAttr(srcMatch?.[1] ?? '');
    const alt = decodeHtmlAttr(altMatch?.[1] ?? '');
    const imageRef = decodeHtmlAttr(pathMatch?.[1] ?? refMatch?.[1] ?? src);
    const isPending = /\bmarkdown-preview__img--pending\b/.test(attrs);

    if (imageRef || src) {
      jobs.push({
        fullMatch: match[0],
        src,
        alt,
        imageRef: imageRef || src,
        isPending,
      });
    }

    match = imgRegex.exec(html);
  }

  const missingRegex =
    /<span\b([^>]*?\bclass="[^"]*\bmarkdown-preview__img-missing\b[^"]*"[^>]*)>([\s\S]*?)<\/span>/gi;
  let missingMatch = missingRegex.exec(html);

  while (missingMatch) {
    const attrs = missingMatch[1] ?? '';
    const titleMatch = attrs.match(/\btitle="([^"]*)"/i);
    const imageRef = decodeHtmlAttr(titleMatch?.[1] ?? '');
    const alt = decodeHtmlAttr((missingMatch[2] ?? '').replace(/<[^>]+>/g, '').trim());

    if (imageRef) {
      jobs.push({
        fullMatch: missingMatch[0],
        src: '',
        alt,
        imageRef,
        isPending: true,
      });
    }

    missingMatch = missingRegex.exec(html);
  }

  if (jobs.length === 0) {
    return html;
  }

  let nextHtml = html;

  for (const job of jobs) {
    if (job.src.startsWith('data:image/')) {
      continue;
    }

    if (/^https?:\/\//i.test(job.src) && !job.isPending) {
      continue;
    }

    const dataUrl = await resolveWebMarkdownImage(job.imageRef, context);

    if (dataUrl) {
      nextHtml = nextHtml.split(job.fullMatch).join(buildHydratedImageTag(job.alt, dataUrl, job.imageRef));
    } else if (job.isPending || !job.src) {
      nextHtml = nextHtml.split(job.fullMatch).join(buildMissingChip(job.alt, job.imageRef));
    }
  }

  return nextHtml;
}

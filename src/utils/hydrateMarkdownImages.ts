const imageDataUrlCache = new Map<string, string | null>();

function cacheKey(projectPath: string | null | undefined, imageRef: string): string {
  return `${projectPath?.trim() ?? ''}::${imageRef.trim()}`;
}

export function clearMarkdownImageCache(): void {
  imageDataUrlCache.clear();
}

function decodeHtmlAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function collectImageJobs(html: string): Array<{
  fullMatch: string;
  src: string;
  alt: string;
  imageRef: string;
  isPending: boolean;
}> {
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

  return jobs;
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

export type MarkdownImageResolver = (
  imageRef: string,
  projectPath: string | null,
) => Promise<string | null>;

export async function hydrateMarkdownImageHtml(
  html: string,
  projectPath: string | null | undefined,
  resolveDataUrl: MarkdownImageResolver,
): Promise<string> {
  if (!html || (!html.includes('markdown-preview__img') && !html.includes('img-missing'))) {
    return html;
  }

  const jobs = collectImageJobs(html);

  if (jobs.length === 0) {
    return html;
  }

  const root = projectPath?.trim() || null;
  let nextHtml = html;

  for (const job of jobs) {
    if (job.src.startsWith('data:image/')) {
      continue;
    }

    if (/^https?:\/\//i.test(job.src) && !job.isPending && !job.imageRef) {
      continue;
    }

    if (/^https?:\/\//i.test(job.imageRef) && job.src === job.imageRef) {
      continue;
    }

    const key = cacheKey(root, job.imageRef);
    let dataUrl = imageDataUrlCache.get(key);

    if (dataUrl === undefined) {
      try {
        dataUrl = await resolveDataUrl(job.imageRef, root);
      } catch {
        dataUrl = null;
      }

      if (dataUrl) {
        imageDataUrlCache.set(key, dataUrl);
      }
    }

    if (dataUrl) {
      nextHtml = nextHtml.split(job.fullMatch).join(buildHydratedImageTag(job.alt, dataUrl, job.imageRef));
    } else if (job.isPending || !job.src) {
      nextHtml = nextHtml.split(job.fullMatch).join(buildMissingChip(job.alt, job.imageRef));
    }
  }

  return nextHtml;
}

export async function resolveDesktopMarkdownImage(
  imageRef: string,
  projectPath: string | null,
): Promise<string | null> {
  if (!window.nexus?.files?.resolveProjectImageAsDataUrl) {
    return null;
  }

  return window.nexus.files.resolveProjectImageAsDataUrl(projectPath, imageRef);
}

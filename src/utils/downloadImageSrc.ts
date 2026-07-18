export function resolveImageDownloadFileName(
  preferredName?: string | null,
  mimeHint?: string | null,
): string {
  const base = preferredName?.trim().split(/[/\\]/).pop()?.trim() ?? '';

  if (base && /\.[a-z0-9]{2,5}$/i.test(base)) {
    return base;
  }

  const extension = mimeHint?.includes('jpeg') || mimeHint?.includes('jpg')
    ? 'jpg'
    : mimeHint?.includes('webp')
      ? 'webp'
      : mimeHint?.includes('gif')
        ? 'gif'
        : 'png';

  const safeBase = base.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-') || 'imagem';
  return `${safeBase}.${extension}`;
}

export function downloadImageSrc(src: string, preferredName?: string | null): void {
  const mimeMatch = src.match(/^data:(image\/[a-z0-9.+-]+);/i);
  const fileName = resolveImageDownloadFileName(preferredName, mimeMatch?.[1] ?? null);
  const anchor = document.createElement('a');
  anchor.href = src;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function findMarkdownPreviewImage(target: EventTarget | null): HTMLImageElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const img = target.closest('img.markdown-preview__img');

  if (!(img instanceof HTMLImageElement)) {
    return null;
  }

  if (img.classList.contains('markdown-preview__img--pending')) {
    return null;
  }

  const src = img.currentSrc || img.src;

  if (!src || src === window.location.href) {
    return null;
  }

  return img;
}

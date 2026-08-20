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

function canvasPngBlob(img: HTMLImageElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;

    if (!width || !height) {
      resolve(null);
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    if (!context) {
      resolve(null);
      return;
    }

    try {
      context.drawImage(img, 0, 0);
    } catch {
      resolve(null);
      return;
    }

    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

async function blobFromImageSrc(src: string): Promise<Blob | null> {
  try {
    const response = await fetch(src);
    const blob = await response.blob();

    if (!blob.type.startsWith('image/') && !src.startsWith('data:image/')) {
      return null;
    }

    return blob;
  } catch {
    return null;
  }
}

export async function copyHtmlImageToClipboard(img: HTMLImageElement): Promise<boolean> {
  const src = img.currentSrc || img.src;

  if (!src) {
    return false;
  }

  let blob = await canvasPngBlob(img);

  if (!blob) {
    blob = await blobFromImageSrc(src);
  }

  if (!blob) {
    return false;
  }

  const type = blob.type.startsWith('image/') ? blob.type : 'image/png';

  try {
    await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
    return true;
  } catch {
    if (type === 'image/png') {
      return false;
    }

    try {
      const pngBlob = await canvasPngBlob(img);

      if (!pngBlob) {
        return false;
      }

      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      return true;
    } catch {
      return false;
    }
  }
}

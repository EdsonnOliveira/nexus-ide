export type FileViewMode = 'code' | 'image' | 'pdf' | 'preview';

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'ico',
  'bmp',
  'avif',
  'tif',
  'tiff',
]);

export function isImageFileName(fileName: string): boolean {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(extension);
}

export function resolveFileViewMode(fileName: string): FileViewMode {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';

  if (extension === 'pdf') {
    return 'pdf';
  }

  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image';
  }

  return 'code';
}

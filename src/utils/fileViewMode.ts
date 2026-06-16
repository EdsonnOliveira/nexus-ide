export type FileViewMode = 'code' | 'image' | 'pdf';

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

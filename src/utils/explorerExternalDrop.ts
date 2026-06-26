import { EXPLORER_ENTRY_DRAG_MIME } from '@/constants/explorerDrag';
import { isImageFileName } from '@/utils/fileViewMode';

export function isExplorerInternalDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(EXPLORER_ENTRY_DRAG_MIME);
}

export function resolveExplorerDropEffect(effectAllowed: string): DataTransfer['dropEffect'] {
  if (effectAllowed === 'uninitialized' || effectAllowed === 'none') {
    return 'none';
  }

  if (effectAllowed.includes('move')) {
    return 'move';
  }

  if (effectAllowed.includes('copy')) {
    return 'copy';
  }

  return 'link';
}

export function getExplorerDragEntryPath(dataTransfer: DataTransfer): string | null {
  const mimePath = dataTransfer.getData(EXPLORER_ENTRY_DRAG_MIME).trim();

  if (mimePath) {
    return mimePath;
  }

  const textPath = dataTransfer.getData('text/plain').trim();

  return textPath || null;
}

export function isExternalFileDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes('Files') && !isExplorerInternalDrag(dataTransfer);
}

export function isExternalImageFileDrag(dataTransfer: DataTransfer): boolean {
  if (!isExternalFileDrag(dataTransfer)) {
    return false;
  }

  const droppedPaths = getDroppedFilePaths(dataTransfer);

  if (
    droppedPaths.some((filePath) => isImageFileName(filePath.split(/[/\\]/).pop() ?? ''))
  ) {
    return true;
  }

  return Array.from(dataTransfer.files).some((file) => file.type.startsWith('image/'));
}

export function getDroppedFilePaths(dataTransfer: DataTransfer): string[] {
  const files = dataTransfer?.files;

  if (!files || files.length === 0) {
    return [];
  }

  const paths: string[] = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const filePath = window.nexus.files.getPathForFile(file);

    if (filePath) {
      paths.push(filePath);
    }
  }

  return paths;
}

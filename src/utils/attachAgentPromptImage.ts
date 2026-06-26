import { useTerminalPasteImageStore } from '@/stores/useTerminalPasteImageStore';
import { isImageFileName } from '@/utils/fileViewMode';
import { getTerminalHandle } from '@/utils/terminalHandleRegistry';
import { buildImagePathReference } from '@/utils/terminalPasteImageTokens';
import { blobToDataUrl } from '@/utils/terminalClipboardImage';

export interface AttachedAgentPromptImage {
  relativePath: string;
  absolutePath: string;
  dataUrl: string;
  reference: string;
}

export async function saveAgentPromptImage(
  projectPath: string,
  paneId: string,
  dataUrl: string,
): Promise<AttachedAgentPromptImage | null> {
  const store = useTerminalPasteImageStore.getState();
  const nextIndex = (store.imagesByPane[paneId]?.length ?? 0) + 1;

  try {
    const saved = await window.nexus.files.saveTerminalPasteImage(
      projectPath,
      paneId,
      nextIndex,
      dataUrl,
    );
    store.addImage(paneId, dataUrl, saved);
    const reference = buildImagePathReference(saved.relativePath);

    return {
      relativePath: saved.relativePath,
      absolutePath: saved.absolutePath,
      dataUrl,
      reference,
    };
  } catch {
    return null;
  }
}

export async function readImagePathAsDataUrl(filePath: string): Promise<string | null> {
  const fileName = filePath.split(/[/\\]/).pop() ?? '';

  if (!isImageFileName(fileName)) {
    return null;
  }

  return window.nexus.files.readImageAsDataUrl(filePath);
}

export async function readDroppedImageDataUrls(dataTransfer: DataTransfer): Promise<string[]> {
  const dataUrls: string[] = [];
  const seenPaths = new Set<string>();

  for (const file of dataTransfer.files) {
    if (!file.type.startsWith('image/')) {
      continue;
    }

    const filePath = window.nexus.files.getPathForFile(file);

    if (filePath) {
      if (seenPaths.has(filePath)) {
        continue;
      }

      seenPaths.add(filePath);
      const fromPath = await readImagePathAsDataUrl(filePath);

      if (fromPath) {
        dataUrls.push(fromPath);
      }

      continue;
    }

    try {
      dataUrls.push(await blobToDataUrl(file));
    } catch {
      continue;
    }
  }

  return dataUrls;
}

export async function attachAgentPromptImageToPane(
  projectPath: string,
  paneId: string,
  dataUrl: string,
  writeToPrompt = true,
): Promise<string | null> {
  const attached = await saveAgentPromptImage(projectPath, paneId, dataUrl);

  if (!attached) {
    return null;
  }

  if (writeToPrompt) {
    const handle = getTerminalHandle(paneId);

    if (handle?.isWritable()) {
      handle.write(` ${attached.reference}`);
    }
  }

  return attached.reference;
}

export async function attachAgentPromptImagesToPane(
  projectPath: string,
  paneId: string,
  dataUrls: string[],
  writeToPrompt = true,
): Promise<string[]> {
  const references: string[] = [];

  for (const dataUrl of dataUrls) {
    const reference = await attachAgentPromptImageToPane(projectPath, paneId, dataUrl, writeToPrompt);

    if (reference) {
      references.push(reference);
    }
  }

  return references;
}

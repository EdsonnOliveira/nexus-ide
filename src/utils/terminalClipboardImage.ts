export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('Invalid image data'));
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read image'));
    };

    reader.readAsDataURL(blob);
  });
}

function readImageFromClipboardData(data: DataTransfer | null): Promise<string | null> {
  if (!data) {
    return Promise.resolve(null);
  }

  for (const item of data.items) {
    if (!item.type.startsWith('image/')) {
      continue;
    }

    const file = item.getAsFile();

    if (!file) {
      continue;
    }

    return blobToDataUrl(file);
  }

  return Promise.resolve(null);
}

async function readImageFromNavigatorClipboard(): Promise<string | null> {
  if (!navigator.clipboard?.read) {
    return null;
  }

  try {
    const items = await navigator.clipboard.read();

    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith('image/'));

      if (!imageType) {
        continue;
      }

      const blob = await item.getType(imageType);

      return blobToDataUrl(blob);
    }
  } catch {
    return null;
  }

  return null;
}

export async function readClipboardImageDataUrl(
  event?: ClipboardEvent | null,
): Promise<string | null> {
  const fromEvent = await readImageFromClipboardData(event?.clipboardData ?? null);

  if (fromEvent) {
    return fromEvent;
  }

  return readImageFromNavigatorClipboard();
}

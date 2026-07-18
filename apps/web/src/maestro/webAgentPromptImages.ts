const PROMPT_IMAGE_COLORS = [
  '#7c3aed',
  '#2563eb',
  '#059669',
  '#d97706',
  '#dc2626',
  '#db2777',
  '#0891b2',
  '#4f46e5',
  '#ea580c',
  '#65a30d',
  '#0d9488',
  '#9333ea',
] as const;

export const WEB_AGENT_PROMPT_IMAGE_MENTION_REGEX = /\((?:imagem|img)\s+(\d+)\)/gi;
export const MAX_WEB_PROMPT_IMAGES = 6;
export const MAX_WEB_PROMPT_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_WEB_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

export interface WebPendingAskImage {
  id: string;
  dataUrl: string;
}

export type WebAgentPromptImageMentionSegment =
  | { kind: 'text'; value: string }
  | { kind: 'mention'; value: string; imageNumber: number };

export function getWebAgentPromptImageBadgeColor(imageNumber: number): string {
  const safeNumber = Math.max(1, Math.floor(imageNumber));
  return PROMPT_IMAGE_COLORS[(safeNumber - 1) % PROMPT_IMAGE_COLORS.length];
}

export function buildWebAgentPromptImageMention(imageNumber: number): string {
  return `(img ${Math.max(1, Math.floor(imageNumber))})`;
}

export function buildWebAgentPromptImageMentionInsertion(
  draft: string,
  selectionStart: number,
  selectionEnd: number,
  imageNumber: number,
): { nextDraft: string; nextCaret: number } {
  const mention = buildWebAgentPromptImageMention(imageNumber);
  const before = draft.slice(0, selectionStart);
  const after = draft.slice(selectionEnd);
  const needsSpaceBefore = before.length > 0 && !/[\s\n]$/.test(before);
  const needsSpaceAfter = !/^[\s\n]/.test(after);
  const insertion = `${needsSpaceBefore ? ' ' : ''}${mention}${needsSpaceAfter ? ' ' : ''}`;

  return {
    nextDraft: `${before}${insertion}${after}`,
    nextCaret: selectionStart + insertion.length,
  };
}

export function hasWebAgentPromptImageMentions(text: string): boolean {
  WEB_AGENT_PROMPT_IMAGE_MENTION_REGEX.lastIndex = 0;
  return WEB_AGENT_PROMPT_IMAGE_MENTION_REGEX.test(text);
}

export function splitWebAgentPromptImageMentions(
  text: string,
): WebAgentPromptImageMentionSegment[] {
  if (!text) {
    return [];
  }

  const pattern = new RegExp(
    WEB_AGENT_PROMPT_IMAGE_MENTION_REGEX.source,
    WEB_AGENT_PROMPT_IMAGE_MENTION_REGEX.flags,
  );
  const segments: WebAgentPromptImageMentionSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const matchIndex = match.index ?? 0;
    const imageNumber = Number.parseInt(match[1] ?? '', 10);

    if (!Number.isFinite(imageNumber) || imageNumber <= 0) {
      continue;
    }

    if (matchIndex > lastIndex) {
      segments.push({
        kind: 'text',
        value: text.slice(lastIndex, matchIndex),
      });
    }

    segments.push({
      kind: 'mention',
      value: match[0],
      imageNumber,
    });
    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({
      kind: 'text',
      value: text.slice(lastIndex),
    });
  }

  return segments.length > 0 ? segments : [{ kind: 'text', value: text }];
}

export function renumberWebAgentPromptImages(
  prompt: string,
  pendingImages: WebPendingAskImage[],
): { prompt: string; pendingImages: WebPendingAskImage[] } {
  const pattern = new RegExp(
    WEB_AGENT_PROMPT_IMAGE_MENTION_REGEX.source,
    WEB_AGENT_PROMPT_IMAGE_MENTION_REGEX.flags,
  );
  const mentionedInOrder: number[] = [];
  const seen = new Set<number>();

  for (const match of prompt.matchAll(pattern)) {
    const imageNumber = Number.parseInt(match[1] ?? '', 10);
    if (!Number.isFinite(imageNumber) || imageNumber <= 0 || seen.has(imageNumber)) {
      continue;
    }
    seen.add(imageNumber);
    mentionedInOrder.push(imageNumber);
  }

  const kept = mentionedInOrder
    .map((number) => pendingImages[number - 1])
    .filter((image): image is WebPendingAskImage => Boolean(image));

  if (kept.length === pendingImages.length && mentionedInOrder.every((n, i) => n === i + 1)) {
    return { prompt, pendingImages };
  }

  let nextPrompt = prompt;
  const remap = new Map<number, number>();
  mentionedInOrder.forEach((oldNumber, index) => {
    remap.set(oldNumber, index + 1);
  });

  nextPrompt = nextPrompt.replace(pattern, (full, rawNumber: string) => {
    const oldNumber = Number.parseInt(rawNumber, 10);
    const nextNumber = remap.get(oldNumber);
    if (!nextNumber) {
      return '';
    }
    return buildWebAgentPromptImageMention(nextNumber);
  });

  nextPrompt = nextPrompt.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');

  return { prompt: nextPrompt, pendingImages: kept };
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Failed to read image'));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read image'));
    };
    reader.readAsDataURL(blob);
  });
}

function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) {
    return dataUrl.length;
  }
  return Math.floor((dataUrl.length - comma - 1) * 0.75);
}

export async function readImageFilesAsDataUrls(files: Iterable<File>): Promise<string[]> {
  const dataUrls: string[] = [];

  for (const file of files) {
    const mime = file.type.toLowerCase();
    if (!ALLOWED_WEB_IMAGE_MIME.has(mime)) {
      continue;
    }

    if (file.size > MAX_WEB_PROMPT_IMAGE_BYTES) {
      continue;
    }

    try {
      const dataUrl = await blobToDataUrl(file);
      if (estimateDataUrlBytes(dataUrl) > MAX_WEB_PROMPT_IMAGE_BYTES) {
        continue;
      }
      dataUrls.push(dataUrl);
    } catch {
      continue;
    }
  }

  return dataUrls;
}

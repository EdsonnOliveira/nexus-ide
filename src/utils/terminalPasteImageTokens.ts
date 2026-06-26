const TERMINAL_PASTE_PATH_SEGMENT = '.nexus/terminal-paste/';

export function buildImageToken(id: number): string {
  return `[Image #${id}]`;
}

export function buildImagePathReference(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return `@${normalized}`;
}

export function isTerminalPasteImagePath(relativePath: string): boolean {
  return relativePath.replace(/\\/g, '/').includes(TERMINAL_PASTE_PATH_SEGMENT);
}

export function parseImageTokenIds(text: string): number[] {
  const ids: number[] = [];

  for (const match of text.matchAll(/\[Image #(\d+)\]/g)) {
    ids.push(Number(match[1]));
  }

  return ids;
}

export function parseImagePathReferences(text: string): string[] {
  const paths: string[] = [];

  for (const match of text.matchAll(/@([^\s]+)/g)) {
    const candidate = match[1]?.replace(/[),.;:!?"'\]]+$/g, '') ?? '';

    if (!candidate || !isTerminalPasteImagePath(candidate)) {
      continue;
    }

    paths.push(candidate);
  }

  return paths;
}

export function parseActiveImageReferences(text: string): string[] {
  const legacyIds = parseImageTokenIds(text);

  if (legacyIds.length > 0) {
    return legacyIds.map((id) => buildImageToken(id));
  }

  return parseImagePathReferences(text);
}

export function buildRemoveImagePromptSequence(imageId: number, promptText: string): string {
  const token = buildImageToken(imageId);
  return buildRemovePromptFragment(token, promptText);
}

export function buildRemoveImagePathPromptSequence(
  relativePath: string,
  promptText: string,
): string {
  const token = buildImagePathReference(relativePath);
  return buildRemovePromptFragment(token, promptText);
}

function buildRemovePromptFragment(token: string, promptText: string): string {
  const tokenIndex = promptText.indexOf(token);

  if (tokenIndex === -1) {
    return '';
  }

  const tokenEnd = tokenIndex + token.length;
  const charsAfterToken = promptText.length - tokenEnd;
  let sequence = '\x05';

  if (charsAfterToken > 0) {
    sequence += '\x1b[D'.repeat(charsAfterToken);
  }

  sequence += '\x7f'.repeat(token.length);

  if (charsAfterToken > 0) {
    sequence += '\x1b[C'.repeat(charsAfterToken);
  }

  return sequence;
}

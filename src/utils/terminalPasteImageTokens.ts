export function buildImageToken(id: number): string {
  return `[Image #${id}]`;
}

export function parseImageTokenIds(text: string): number[] {
  const ids: number[] = [];

  for (const match of text.matchAll(/\[Image #(\d+)\]/g)) {
    ids.push(Number(match[1]));
  }

  return ids;
}

export function buildRemoveImagePromptSequence(imageId: number, promptText: string): string {
  const token = buildImageToken(imageId);
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

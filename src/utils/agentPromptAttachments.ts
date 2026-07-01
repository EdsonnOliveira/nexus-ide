import type { AgentPromptAttachment, AgentTurn, AgentUserMessage } from '@/types';
import { readImagePathAsDataUrl } from '@/utils/attachAgentPromptImage';
import {
  buildImagePathReference,
  buildImageToken,
  parseImagePathReferences,
  parseImageTokenIds,
} from '@/utils/terminalPasteImageTokens';

function joinProjectRelativePath(projectPath: string, relativePath: string): string {
  const root = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const relative = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');

  return `${root}/${relative}`;
}

export function stripImagePathReferences(content: string): string {
  const paths = parseImagePathReferences(content);

  let next = content;

  for (const id of parseImageTokenIds(content)) {
    next = next.split(buildImageToken(id)).join('');
  }

  for (const relativePath of paths) {
    const token = buildImagePathReference(relativePath);
    next = next.split(token).join('');
    next = next.split(`@${relativePath}`).join('');
    next = next.split(relativePath).join('');
  }

  next = next.replace(/@?\.nexus\/terminal-paste\/[^\s)]+/g, '');

  return next
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function resolvePromptDisplayContent(content: string): string {
  if (parseImagePathReferences(content).length === 0 && parseImageTokenIds(content).length === 0) {
    return content.trim();
  }

  return stripImagePathReferences(content);
}

export async function loadAgentPromptAttachments(
  projectPath: string,
  relativePaths: string[],
): Promise<AgentPromptAttachment[]> {
  const attachments: AgentPromptAttachment[] = [];
  const seen = new Set<string>();

  for (const relativePath of relativePaths) {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);

    const absolutePath = joinProjectRelativePath(projectPath, normalized);
    const dataUrl = await readImagePathAsDataUrl(absolutePath);

    if (!dataUrl) {
      continue;
    }

    attachments.push({
      id: crypto.randomUUID(),
      label: normalized.split('/').pop() ?? 'image',
      dataUrl,
      relativePath: normalized,
    });
  }

  return attachments;
}

function mergeAgentPromptAttachments(
  existing: AgentPromptAttachment[],
  loaded: AgentPromptAttachment[],
): AgentPromptAttachment[] {
  const merged = new Map<string, AgentPromptAttachment>();

  for (const attachment of existing) {
    const key = attachment.relativePath?.replace(/\\/g, '/').replace(/^\/+/, '');

    if (key) {
      merged.set(key, attachment);
    }
  }

  for (const attachment of loaded) {
    const key = attachment.relativePath?.replace(/\\/g, '/').replace(/^\/+/, '');

    if (!key) {
      continue;
    }

    const current = merged.get(key);

    if (!current || !current.dataUrl) {
      merged.set(key, attachment);
    }
  }

  if (merged.size > 0) {
    return [...merged.values()];
  }

  return existing.length > 0 ? existing : loaded;
}

export async function hydrateAgentUserMessage(
  projectPath: string,
  user: AgentUserMessage,
): Promise<AgentUserMessage> {
  const existing = user.attachments ?? [];
  const pathsFromContent = parseImagePathReferences(user.content);
  const pathsFromAttachments = existing
    .map((attachment) => attachment.relativePath)
    .filter((value): value is string => Boolean(value?.trim()));
  const relativePaths = [...new Set([...pathsFromAttachments, ...pathsFromContent])];
  const displayContent = resolvePromptDisplayContent(user.content);

  if (relativePaths.length === 0) {
    if (displayContent === user.content.trim()) {
      return user;
    }

    return {
      ...user,
      content: displayContent,
    };
  }

  const loaded = await loadAgentPromptAttachments(projectPath, relativePaths);
  const attachments = mergeAgentPromptAttachments(existing, loaded);

  return {
    ...user,
    content: displayContent,
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

export async function resolveSubmitAgentUserMessage(
  projectPath: string,
  content: string,
  existingAttachments: AgentPromptAttachment[],
): Promise<Pick<AgentUserMessage, 'content' | 'attachments'>> {
  const pathsFromContent = parseImagePathReferences(content);
  const pathsFromAttachments = existingAttachments
    .map((attachment) => attachment.relativePath)
    .filter((value): value is string => Boolean(value?.trim()));
  const relativePaths = [...new Set([...pathsFromAttachments, ...pathsFromContent])];
  const loaded =
    relativePaths.length > 0
      ? await loadAgentPromptAttachments(projectPath, relativePaths)
      : [];
  const attachments = mergeAgentPromptAttachments(existingAttachments, loaded);

  return {
    content: resolvePromptDisplayContent(content),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

export function buildAgentPromptHistory(turns: AgentTurn[]): string[] {
  return turns
    .map((turn) => resolvePromptDisplayContent(turn.user.content).trim())
    .filter(Boolean);
}

export async function hydrateAgentTurns(
  projectPath: string,
  turns: AgentTurn[],
): Promise<AgentTurn[]> {
  return Promise.all(
    turns.map(async (turn) => ({
      ...turn,
      user: await hydrateAgentUserMessage(projectPath, turn.user),
    })),
  );
}

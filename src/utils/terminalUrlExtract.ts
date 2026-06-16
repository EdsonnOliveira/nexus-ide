import { isLocalDevUrl } from '@/utils/browserSiteStatus';
import { normalizeBrowserUrl } from '@/utils/browserUrl';

export const TERMINAL_URL_REGEX =
  /https?:\/\/[^\s<>"'\x1b[\]()]+|localhost(?::\d+)?(?:\/[^\s<>"'\x1b[\]()]*)?|127\.0\.0\.1(?::\d+)?(?:\/[^\s<>"'\x1b[\]()]*)?/gi;

export function stripTerminalControlChars(value: string): string {
  return value.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1e[^\x1e]*\x1e/g, '');
}

export function stripTrailingUrlChars(value: string): string {
  return value.replace(/[.,;:!?)>\]}"']+$/g, '');
}

function sortTerminalUrlHints(urls: string[]): string[] {
  return [...urls].sort((left, right) => {
    const leftLocal = isLocalDevUrl(left) ? 0 : 1;
    const rightLocal = isLocalDevUrl(right) ? 0 : 1;

    if (leftLocal !== rightLocal) {
      return leftLocal - rightLocal;
    }

    return left.localeCompare(right);
  });
}

export function extractTerminalUrls(text: string): string[] {
  const clean = stripTerminalControlChars(text);
  const regex = new RegExp(TERMINAL_URL_REGEX.source, TERMINAL_URL_REGEX.flags);
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const match of clean.matchAll(regex)) {
    const raw = stripTrailingUrlChars(match[0]);
    const normalized = normalizeBrowserUrl(raw);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    urls.push(normalized);
  }

  return sortTerminalUrlHints(urls);
}

export function formatTerminalUrlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;

    return `${parsed.host}${path}`;
  } catch {
    return url;
  }
}

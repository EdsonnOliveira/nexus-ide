import { normalizeBrowserUrl } from '@/utils/browserUrl';

export function passwordBrowserUrlsMatch(currentUrl: string, targetUrl: string): boolean {
  const normalizedCurrent = normalizeBrowserUrl(currentUrl);
  const normalizedTarget = normalizeBrowserUrl(targetUrl);

  if (!normalizedCurrent || !normalizedTarget) {
    return false;
  }

  if (normalizedCurrent === normalizedTarget) {
    return true;
  }

  try {
    const current = new URL(normalizedCurrent);
    const target = new URL(normalizedTarget);

    return current.origin === target.origin && current.pathname === target.pathname;
  } catch {
    return false;
  }
}

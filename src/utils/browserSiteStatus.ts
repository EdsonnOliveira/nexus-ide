export type BrowserSiteStatus = 'checking' | 'online' | 'offline';

const OFFLINE_NET_ERROR_CODES = new Set([
  -2,
  -100,
  -101,
  -102,
  -105,
  -106,
  -109,
  -118,
  -501,
]);

export function isOfflineLoadError(errorCode: number): boolean {
  return OFFLINE_NET_ERROR_CODES.has(errorCode);
}

export function isLocalDevUrl(url: string): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

export function isBrowserErrorPageUrl(url: string): boolean {
  return (
    !url ||
    url === 'about:blank' ||
    url.startsWith('chrome-error://') ||
    url.startsWith('data:text/html,chromewebdata')
  );
}

export function isSameLocalDevTarget(loadedUrl: string, expectedUrl: string): boolean {
  try {
    const loaded = new URL(loadedUrl);
    const expected = new URL(expectedUrl);
    const normalizeHost = (hostname: string) => {
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '[::1]' ||
        hostname === '::1'
      ) {
        return 'local';
      }

      return hostname;
    };

    return (
      normalizeHost(loaded.hostname) === normalizeHost(expected.hostname) &&
      loaded.port === expected.port
    );
  } catch {
    return false;
  }
}

export async function probeSiteReachable(url: string): Promise<boolean> {
  if (!url) {
    return false;
  }

  if (typeof window !== 'undefined' && window.nexus?.browser?.probeUrl) {
    try {
      return await window.nexus.browser.probeUrl(url);
    } catch {
      return false;
    }
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });

    return response.status < 500;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function browserSiteStatusLabel(status: BrowserSiteStatus): string {
  if (status === 'checking') {
    return 'Verificando servidor…';
  }

  if (status === 'online') {
    return 'Site no ar';
  }

  return 'Servidor offline';
}

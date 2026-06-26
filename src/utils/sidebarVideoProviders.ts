export type SidebarVideoProvider = 'youtube' | 'prime' | 'disney' | 'netflix';

export interface SidebarVideoSession {
  provider: SidebarVideoProvider;
  sourceUrl: string;
  playbackUrl: string;
  useEmbed: boolean;
  title: string;
}

export interface PersistedSidebarVideoSession {
  sourceUrl: string;
  title: string;
}

export const SIDEBAR_VIDEO_PROVIDER_LABELS: Record<SidebarVideoProvider, string> = {
  youtube: 'YouTube',
  prime: 'Prime Video',
  disney: 'Disney+',
  netflix: 'Netflix',
};

const PROVIDER_HOSTS: Record<SidebarVideoProvider, readonly string[]> = {
  youtube: ['youtube.com', 'youtu.be', 'www.youtube.com', 'm.youtube.com'],
  prime: ['primevideo.com', 'www.primevideo.com', 'amazon.com', 'www.amazon.com', 'amazon.com.br', 'www.amazon.com.br'],
  disney: ['disneyplus.com', 'www.disneyplus.com'],
  netflix: ['netflix.com', 'www.netflix.com'],
};

function normalizeInputUrl(raw: string): URL | null {
  const trimmed = raw.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

function matchesHost(hostname: string, hosts: readonly string[]): boolean {
  const normalized = hostname.toLowerCase();

  return hosts.some((host) => normalized === host || normalized.endsWith(`.${host}`));
}

export function detectSidebarVideoProvider(raw: string): SidebarVideoProvider | null {
  const url = normalizeInputUrl(raw);

  if (!url) {
    return null;
  }

  return detectProvider(url);
}

function detectProvider(url: URL): SidebarVideoProvider | null {
  if (matchesHost(url.hostname, PROVIDER_HOSTS.youtube)) {
    return 'youtube';
  }

  if (matchesHost(url.hostname, PROVIDER_HOSTS.prime)) {
    const path = url.pathname.toLowerCase();

    if (path.includes('/gp/video') || url.hostname.includes('primevideo')) {
      return 'prime';
    }

    return null;
  }

  if (matchesHost(url.hostname, PROVIDER_HOSTS.disney)) {
    return 'disney';
  }

  if (matchesHost(url.hostname, PROVIDER_HOSTS.netflix)) {
    return 'netflix';
  }

  return null;
}

function extractYouTubeVideoId(url: URL): string | null {
  if (url.hostname === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return id || null;
  }

  if (url.pathname.startsWith('/embed/')) {
    const id = url.pathname.slice('/embed/'.length).split('/')[0];
    return id || null;
  }

  if (url.pathname.startsWith('/shorts/')) {
    const id = url.pathname.slice('/shorts/'.length).split('/')[0];
    return id || null;
  }

  const watchId = url.searchParams.get('v');

  if (watchId) {
    return watchId;
  }

  return null;
}

function buildYouTubePlaybackUrl(videoId: string, autoplay = true): string {
  const params = new URLSearchParams({
    autoplay: autoplay ? '1' : '0',
    rel: '0',
    modestbranding: '1',
  });

  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

export async function fetchSidebarVideoTitle(
  sourceUrl: string,
  provider: SidebarVideoProvider,
): Promise<string> {
  try {
    const response = await fetch(
      `https://noembed.com/embed?url=${encodeURIComponent(sourceUrl)}`,
    );

    if (response.ok) {
      const data = (await response.json()) as { title?: string };
      const title = data.title?.trim();

      if (title) {
        return title;
      }
    }
  } catch {
    // ignore
  }

  return SIDEBAR_VIDEO_PROVIDER_LABELS[provider];
}

export function restoreSidebarVideoSession(
  persisted: PersistedSidebarVideoSession,
): SidebarVideoSession | null {
  const session = parseSidebarVideoLink(persisted.sourceUrl, { autoplay: false });

  if (!session) {
    return null;
  }

  return {
    ...session,
    title: persisted.title,
  };
}

export function toPersistedSidebarVideoSession(
  session: SidebarVideoSession,
): PersistedSidebarVideoSession {
  return {
    sourceUrl: session.sourceUrl,
    title: session.title,
  };
}

export function parseSidebarVideoLink(
  raw: string,
  options?: { autoplay?: boolean },
): SidebarVideoSession | null {
  const url = normalizeInputUrl(raw);

  if (!url) {
    return null;
  }

  const provider = detectProvider(url);

  if (!provider) {
    return null;
  }

  if (provider === 'youtube') {
    const videoId = extractYouTubeVideoId(url);

    if (!videoId) {
      return null;
    }

    return {
      provider,
      sourceUrl: url.toString(),
      playbackUrl: buildYouTubePlaybackUrl(videoId, options?.autoplay ?? true),
      useEmbed: true,
      title: '',
    };
  }

  if (provider === 'prime') {
    const path = url.pathname.toLowerCase();

    if (!path.includes('/gp/video') && !url.hostname.includes('primevideo')) {
      return null;
    }
  }

  if (provider === 'netflix') {
    const path = url.pathname.toLowerCase();

    if (!path.includes('/watch') && !path.includes('/title')) {
      return null;
    }
  }

  return {
    provider,
    sourceUrl: url.toString(),
    playbackUrl: url.toString(),
    useEmbed: false,
    title: '',
  };
}

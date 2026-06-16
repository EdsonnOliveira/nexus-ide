export type SidebarVideoProvider = 'youtube' | 'prime' | 'disney' | 'netflix';

export interface SidebarVideoSession {
  provider: SidebarVideoProvider;
  sourceUrl: string;
  playbackUrl: string;
  useEmbed: boolean;
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

function buildYouTubePlaybackUrl(videoId: string): string {
  const params = new URLSearchParams({
    autoplay: '1',
    rel: '0',
    modestbranding: '1',
  });

  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

export function parseSidebarVideoLink(raw: string): SidebarVideoSession | null {
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
      playbackUrl: buildYouTubePlaybackUrl(videoId),
      useEmbed: true,
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
  };
}

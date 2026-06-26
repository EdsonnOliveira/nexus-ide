const WHATSAPP_HOSTS = new Set([
  'wa.me',
  'api.whatsapp.com',
  'web.whatsapp.com',
  'chat.whatsapp.com',
]);

export function parseSidebarWhatsAppLink(raw: string): string | null {
  const trimmed = raw.trim();

  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }

    const host = url.hostname.replace(/^www\./i, '').toLowerCase();

    if (!WHATSAPP_HOSTS.has(host)) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

export async function openSidebarWhatsAppLink(url: string): Promise<void> {
  await window.nexus.whatsapp.openLink(url);
}

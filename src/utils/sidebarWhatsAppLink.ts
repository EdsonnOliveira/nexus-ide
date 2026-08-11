const WHATSAPP_HOSTS = new Set([
  'wa.me',
  'api.whatsapp.com',
  'web.whatsapp.com',
  'chat.whatsapp.com',
]);

const MIN_PHONE_DIGITS = 8;
const MAX_PHONE_DIGITS = 15;

function extractWhatsAppPhoneDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');

  if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) {
    return null;
  }

  return digits;
}

function looksLikeWhatsAppPhoneInput(raw: string): boolean {
  const trimmed = raw.trim();

  if (!trimmed || /[a-z]/i.test(trimmed)) {
    return false;
  }

  return extractWhatsAppPhoneDigits(trimmed) !== null;
}

export function parseSidebarWhatsAppLink(raw: string): string | null {
  const trimmed = raw.trim();

  if (!trimmed) {
    return null;
  }

  if (looksLikeWhatsAppPhoneInput(trimmed)) {
    const digits = extractWhatsAppPhoneDigits(trimmed);

    if (!digits) {
      return null;
    }

    return `https://wa.me/${digits}`;
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

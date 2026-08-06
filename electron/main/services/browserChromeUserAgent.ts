import { session, type Session, type WebContents } from 'electron';

const patchedSessions = new WeakSet<Session>();

export function toChromeUserAgent(electronUserAgent: string): string {
  return electronUserAgent
    .replace(/\sElectron\/[\d.]+\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getBrowserChromeUserAgent(): string {
  return toChromeUserAgent(session.defaultSession.getUserAgent());
}

function extractChromeMajorVersion(userAgent: string): string {
  const match = userAgent.match(/Chrome\/(\d+)/i);
  return match?.[1] ?? '138';
}

function buildChromeClientHintBrands(majorVersion: string): string {
  return `\"Chromium\";v=\"${majorVersion}\", \"Google Chrome\";v=\"${majorVersion}\", \"Not-A.Brand\";v=\"99\"`;
}

function patchBrowserSession(guestSession: Session, chromeUserAgent: string): void {
  if (patchedSessions.has(guestSession)) {
    return;
  }

  patchedSessions.add(guestSession);
  guestSession.setUserAgent(chromeUserAgent);

  const majorVersion = extractChromeMajorVersion(chromeUserAgent);
  const secChUa = buildChromeClientHintBrands(majorVersion);

  guestSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    headers['User-Agent'] = chromeUserAgent;
    headers['user-agent'] = chromeUserAgent;
    headers['Sec-CH-UA'] = secChUa;
    headers['sec-ch-ua'] = secChUa;
    headers['Sec-CH-UA-Mobile'] = '?0';
    headers['sec-ch-ua-mobile'] = '?0';
    headers['Sec-CH-UA-Platform'] = '"macOS"';
    headers['sec-ch-ua-platform'] = '"macOS"';

    callback({ requestHeaders: headers });
  });

  guestSession.webRequest.onCompleted(
    {
      urls: [
        '*://*.supabase.com/platform/cli/login*',
        '*://api.supabase.com/platform/cli/login*',
        '*://*.supabase.co/platform/cli/login*',
      ],
    },
    (details) => {
      console.info(
        `[browser] cli-login ${details.method} ${details.statusCode} ${details.url}`,
      );
    },
  );
}

export function applyChromeUserAgentToWebContents(contents: WebContents): void {
  const chromeUserAgent = getBrowserChromeUserAgent();
  contents.setUserAgent(chromeUserAgent);
  patchBrowserSession(contents.session, chromeUserAgent);
}

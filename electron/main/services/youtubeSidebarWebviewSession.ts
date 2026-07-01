import { session } from 'electron';

export const YOUTUBE_SIDEBAR_WEBVIEW_PARTITION = 'persist:nexus-sidebar-youtube';

const YOUTUBE_EMBED_REFERRER = 'https://www.youtube.com/';

export function registerYouTubeSidebarWebviewSession(): void {
  const youtubeSession = session.fromPartition(YOUTUBE_SIDEBAR_WEBVIEW_PARTITION);

  if (typeof youtubeSession.setBackgroundThrottling === 'function') {
    youtubeSession.setBackgroundThrottling(false);
  }

  youtubeSession.webRequest.onBeforeSendHeaders(
    {
      urls: [
        '*://*.youtube.com/*',
        '*://youtube.com/*',
        '*://*.googlevideo.com/*',
        '*://*.ytimg.com/*',
      ],
    },
    (details, callback) => {
      details.requestHeaders.Referer = YOUTUBE_EMBED_REFERRER;
      details.requestHeaders.referer = YOUTUBE_EMBED_REFERRER;

      callback({ requestHeaders: details.requestHeaders });
    },
  );
}

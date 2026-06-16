/// <reference types="vite/client" />

import type { DetailedHTMLProps, HTMLAttributes } from 'react';
import type { WebviewTag } from 'electron';

interface Window {
  ipcRenderer: import('electron').IpcRenderer;
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<WebviewTag>, WebviewTag> & {
        src?: string;
        partition?: string;
        allowpopups?: string | boolean;
        httpreferrer?: string;
        webpreferences?: string;
      };
    }
  }
}

export {};

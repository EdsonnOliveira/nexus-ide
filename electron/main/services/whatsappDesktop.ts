import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { shell } from 'electron';

const execFileAsync = promisify(execFile);

const WHATSAPP_HOSTS = new Set([
  'wa.me',
  'api.whatsapp.com',
  'web.whatsapp.com',
  'chat.whatsapp.com',
]);

const MAC_WHATSAPP_CANDIDATES = [
  '/Applications/WhatsApp.app',
  '/Applications/WhatsApp.localized/WhatsApp.app',
  path.join(homedir(), 'Applications', 'WhatsApp.app'),
  path.join(homedir(), 'Applications', 'WhatsApp.localized', 'WhatsApp.app'),
];

function findWhatsAppAppInDirectory(directory: string): string | null {
  if (!existsSync(directory)) {
    return null;
  }

  try {
    for (const entry of readdirSync(directory)) {
      const lowerEntry = entry.toLowerCase();

      if (!lowerEntry.includes('whatsapp')) {
        continue;
      }

      const entryPath = path.join(directory, entry);

      if (entry.endsWith('.app') && existsSync(entryPath)) {
        return entryPath;
      }

      const nestedApp = path.join(entryPath, 'WhatsApp.app');

      if (existsSync(nestedApp)) {
        return nestedApp;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function resolveWhatsAppDesktopAppPath(): string | null {
  if (process.platform === 'darwin') {
    for (const candidate of MAC_WHATSAPP_CANDIDATES) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return (
      findWhatsAppAppInDirectory('/Applications') ??
      findWhatsAppAppInDirectory(path.join(homedir(), 'Applications'))
    );
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? '';

    const winCandidates = [
      path.join(localAppData, 'WhatsApp', 'WhatsApp.exe'),
      path.join(localAppData, 'Programs', 'WhatsApp', 'WhatsApp.exe'),
      path.join(process.env.ProgramFiles ?? '', 'WhatsApp', 'WhatsApp.exe'),
      path.join(process.env['ProgramFiles(x86)'] ?? '', 'WhatsApp', 'WhatsApp.exe'),
    ];

    for (const candidate of winCandidates) {
      if (candidate && existsSync(candidate)) {
        return candidate;
      }
    }

    try {
      const windowsApps = path.join(process.env.ProgramFiles ?? '', 'WindowsApps');
      const entries = readdirSync(windowsApps);
      const whatsappEntry = entries.find((entry) => entry.toLowerCase().startsWith('whatsapp'));

      if (whatsappEntry) {
        return path.join(windowsApps, whatsappEntry);
      }
    } catch {
      return null;
    }

    return null;
  }

  const linuxCandidates = [
    '/usr/bin/whatsapp-for-linux',
    '/snap/bin/whatsapp-for-linux',
    path.join(homedir(), '.local', 'bin', 'whatsapp-for-linux'),
  ];

  for (const candidate of linuxCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function isWhatsAppDesktopInstalled(): boolean {
  return resolveWhatsAppDesktopAppPath() !== null;
}

function toWhatsAppDeepLink(httpsUrl: string): string | null {
  let url: URL;

  try {
    url = new URL(httpsUrl);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();

  if (!WHATSAPP_HOSTS.has(host)) {
    return null;
  }

  if (host === 'chat.whatsapp.com') {
    return httpsUrl;
  }

  let phone: string | null = null;

  if (host === 'wa.me' || host === 'api.whatsapp.com') {
    const pathPhone = url.pathname.replace(/^\//, '').split('/')[0] ?? '';
    phone = /^\d+$/.test(pathPhone) ? pathPhone : null;
  }

  if (!phone && (host === 'web.whatsapp.com' || host === 'api.whatsapp.com')) {
    phone = url.searchParams.get('phone');
  }

  if (!phone) {
    return httpsUrl;
  }

  const params = new URLSearchParams({ phone });
  const text = url.searchParams.get('text');

  if (text) {
    params.set('text', text);
  }

  return `whatsapp://send?${params.toString()}`;
}

async function openInWhatsAppDesktop(targetUrl: string): Promise<void> {
  const appPath = resolveWhatsAppDesktopAppPath();

  if (process.platform === 'darwin') {
    if (appPath) {
      await execFileAsync('open', ['-a', appPath, targetUrl]);
      return;
    }

    await execFileAsync('open', ['-a', 'WhatsApp', targetUrl]);
    return;
  }

  if (process.platform === 'win32' && appPath?.endsWith('.exe')) {
    await execFileAsync(appPath, [targetUrl], { windowsHide: true });
    return;
  }

  await shell.openExternal(targetUrl);
}

export async function openWhatsAppLink(httpsUrl: string): Promise<void> {
  if (!isWhatsAppDesktopInstalled()) {
    await shell.openExternal(httpsUrl);
    return;
  }

  const targetUrl = toWhatsAppDeepLink(httpsUrl) ?? httpsUrl;
  await openInWhatsAppDesktop(targetUrl);
}

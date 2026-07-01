import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { app, nativeImage, shell } from 'electron';
import { systemNotificationDismissStore } from './systemNotificationDismissStore';

const execFileAsync = promisify(execFile);

const APPLE_EPOCH_MS = 978_307_200_000;
const DEFAULT_LIMIT = 30;

export interface SystemNotificationItem {
  id: string;
  appId: string;
  appLabel: string;
  title: string;
  body: string;
  deliveredAt: number;
  iconUrl: string | null;
}

export interface SystemNotificationsSnapshot {
  platformSupported: boolean;
  accessGranted: boolean;
  fullDiskAccessAppName: string | null;
  fullDiskAccessAppPath: string | null;
  items: SystemNotificationItem[];
}

const KNOWN_APP_LABELS: Record<string, string> = {
  'com.openai.chat': 'ChatGPT',
  'com.openai.chatgpt': 'ChatGPT',
  'com.apple.MobileSMS': 'Mensagens',
  'com.tinyspeck.slackmacgap': 'Slack',
  'com.google.Chrome': 'Chrome',
  'com.apple.mail': 'Mail',
  'com.apple.iChat': 'Mensagens',
  'net.whatsapp.WhatsApp': 'WhatsApp',
  'com.hnc.Discord': 'Discord',
  'com.spotify.client': 'Spotify',
};

const appIconUrlCache = new Map<string, string | null>();

async function resolveAppBundlePath(appId: string): Promise<string | null> {
  if (!appId) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync('/usr/bin/mdfind', [
      `kMDItemCFBundleIdentifier == '${appId.replace(/'/g, "\\'")}'`,
    ]);
    const candidates = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const mdfindPath = candidates.find((candidate) => candidate.endsWith('.app')) ?? candidates[0];

    if (mdfindPath) {
      return mdfindPath;
    }
  } catch {
    // continue
  }

  try {
    const { stdout } = await execFileAsync('/usr/bin/osascript', [
      '-e',
      `POSIX path of (path to application id "${appId.replace(/"/g, '\\"')}")`,
    ]);
    const appPath = stdout.trim().replace(/\/$/, '');

    if (appPath && appPath !== 'missing value') {
      return appPath;
    }
  } catch {
    // ignore
  }

  return null;
}

async function resolveAppBundlePathByName(appName: string): Promise<string | null> {
  if (!appName) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync('/usr/bin/osascript', [
      '-e',
      `POSIX path of (path to application "${appName.replace(/"/g, '\\"')}")`,
    ]);
    const appPath = stdout.trim().replace(/\/$/, '');

    if (appPath && appPath !== 'missing value') {
      return appPath;
    }
  } catch {
    // ignore
  }

  return null;
}

function readPlistRawValue(plistPath: string, key: string): string | null {
  try {
    const stdout = execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plistPath], {
      encoding: 'utf8',
    });

    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function resolveAppIconFile(appPath: string): string | null {
  const resourcesPath = path.join(appPath, 'Contents/Resources');
  const infoPlistPath = path.join(appPath, 'Contents/Info.plist');
  const candidates: string[] = [
    path.join(resourcesPath, 'AppIcon.icns'),
    path.join(resourcesPath, 'appicon.icns'),
  ];

  if (existsSync(infoPlistPath)) {
    const bundleIconFile = readPlistRawValue(infoPlistPath, 'CFBundleIconFile');

    if (bundleIconFile) {
      const normalizedName = bundleIconFile.endsWith('.icns')
        ? bundleIconFile
        : `${bundleIconFile}.icns`;
      candidates.unshift(path.join(resourcesPath, normalizedName));
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function loadIconDataUrlFromFile(iconFile: string): Promise<string | null> {
  const tempPng = path.join(
    os.tmpdir(),
    `nexus-app-icon-${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
  );

  try {
    await execFileAsync('/usr/bin/sips', ['-s', 'format', 'png', iconFile, '--out', tempPng, '-Z', '56']);
    const image = nativeImage.createFromPath(tempPng);

    if (image.isEmpty()) {
      return null;
    }

    return image.toDataURL();
  } catch {
    return null;
  } finally {
    await fs.rm(tempPng, { force: true }).catch(() => undefined);
  }
}

export async function getSystemNotificationAppIcon(
  appId: string,
  appLabel?: string,
): Promise<string | null> {
  if (process.platform !== 'darwin') {
    return null;
  }

  return resolveAppIconUrl(appId, appLabel);
}

async function resolveAppIconUrl(appId: string, appLabel?: string): Promise<string | null> {
  const cacheKey = `${appId}|${appLabel ?? ''}`;

  if (appIconUrlCache.has(cacheKey)) {
    return appIconUrlCache.get(cacheKey) ?? null;
  }

  let appPath = appId ? await resolveAppBundlePath(appId) : null;

  if (!appPath && appLabel) {
    appPath = await resolveAppBundlePathByName(appLabel);
  }

  if (!appPath) {
    appIconUrlCache.set(cacheKey, null);
    return null;
  }

  const iconFile = resolveAppIconFile(appPath);

  if (iconFile) {
    const iconUrl = await loadIconDataUrlFromFile(iconFile);

    if (iconUrl) {
      appIconUrlCache.set(cacheKey, iconUrl);
      return iconUrl;
    }
  }

  try {
    const icon = await app.getFileIcon(appPath, { size: 'small' });
    const iconUrl = icon.isEmpty() ? null : icon.resize({ width: 28, height: 28 }).toDataURL();
    appIconUrlCache.set(cacheKey, iconUrl);
    return iconUrl;
  } catch {
    appIconUrlCache.set(cacheKey, null);
    return null;
  }
}

function resolveNotificationHelperBinary(): string | null {
  const helperAppPath = resolveNotificationHelperAppPath();

  if (helperAppPath) {
    const helperBinary = path.join(helperAppPath, 'Contents/MacOS/NotificationHelper');

    if (existsSync(helperBinary)) {
      return helperBinary;
    }
  }

  return resolveNotificationReaderBinaryPath();
}

async function waitForOutputFile(outputPath: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(outputPath)) {
      try {
        const content = await fs.readFile(outputPath, 'utf8');

        if (content.trim()) {
          return;
        }
      } catch {
        // continue
      }
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  throw new Error('Notification helper output timeout');
}

let notificationHelperTask: Promise<unknown> = Promise.resolve();

async function runNotificationHelper(
  action: 'list' | 'delete' | 'delete-all',
  ...params: string[]
): Promise<string | null> {
  const task = notificationHelperTask.then(() => runNotificationHelperInternal(action, ...params));
  notificationHelperTask = task.catch(() => undefined);

  return task;
}

async function runNotificationHelperInternal(
  action: 'list' | 'delete' | 'delete-all',
  ...params: string[]
): Promise<string | null> {
  const helperAppPath = resolveNotificationHelperAppPath();
  const outputPath = path.join(
    os.tmpdir(),
    `nexus-notif-out-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );

  try {
    if (helperAppPath) {
      await execFileAsync(
        '/usr/bin/open',
        ['-a', helperAppPath, '--args', outputPath, action, ...params],
        { timeout: 5_000 },
      );
      await waitForOutputFile(outputPath, 20_000);
    } else {
      const binaryPath = resolveNotificationHelperBinary();

      if (!binaryPath) {
        return null;
      }

      await execFileAsync(binaryPath, [outputPath, action, ...params], {
        timeout: 20_000,
        maxBuffer: 4 * 1024 * 1024,
      });
    }

    return await fs.readFile(outputPath, 'utf8');
  } catch {
    return null;
  } finally {
    await fs.rm(outputPath, { force: true }).catch(() => undefined);
  }
}

function getFullDiskAccessAppBundlePath(): string {
  const helperPath = resolveNotificationHelperAppPath();

  if (helperPath) {
    return helperPath;
  }

  const executablePath = process.execPath;

  if (executablePath.includes('.app/')) {
    return executablePath.split('.app/')[0] + '.app';
  }

  return executablePath;
}

function getFullDiskAccessAppName(): string {
  if (process.platform !== 'darwin') {
    return 'Nexus IDE';
  }

  if (resolveNotificationHelperAppPath()) {
    return 'Nexus Notifications';
  }

  if (app.isPackaged) {
    return app.getName();
  }

  const bundlePath = getFullDiskAccessAppBundlePath();
  const bundleName = path.basename(bundlePath, '.app');

  return bundleName || 'Electron';
}

function resolveNotificationHelperAppPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'resources/shell/NotificationHelper.app'),
    path.join(app.getAppPath(), 'Contents/Helpers/NotificationHelper.app'),
    path.join(process.resourcesPath, '../Helpers/NotificationHelper.app'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveNotificationReaderBinaryPath(): string | null {
  const helperBinary = resolveNotificationHelperAppPath()
    ? path.join(resolveNotificationHelperAppPath()!, 'Contents/MacOS/NotificationHelper')
    : null;

  const candidates = [
    helperBinary,
    path.join(process.cwd(), 'resources/shell/macosNotificationReader'),
    path.join(process.resourcesPath, 'macosNotificationReader'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getLegacyDarwinNotificationDbPath(): string {
  const normalizedTmp = path.normalize(os.tmpdir().replace(/[/\\]$/, ''));
  const darwinRoot = path.dirname(path.dirname(normalizedTmp));

  return path.join(darwinRoot, '0/com.apple.notificationcenter/db2/db');
}

async function resolveNotificationDbCandidates(): Promise<string[]> {
  const candidates = new Set<string>([
    path.join(os.homedir(), 'Library/Group Containers/group.com.apple.usernoted/db2/db'),
    getLegacyDarwinNotificationDbPath(),
    path.join(
      os.homedir(),
      'Library/Group Containers/group.com.apple.UserNotifications/Library/Database/notification_db',
    ),
    path.join(
      os.homedir(),
      'Library/Group Containers/group.com.apple.UserNotifications/db/Database/notification_db',
    ),
  ]);

  try {
    const { stdout } = await execFileAsync('/usr/bin/getconf', ['DARWIN_USER_DIR']);
    const darwinUserDir = stdout.trim();

    if (darwinUserDir) {
      candidates.add(path.join(darwinUserDir, 'com.apple.notificationcenter/db2/db'));
    }
  } catch {
    // ignore
  }

  return Array.from(candidates);
}

async function openNotificationDbCopy(
  dbPath: string,
): Promise<{ db: DatabaseSync; tempPath: string } | null> {
  const tempPath = path.join(
    os.tmpdir(),
    `nexus-notif-open-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );

  try {
    await fs.copyFile(dbPath, tempPath);
    const db = new DatabaseSync(`file:${tempPath}?mode=ro&immutable=1`, { readOnly: true });
    return { db, tempPath };
  } catch {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    return null;
  }
}

async function openWritableNotificationDb(): Promise<DatabaseSync | null> {
  const dbPath = await resolveReadableNotificationDbPath();

  if (!dbPath) {
    return null;
  }

  try {
    return new DatabaseSync(dbPath);
  } catch {
    return null;
  }
}

async function deleteAllSystemNotificationsViaNode(limit: number): Promise<boolean> {
  const db = await openWritableNotificationDb();

  if (!db) {
    return false;
  }

  const safeLimit = Math.min(Math.max(Math.round(limit), 1), 500);

  try {
    let result = db
      .prepare(
        `
        DELETE FROM record WHERE rec_id IN (
          SELECT r.rec_id
          FROM record r
          WHERE r.delivered_date IS NOT NULL
          ORDER BY r.delivered_date DESC
          LIMIT ?
        )
      `,
      )
      .run(safeLimit);

    if (result.changes === 0) {
      result = db.prepare('DELETE FROM record WHERE delivered_date IS NOT NULL').run();
    }

    return result.changes > 0;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

async function tryDeleteViaHelper(
  action: 'delete' | 'delete-all',
  ...params: string[]
): Promise<boolean | null> {
  const raw = await runNotificationHelper(action, ...params);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw.trim()) as SwiftMutationResult;
    return parsed.success;
  } catch {
    return null;
  }
}

async function resolveReadableNotificationDbPath(): Promise<string | null> {
  const candidates = await resolveNotificationDbCandidates();

  for (const candidate of candidates) {
    const opened = await openNotificationDbCopy(candidate);

    if (opened) {
      opened.db.close();
      await fs.rm(opened.tempPath, { force: true }).catch(() => undefined);
      return candidate;
    }
  }

  return null;
}

function formatAppLabel(identifier: string): string {
  if (!identifier) {
    return 'Sistema';
  }

  if (KNOWN_APP_LABELS[identifier]) {
    return KNOWN_APP_LABELS[identifier];
  }

  const segment = identifier.split('.').pop() ?? identifier;

  return segment.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function parseDeliveredAt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return APPLE_EPOCH_MS + parsed * 1000;
}

function extractNotificationText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => extractNotificationText(entry))
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;

    for (const key of [
      'title',
      'titl',
      'subt',
      'sub',
      'subtitle',
      'body',
      'desc',
      'text',
      'message',
      'loc-key',
    ]) {
      const extracted = extractNotificationText(record[key]);

      if (extracted) {
        return extracted;
      }
    }

    for (const nestedValue of Object.values(record)) {
      const extracted = extractNotificationText(nestedValue);

      if (extracted) {
        return extracted;
      }
    }
  }

  return '';
}

async function parseNotificationPlist(binPath: string): Promise<{
  title: string;
  body: string;
  appId: string;
  deliveredAt: number;
} | null> {
  try {
    const { stdout } = await execFileAsync('/usr/bin/plutil', [
      '-convert',
      'json',
      '-o',
      '-',
      binPath,
    ]);

    const parsed = JSON.parse(stdout) as {
      app?: string;
      date?: number;
      req?: Record<string, unknown>;
      aps?: {
        alert?: Record<string, unknown> | string;
      };
    };

    const req = parsed.req ?? {};
    const alert =
      typeof parsed.aps?.alert === 'object' && parsed.aps?.alert !== null
        ? parsed.aps.alert
        : {};
    const alertTitle =
      typeof parsed.aps?.alert === 'string' ? parsed.aps.alert : extractNotificationText(alert);

    const title =
      extractNotificationText(req.titl) ||
      extractNotificationText(req.title) ||
      extractNotificationText(req.subt) ||
      extractNotificationText(req.sub) ||
      extractNotificationText(alert.title) ||
      alertTitle;
    const body =
      extractNotificationText(req.body) ||
      extractNotificationText(req.desc) ||
      extractNotificationText(alert.body) ||
      extractNotificationText(alert.subtitle);
    const appId = parsed.app ?? '';
    const deliveredAt =
      typeof parsed.date === 'number' ? APPLE_EPOCH_MS + parsed.date * 1000 : Date.now();

    if (!title && !body) {
      return null;
    }

    return {
      title: title || formatAppLabel(appId),
      body,
      appId,
      deliveredAt,
    };
  } catch {
    return null;
  }
}

async function parseNotificationBlob(data: Uint8Array | Buffer | null): Promise<{
  title: string;
  body: string;
  appId: string;
  deliveredAt: number;
} | null> {
  if (!data || data.byteLength === 0) {
    return null;
  }

  const tempPath = path.join(
    os.tmpdir(),
    `nexus-notif-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`,
  );

  try {
    await fs.writeFile(tempPath, Buffer.from(data));
    return await parseNotificationPlist(tempPath);
  } catch {
    return null;
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

interface SwiftNotificationPayload {
  id: string;
  appId: string;
  appLabel: string;
  title: string;
  body: string;
  deliveredAt: number;
}

interface SwiftNotificationSnapshot {
  accessGranted: boolean;
  items: SwiftNotificationPayload[];
}

interface SwiftMutationResult {
  success: boolean;
  accessGranted: boolean;
}

async function listSystemNotificationsViaSwift(
  limit: number,
): Promise<SystemNotificationsSnapshot | null> {
  const raw = await runNotificationHelper('list', String(limit));

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw.trim()) as SwiftNotificationSnapshot;

    return {
      platformSupported: true,
      accessGranted: parsed.accessGranted,
      fullDiskAccessAppName: getFullDiskAccessAppName(),
      fullDiskAccessAppPath: getFullDiskAccessAppBundlePath(),
      items: parsed.items.map((item) => ({
        id: item.id,
        appId: item.appId,
        appLabel: item.appLabel || formatAppLabel(item.appId),
        title: item.title,
        body: item.body,
        deliveredAt: item.deliveredAt,
        iconUrl: null,
      })),
    };
  } catch {
    return null;
  }
}

async function finalizeNotificationSnapshot(
  snapshot: SystemNotificationsSnapshot,
): Promise<SystemNotificationsSnapshot> {
  return {
    ...snapshot,
    items: systemNotificationDismissStore.filterItems(snapshot.items),
  };
}

async function fetchSystemNotificationsSnapshot(
  limit = DEFAULT_LIMIT,
): Promise<SystemNotificationsSnapshot> {
  const fullDiskAccessAppName = getFullDiskAccessAppName();
  const fullDiskAccessAppPath = getFullDiskAccessAppBundlePath();

  if (process.platform !== 'darwin') {
    return {
      platformSupported: false,
      accessGranted: false,
      fullDiskAccessAppName: null,
      fullDiskAccessAppPath: null,
      items: [],
    };
  }

  const safeLimit = Math.min(Math.max(Math.round(limit), 1), 50);
  const swiftSnapshot = await listSystemNotificationsViaSwift(safeLimit);

  if (swiftSnapshot?.accessGranted) {
    return swiftSnapshot;
  }

  const nodeSnapshot = await listSystemNotificationsViaNode(safeLimit);

  if (nodeSnapshot.accessGranted) {
    return nodeSnapshot;
  }

  if (swiftSnapshot) {
    return swiftSnapshot;
  }

  return nodeSnapshot;
}

async function listSystemNotificationsViaNode(
  limit: number,
): Promise<SystemNotificationsSnapshot> {
  const fullDiskAccessAppName = getFullDiskAccessAppName();
  const fullDiskAccessAppPath = getFullDiskAccessAppBundlePath();
  const dbPath = await resolveReadableNotificationDbPath();

  if (!dbPath) {
    return {
      platformSupported: true,
      accessGranted: false,
      fullDiskAccessAppName,
      fullDiskAccessAppPath,
      items: [],
    };
  }

  const safeLimit = Math.min(Math.max(Math.round(limit), 1), 50);
  const opened = await openNotificationDbCopy(dbPath);

  if (!opened) {
    return {
      platformSupported: true,
      accessGranted: false,
      fullDiskAccessAppName,
      fullDiskAccessAppPath,
      items: [],
    };
  }

  const { db, tempPath } = opened;

  try {
    const rows = db
      .prepare(
        `
        SELECT
          r.rec_id AS rec_id,
          COALESCE(a.identifier, '') AS identifier,
          r.delivered_date AS delivered_date,
          r.data AS data
        FROM record r
        LEFT JOIN app a ON r.app_id = a.app_id
        WHERE r.delivered_date IS NOT NULL
        ORDER BY r.delivered_date DESC
        LIMIT ?
      `,
      )
      .all(safeLimit) as Array<{
      rec_id: number;
      identifier: string;
      delivered_date: number;
      data: Uint8Array | null;
    }>;

    const items: SystemNotificationItem[] = [];

    for (const row of rows) {
      const recIdNum = row.rec_id;
      const identifier = row.identifier ?? '';
      const parsed = await parseNotificationBlob(row.data);

      if (parsed) {
        items.push({
          id: `sys-${recIdNum}`,
          appId: parsed.appId || identifier,
          appLabel: formatAppLabel(parsed.appId || identifier),
          title: parsed.title,
          body: parsed.body,
          deliveredAt: parseDeliveredAt(row.delivered_date, parsed.deliveredAt),
          iconUrl: null,
        });
        continue;
      }

      if (identifier) {
        items.push({
          id: `sys-${recIdNum}`,
          appId: identifier,
          appLabel: formatAppLabel(identifier),
          title: formatAppLabel(identifier),
          body: '',
          deliveredAt: parseDeliveredAt(row.delivered_date, Date.now()),
          iconUrl: null,
        });
      }
    }

    return {
      platformSupported: true,
      accessGranted: true,
      fullDiskAccessAppName,
      fullDiskAccessAppPath,
      items,
    };
  } catch {
    return {
      platformSupported: true,
      accessGranted: false,
      fullDiskAccessAppName,
      fullDiskAccessAppPath,
      items: [],
    };
  } finally {
    db.close();
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

export async function openFullDiskAccessSettings(): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }

  const settingsUrls = [
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
  ];

  for (const url of settingsUrls) {
    try {
      await shell.openExternal(url);
      return;
    } catch {
      // try next url
    }
  }
}

export async function revealFullDiskAccessAppInFinder(): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }

  shell.showItemInFolder(getFullDiskAccessAppBundlePath());
}

export async function listSystemNotifications(
  limit = DEFAULT_LIMIT,
): Promise<SystemNotificationsSnapshot> {
  const snapshot = await fetchSystemNotificationsSnapshot(limit);
  return finalizeNotificationSnapshot(snapshot);
}

function parseNotificationRecId(id: string): number | null {
  const match = /^sys-(\d+)$/.exec(id);

  if (!match) {
    return null;
  }

  const recId = Number.parseInt(match[1], 10);

  return Number.isFinite(recId) ? recId : null;
}

export async function deleteSystemNotification(id: string): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false;
  }

  if (!parseNotificationRecId(id)) {
    return false;
  }

  systemNotificationDismissStore.dismiss(id);
  return true;
}

export async function deleteAllSystemNotifications(limit = DEFAULT_LIMIT): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false;
  }

  const safeLimit = Math.min(Math.max(Math.round(limit), 1), 500);
  const snapshot = await fetchSystemNotificationsSnapshot(Math.max(safeLimit, DEFAULT_LIMIT));
  systemNotificationDismissStore.dismissMany(snapshot.items.map((item) => item.id));

  const helperResult = await tryDeleteViaHelper('delete-all', String(safeLimit));

  if (helperResult === true) {
    return true;
  }

  await deleteAllSystemNotificationsViaNode(safeLimit);
  return true;
}

export async function openSystemNotificationApp(appId: string): Promise<void> {
  if (!appId || process.platform !== 'darwin') {
    return;
  }

  try {
    await execFileAsync('/usr/bin/open', ['-b', appId]);
  } catch {
    // ignore
  }
}

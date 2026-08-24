import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { app, shell } from 'electron';
import type {
  CalendarCalendarsSnapshot,
  CalendarCreateEventInput,
  CalendarDeleteEventInput,
  CalendarEventItem,
  CalendarEventsSnapshot,
  CalendarFullEventItem,
  CalendarMutationResult,
  CalendarRangeEventsSnapshot,
  CalendarUpdateEventInput,
} from '../../types';

const execFileAsync = promisify(execFile);

const FIELD_DELIMITER = '\u001f';
const ENTRY_DELIMITER = '\u001e';
const MAC_EPOCH_MS = Date.UTC(2001, 0, 1);
const HELPER_TIMEOUT_MS = 120_000;
const MAX_CALENDAR_EVENTS = 3;
const CALENDAR_CACHE_TTL_MS = 20_000;

let calendarHelperTask: Promise<string | null> | null = null;
let calendarHelperChain: Promise<void> = Promise.resolve();
let lastHelperTimedOut = false;
let todayEventsCache: { expiresAt: number; value: CalendarEventsSnapshot } | null = null;
let calendarsCache: { expiresAt: number; value: CalendarCalendarsSnapshot } | null = null;
const rangeEventsCache = new Map<string, { expiresAt: number; value: CalendarRangeEventsSnapshot }>();

function invalidateCalendarCaches(): void {
  todayEventsCache = null;
  calendarsCache = null;
  rangeEventsCache.clear();
}

function enqueueCalendarHelper<T>(operation: () => Promise<T>): Promise<T> {
  const run = calendarHelperChain.then(operation, operation);
  calendarHelperChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function emptySnapshot(
  platformSupported: boolean,
  accessGranted = false,
  available = false,
  permissionDenied = false,
): CalendarEventsSnapshot {
  return {
    platformSupported,
    accessGranted,
    available,
    permissionDenied,
    events: [],
  };
}

function resolveCalendarHelperAppPath(): string | null {
  const candidates = [
    path.join(path.dirname(process.execPath), '../Helpers/CalendarHelper.app'),
    path.join(process.cwd(), 'build/Nexus.app/Contents/Helpers/CalendarHelper.app'),
    path.join(process.resourcesPath, '../Helpers/CalendarHelper.app'),
    path.join(app.getAppPath(), 'Contents/Helpers/CalendarHelper.app'),
  ];

  for (const candidate of candidates) {
    const binaryPath = path.join(candidate, 'Contents/MacOS/CalendarHelper');

    if (fs.existsSync(binaryPath)) {
      return candidate;
    }
  }

  return null;
}

function resolveCalendarHelperBinaryPath(): string | null {
  const appPath = resolveCalendarHelperAppPath();

  if (appPath) {
    const binaryPath = path.join(appPath, 'Contents/MacOS/CalendarHelper');

    if (fs.existsSync(binaryPath)) {
      return binaryPath;
    }
  }

  const sourceBinary = path.join(process.cwd(), 'resources/shell/macosCalendarHelper');

  if (fs.existsSync(sourceBinary)) {
    return sourceBinary;
  }

  return null;
}

function parseNumber(value: string | undefined): number {
  if (!value?.trim()) {
    return 0;
  }

  const parsed = Number.parseInt(value.trim(), 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function unescapeField(value: string): string {
  let result = '';
  let index = 0;

  while (index < value.length) {
    if (value[index] === '\\' && index + 1 < value.length) {
      const next = value[index + 1];

      if (next === 'n') {
        result += '\n';
        index += 2;
        continue;
      }

      if (next === 'r') {
        result += '\r';
        index += 2;
        continue;
      }

      if (next === '\\') {
        result += '\\';
        index += 2;
        continue;
      }

      if (value.startsWith('\\u001f', index)) {
        result += FIELD_DELIMITER;
        index += 6;
        continue;
      }

      if (value.startsWith('\\u001e', index)) {
        result += ENTRY_DELIMITER;
        index += 6;
        continue;
      }
    }

    result += value[index];
    index += 1;
  }

  return result;
}

function parseEvents(raw: string): CalendarEventItem[] {
  const events: CalendarEventItem[] = [];

  for (const entry of raw.split(ENTRY_DELIMITER)) {
    if (!entry.trim()) {
      continue;
    }

    const parts = entry.split(FIELD_DELIMITER);

    if (parts.length < 8) {
      continue;
    }

    const [id, title, startAtRaw, endAtRaw, location, calendarName, colorHex, allDayRaw, notes = '', url = ''] = parts;

    events.push({
      id: unescapeField(id).trim(),
      title: unescapeField(title).trim() || '(Sem título)',
      startAt: parseNumber(startAtRaw),
      endAt: parseNumber(endAtRaw),
      location: unescapeField(location).trim(),
      calendarName: unescapeField(calendarName).trim(),
      colorHex: unescapeField(colorHex).trim() || '#FFCC00',
      allDay: allDayRaw.trim() === '1',
      notes: unescapeField(notes).trim(),
      url: unescapeField(url).trim(),
    });
  }

  return events;
}

function limitCalendarEvents(events: CalendarEventItem[]): CalendarEventItem[] {
  const seen = new Set<string>();
  const unique: CalendarEventItem[] = [];

  for (const event of events) {
    const key = `${event.title.trim().toLowerCase()}|${event.startAt}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(event);
  }

  return unique.sort((left, right) => left.startAt - right.startAt).slice(0, MAX_CALENDAR_EVENTS);
}

function buildSnapshotFromRaw(raw: string): CalendarEventsSnapshot {
  const trimmed = raw.trim();

  if (trimmed === 'DENIED') {
    return emptySnapshot(true, false, false, true);
  }

  if (trimmed === 'ERROR') {
    return emptySnapshot(true, true, false, false);
  }

  const events = limitCalendarEvents(parseEvents(trimmed));

  return {
    platformSupported: true,
    accessGranted: true,
    available: true,
    permissionDenied: false,
    events,
  };
}

async function readHelperOutput(outputPath: string): Promise<string | null> {
  if (!fs.existsSync(outputPath)) {
    return null;
  }

  return fs.readFileSync(outputPath, 'utf8').trim();
}

async function waitForOutputFile(outputPath: string, timeoutMs: number): Promise<string | null> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(outputPath)) {
      try {
        const content = fs.readFileSync(outputPath, 'utf8').trim();

        if (content.length > 0) {
          return content;
        }
      } catch {
      }
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 80);
    });
  }

  return null;
}

async function runCalendarHelperBinary(
  helperAppPath: string,
  background: boolean,
  actionArgs: string[] = [],
): Promise<string | null> {
  const outputPath = path.join(os.tmpdir(), `nexus-calendar-${process.pid}-${Date.now()}.txt`);

  try {
    const openArgs = ['/usr/bin/open'];

    if (background) {
      openArgs.push('-g');
    }

    openArgs.push('-W', '-a', helperAppPath, '--args', outputPath, ...actionArgs);

    await execFileAsync(openArgs[0], openArgs.slice(1), {
      timeout: HELPER_TIMEOUT_MS,
    });

    return readHelperOutput(outputPath);
  } catch {
    return null;
  } finally {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  }
}

async function clearStaleCalendarHelpers(): Promise<void> {
  if (!lastHelperTimedOut) {
    return;
  }

  try {
    await execFileAsync('/usr/bin/pkill', ['-x', 'CalendarHelper']);
  } catch {
  }
  lastHelperTimedOut = false;
  await new Promise((resolve) => {
    setTimeout(resolve, 80);
  });
}

async function runCalendarHelperCommand(action: string, ...params: string[]): Promise<string | null> {
  return enqueueCalendarHelper(async () => {
    const helperAppPath = resolveCalendarHelperAppPath();
    const binaryPath = resolveCalendarHelperBinaryPath();
    const maxAttempts = 2;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const outputPath = path.join(
        os.tmpdir(),
        `nexus-calendar-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
      );

      try {
        if (attempt > 0) {
          lastHelperTimedOut = true;
        }
        await clearStaleCalendarHelpers();

        if (helperAppPath) {
          await execFileAsync(
            '/usr/bin/open',
            ['-g', '-W', '-a', helperAppPath, '--args', outputPath, action, ...params],
            { timeout: HELPER_TIMEOUT_MS },
          );
          const waited = await waitForOutputFile(outputPath, 2_000);
          const raw = waited ?? (await readHelperOutput(outputPath));
          if (raw) {
            return raw;
          }
        } else if (binaryPath) {
          await execFileAsync(binaryPath, [outputPath, action, ...params], {
            timeout: HELPER_TIMEOUT_MS,
            maxBuffer: 8 * 1024 * 1024,
          });
          const raw = await readHelperOutput(outputPath);
          if (raw) {
            return raw;
          }
        } else {
          return null;
        }
      } catch {
        lastHelperTimedOut = true;
      } finally {
        await fs.promises.rm(outputPath, { force: true }).catch(() => undefined);
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 250 * (attempt + 1));
      });
    }

    return null;
  });
}

async function runCalendarHelperAppDialog(helperAppPath: string): Promise<string | null> {
  const outputPath = path.join(os.tmpdir(), `nexus-calendar-${process.pid}-${Date.now()}.txt`);

  try {
    await execFileAsync(
      '/usr/bin/open',
      ['-W', '-a', helperAppPath, '--args', outputPath, 'requestAccess'],
      { timeout: HELPER_TIMEOUT_MS },
    );
    return readHelperOutput(outputPath);
  } catch {
    return null;
  } finally {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  }
}

async function runCalendarHelperInternal(requestDialog: boolean): Promise<string | null> {
  const helperAppPath = resolveCalendarHelperAppPath();

  if (!helperAppPath) {
    const binaryPath = resolveCalendarHelperBinaryPath();

    if (!binaryPath) {
      return null;
    }

    const outputPath = path.join(os.tmpdir(), `nexus-calendar-${process.pid}-${Date.now()}.txt`);

    try {
      await execFileAsync(binaryPath, [outputPath], {
        timeout: HELPER_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      });
      return await readHelperOutput(outputPath);
    } catch {
      return null;
    } finally {
      await fs.promises.rm(outputPath, { force: true }).catch(() => undefined);
    }
  }

  if (!requestDialog) {
    return runCalendarHelperBinary(helperAppPath, true);
  }

  const silentRaw = await runCalendarHelperBinary(helperAppPath, true);

  if (silentRaw !== null && silentRaw !== 'DENIED') {
    return silentRaw;
  }

  return runCalendarHelperAppDialog(helperAppPath);
}

async function runCalendarHelper(requestDialog: boolean): Promise<string | null> {
  return enqueueCalendarHelper(async () => {
    if (calendarHelperTask) {
      return calendarHelperTask;
    }

    calendarHelperTask = runCalendarHelperInternal(requestDialog).finally(() => {
      calendarHelperTask = null;
    });

    return calendarHelperTask;
  });
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function requestCalendarAccess(): Promise<CalendarEventsSnapshot> {
  if (process.platform !== 'darwin') {
    return emptySnapshot(false);
  }

  invalidateCalendarCaches();
  const raw = await runCalendarHelper(true);

  if (raw !== null && raw !== 'ERROR') {
    const snapshot = buildSnapshotFromRaw(raw);
    todayEventsCache = {
      expiresAt: Date.now() + CALENDAR_CACHE_TTL_MS,
      value: snapshot,
    };
    return snapshot;
  }

  return emptySnapshot(true, false, false, false);
}

export async function getCalendarEventsSnapshot(): Promise<CalendarEventsSnapshot> {
  if (process.platform !== 'darwin') {
    return emptySnapshot(false);
  }

  const now = Date.now();
  if (todayEventsCache && todayEventsCache.expiresAt > now) {
    return todayEventsCache.value;
  }

  const raw = await runCalendarHelper(false);

  if (raw === 'DENIED') {
    const denied = emptySnapshot(true, false, false, true);
    todayEventsCache = { expiresAt: now + CALENDAR_CACHE_TTL_MS, value: denied };
    return denied;
  }

  if (raw !== null && raw !== 'ERROR') {
    const snapshot = buildSnapshotFromRaw(raw);
    todayEventsCache = { expiresAt: now + CALENDAR_CACHE_TTL_MS, value: snapshot };
    return snapshot;
  }

  return emptySnapshot(true, false, false, false);
}

export async function getCalendarCalendarsSnapshot(): Promise<CalendarCalendarsSnapshot> {
  if (process.platform !== 'darwin') {
    return { platformSupported: false, accessGranted: false, accounts: [] };
  }

  const now = Date.now();
  if (calendarsCache && calendarsCache.expiresAt > now) {
    return calendarsCache.value;
  }

  const raw = await runCalendarHelperCommand('calendars');
  const parsed = parseJson<Omit<CalendarCalendarsSnapshot, 'platformSupported'>>(raw);

  if (!parsed) {
    return { platformSupported: true, accessGranted: false, accounts: [] };
  }

  const snapshot = {
    platformSupported: true,
    accessGranted: parsed.accessGranted,
    accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
  };
  if (snapshot.accessGranted) {
    calendarsCache = { expiresAt: now + CALENDAR_CACHE_TTL_MS, value: snapshot };
  }
  return snapshot;
}

export async function getCalendarEventsInRange(
  startAt: number,
  endAt: number,
): Promise<CalendarRangeEventsSnapshot> {
  if (process.platform !== 'darwin') {
    return {
      platformSupported: false,
      accessGranted: false,
      available: false,
      events: [],
    };
  }

  const cacheKey = `${Math.floor(startAt)}:${Math.floor(endAt)}`;
  const now = Date.now();
  const cached = rangeEventsCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const raw = await runCalendarHelperCommand('events', String(Math.floor(startAt)), String(Math.floor(endAt)));
  const parsed = parseJson<Omit<CalendarRangeEventsSnapshot, 'platformSupported'>>(raw);

  if (!parsed) {
    return {
      platformSupported: true,
      accessGranted: raw !== null,
      available: false,
      events: [],
    };
  }

  const snapshot = {
    platformSupported: true,
    accessGranted: Boolean(parsed.accessGranted),
    available: Boolean(parsed.available),
    events: Array.isArray(parsed.events) ? (parsed.events as CalendarFullEventItem[]) : [],
  };
  if (snapshot.available) {
    rangeEventsCache.set(cacheKey, { expiresAt: now + CALENDAR_CACHE_TTL_MS, value: snapshot });
  }
  return snapshot;
}

export async function createCalendarEvent(input: CalendarCreateEventInput): Promise<CalendarMutationResult> {
  if (process.platform !== 'darwin') {
    return { ok: false, event: null, error: 'unsupported' };
  }

  invalidateCalendarCaches();
  const raw = await runCalendarHelperCommand('create', JSON.stringify(input));
  const parsed = parseJson<CalendarMutationResult>(raw);

  return parsed ?? { ok: false, event: null, error: 'failed' };
}

export async function updateCalendarEvent(input: CalendarUpdateEventInput): Promise<CalendarMutationResult> {
  if (process.platform !== 'darwin') {
    return { ok: false, event: null, error: 'unsupported' };
  }

  invalidateCalendarCaches();
  const raw = await runCalendarHelperCommand('update', JSON.stringify(input));
  const parsed = parseJson<CalendarMutationResult>(raw);

  return parsed ?? { ok: false, event: null, error: 'failed' };
}

export async function deleteCalendarEvent(input: CalendarDeleteEventInput): Promise<CalendarMutationResult> {
  if (process.platform !== 'darwin') {
    return { ok: false, event: null, error: 'unsupported' };
  }

  invalidateCalendarCaches();
  const raw = await runCalendarHelperCommand('delete', JSON.stringify(input));
  const parsed = parseJson<CalendarMutationResult>(raw);

  return parsed ?? { ok: false, event: null, error: 'failed' };
}

export async function openCalendarEvent(startAt: number): Promise<void> {
  if (process.platform !== 'darwin' || !Number.isFinite(startAt) || startAt <= 0) {
    return;
  }

  const seconds = Math.floor((startAt - MAC_EPOCH_MS) / 1000);
  await shell.openExternal(`calshow:${seconds}`);
}

export async function openCalendarPrivacySettings(): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }

  await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars');
}

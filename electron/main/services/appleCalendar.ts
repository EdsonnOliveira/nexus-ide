import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { app, BrowserWindow, shell } from 'electron';
import type { CalendarEventItem, CalendarEventsSnapshot } from '../../types';

const execFileAsync = promisify(execFile);

const FIELD_DELIMITER = '\u001f';
const ENTRY_DELIMITER = '\u001e';
const MAC_EPOCH_MS = Date.UTC(2001, 0, 1);
const HELPER_TIMEOUT_MS = 120_000;

let calendarHelperTask: Promise<string | null> | null = null;

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
  const helperAppPath = resolveCalendarHelperAppPath();

  if (!helperAppPath) {
    return null;
  }

  const binaryPath = path.join(helperAppPath, 'Contents/MacOS/CalendarHelper');

  return fs.existsSync(binaryPath) ? binaryPath : null;
}

export function focusApplicationWindow(): void {
  app.focus({ steal: true });

  const focusedWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

  if (focusedWindow && !focusedWindow.isDestroyed()) {
    focusedWindow.show();
    focusedWindow.focus();
  }
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

function buildSnapshotFromRaw(raw: string): CalendarEventsSnapshot {
  const trimmed = raw.trim();

  if (trimmed === 'DENIED') {
    return emptySnapshot(true, false, false, true);
  }

  if (trimmed === 'ERROR') {
    return emptySnapshot(true, true, false, false);
  }

  const events = parseEvents(trimmed);

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

async function runCalendarHelperBinary(binaryPath: string): Promise<string | null> {
  const outputPath = path.join(os.tmpdir(), `nexus-calendar-${process.pid}-${Date.now()}.txt`);

  try {
    await execFileAsync(binaryPath, [outputPath], {
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

async function runCalendarHelperAppDialog(helperAppPath: string): Promise<string | null> {
  focusApplicationWindow();

  const outputPath = path.join(os.tmpdir(), `nexus-calendar-${process.pid}-${Date.now()}.txt`);

  try {
    await execFileAsync('/usr/bin/open', ['-W', '-a', helperAppPath, '--args', outputPath], {
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

async function runCalendarHelperInternal(requestDialog: boolean): Promise<string | null> {
  const helperAppPath = resolveCalendarHelperAppPath();
  const binaryPath = resolveCalendarHelperBinaryPath();

  if (!helperAppPath || !binaryPath) {
    return null;
  }

  if (!requestDialog) {
    return runCalendarHelperBinary(binaryPath);
  }

  const silentRaw = await runCalendarHelperBinary(binaryPath);

  if (silentRaw !== null && silentRaw !== 'DENIED') {
    return silentRaw;
  }

  return runCalendarHelperAppDialog(helperAppPath);
}

async function runCalendarHelper(requestDialog: boolean): Promise<string | null> {
  if (calendarHelperTask) {
    return calendarHelperTask;
  }

  calendarHelperTask = runCalendarHelperInternal(requestDialog).finally(() => {
    calendarHelperTask = null;
  });

  return calendarHelperTask;
}

export async function requestCalendarAccess(): Promise<CalendarEventsSnapshot> {
  if (process.platform !== 'darwin') {
    return emptySnapshot(false);
  }

  const raw = await runCalendarHelper(true);

  if (raw !== null) {
    return buildSnapshotFromRaw(raw);
  }

  return emptySnapshot(true, false, false, false);
}

export async function getCalendarEventsSnapshot(): Promise<CalendarEventsSnapshot> {
  if (process.platform !== 'darwin') {
    return emptySnapshot(false);
  }

  const raw = await runCalendarHelper(false);

  if (raw !== null) {
    return buildSnapshotFromRaw(raw);
  }

  return emptySnapshot(true, false, false, false);
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

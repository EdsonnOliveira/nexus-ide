import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const rootDir = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const calendarHelperSourcePath = path.join(rootDir, 'resources/shell/macosCalendarHelper.swift');
const calendarHelperBinaryPath = path.join(rootDir, 'resources/shell/macosCalendarHelper');
const notificationReaderSourcePath = path.join(rootDir, 'resources/shell/macosNotificationReader.swift');
const notificationReaderBinaryPath = path.join(rootDir, 'resources/shell/macosNotificationReader');
const notificationHelperAppPath = path.join(rootDir, 'resources/shell/NotificationHelper.app');
const notificationHelperBinaryPath = path.join(
  notificationHelperAppPath,
  'Contents/MacOS/NotificationHelper',
);
const notificationHelperInfoPlistPath = path.join(rootDir, 'resources/shell/NotificationHelper-Info.plist');

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (process.platform !== 'darwin') {
  process.exit(0);
}

if (existsSync(calendarHelperSourcePath)) {
  run('swiftc', [
    '-o',
    calendarHelperBinaryPath,
    calendarHelperSourcePath,
    '-framework',
    'EventKit',
    '-framework',
    'AppKit',
  ]);
  execFileSync('chmod', ['+x', calendarHelperBinaryPath]);
}

if (existsSync(notificationReaderSourcePath)) {
  run('swiftc', ['-o', notificationReaderBinaryPath, notificationReaderSourcePath, '-l', 'sqlite3']);
  execFileSync('chmod', ['+x', notificationReaderBinaryPath]);
  mkdirSync(path.dirname(notificationHelperBinaryPath), { recursive: true });
  copyFileSync(notificationReaderBinaryPath, notificationHelperBinaryPath);
  execFileSync('chmod', ['+x', notificationHelperBinaryPath]);
  copyFileSync(
    notificationHelperInfoPlistPath,
    path.join(notificationHelperAppPath, 'Contents/Info.plist'),
  );

  try {
    execFileSync('codesign', ['--force', '-s', '-', notificationHelperAppPath]);
  } catch {
    // adhoc sign optional during build
  }
}

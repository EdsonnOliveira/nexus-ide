import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const appPath = path.join(root, 'release/mac-universal/Nexus IDE.app');
const dmgPath = path.join(root, `release/Nexus IDE-${version}-universal.dmg`);

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

if (!existsSync(appPath)) {
  console.error(`App not found: ${appPath}`);
  process.exit(1);
}

run('xattr', ['-cr', appPath]);

const calendarHelperAppPath = path.join(appPath, 'Contents/Helpers/CalendarHelper.app');
const notificationHelperAppPath = path.join(appPath, 'Contents/Helpers/NotificationHelper.app');

for (const helperAppPath of [calendarHelperAppPath, notificationHelperAppPath]) {
  if (existsSync(helperAppPath)) {
    run('codesign', ['--force', '-s', '-', helperAppPath]);
  }
}

run('codesign', ['--force', '--deep', '-s', '-', appPath]);

if (existsSync(dmgPath)) {
  run('xattr', ['-cr', dmgPath]);
}

console.log(`Local build ready: ${appPath}`);

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appPath = path.join(root, 'release/mac-universal/Nexus IDE.app');
const dmgPath = path.join(root, 'release/Nexus IDE-1.0.0-universal.dmg');

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

if (!existsSync(appPath)) {
  console.error(`App not found: ${appPath}`);
  process.exit(1);
}

run('xattr', ['-cr', appPath]);

if (existsSync(dmgPath)) {
  run('xattr', ['-cr', dmgPath]);
}

console.log(`Local build ready: ${appPath}`);

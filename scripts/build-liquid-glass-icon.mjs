import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const rootDir = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const iconBundlePath = path.join(rootDir, 'build/Nexus.icon');
const compileOutputDir = path.join(rootDir, 'build/liquid-glass-out');
const assetsCarPath = path.join(rootDir, 'build/Assets.car');
const partialPlistPath = path.join(compileOutputDir, 'assetcatalog_generated_info.plist');
const assembleScript = path.join(rootDir, 'scripts/assemble-nexus-icon.py');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });

  return result.status ?? 1;
}

function assembleIconBundle() {
  if (!existsSync(assembleScript)) {
    console.warn('[build-liquid-glass-icon] assemble-nexus-icon.py not found.');
    return false;
  }

  const python = spawnSync('python3', [assembleScript], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  if (python.status !== 0) {
    console.warn('[build-liquid-glass-icon] Could not assemble Nexus.icon (Pillow missing?).');
    return false;
  }

  return existsSync(path.join(iconBundlePath, 'icon.json'));
}

function compileAssetsCar() {
  if (process.platform !== 'darwin') {
    return false;
  }

  if (!existsSync(iconBundlePath)) {
    console.warn('[build-liquid-glass-icon] Nexus.icon bundle missing.');
    return false;
  }

  if (existsSync(compileOutputDir)) {
    rmSync(compileOutputDir, { recursive: true, force: true });
  }
  mkdirSync(compileOutputDir, { recursive: true });

  const status = run('xcrun', [
    'actool',
    iconBundlePath,
    '--compile',
    compileOutputDir,
    '--output-format',
    'human-readable-text',
    '--output-partial-info-plist',
    partialPlistPath,
    '--app-icon',
    'Nexus',
    '--include-all-app-icons',
    '--enable-on-demand-resources',
    'NO',
    '--development-region',
    'en',
    '--target-device',
    'mac',
    '--minimum-deployment-target',
    '26.0',
    '--platform',
    'macosx',
  ]);

  if (status !== 0) {
    console.warn('[build-liquid-glass-icon] actool failed; using legacy .icns only.');
    return false;
  }

  const compiledCar = path.join(compileOutputDir, 'Assets.car');
  if (!existsSync(compiledCar)) {
    console.warn('[build-liquid-glass-icon] Assets.car was not produced.');
    return false;
  }

  copyFileSync(compiledCar, assetsCarPath);

  if (existsSync(partialPlistPath)) {
    rmSync(partialPlistPath, { force: true });
  }

  console.log('[build-liquid-glass-icon] Assets.car ready.');
  return true;
}

if (assembleIconBundle()) {
  compileAssetsCar();
}

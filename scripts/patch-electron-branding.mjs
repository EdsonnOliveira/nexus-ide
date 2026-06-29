import { copyFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const rootDir = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const electronSourceAppPath = path.join(rootDir, 'node_modules/electron/dist/Electron.app');
const nexusAppPath = path.join(rootDir, 'build/Nexus.app');
const nexusInfoPlistPath = path.join(nexusAppPath, 'Contents/Info.plist');
const nexusIconPath = path.join(nexusAppPath, 'Contents/Resources/electron.icns');
const nexusBinaryPath = path.join(nexusAppPath, 'Contents/MacOS/Electron');
const builtIconPath = path.join(rootDir, 'build/icon.icns');
const iconPngPath = path.join(rootDir, 'build/icon.png');
const generateIconScript = path.join(rootDir, 'scripts/generate-macos-app-icon.py');
const buildLiquidGlassScript = path.join(rootDir, 'scripts/build-liquid-glass-icon.mjs');
const assetsCarPath = path.join(rootDir, 'build/Assets.car');
const nexusAssetsCarPath = path.join(nexusAppPath, 'Contents/Resources/Assets.car');
const dockName = 'Nexus';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function generateMacAppIcons() {
  if (!existsSync(generateIconScript)) {
    return;
  }

  const python = spawnSync('python3', [generateIconScript], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  if (python.status !== 0) {
    console.warn('[patch-electron-branding] Could not generate macOS icon (Pillow missing?).');
    return;
  }

  if (process.platform !== 'darwin' || !existsSync(iconPngPath)) {
    return;
  }

  const iconsetDir = path.join(rootDir, 'build/icon.iconset');
  run('mkdir', ['-p', iconsetDir]);

  const sizes = [
    ['16', '16', 'icon_16x16.png'],
    ['32', '32', 'icon_16x16@2x.png'],
    ['32', '32', 'icon_32x32.png'],
    ['64', '64', 'icon_32x32@2x.png'],
    ['128', '128', 'icon_128x128.png'],
    ['256', '256', 'icon_128x128@2x.png'],
    ['256', '256', 'icon_256x256.png'],
    ['512', '512', 'icon_256x256@2x.png'],
    ['512', '512', 'icon_512x512.png'],
    ['1024', '1024', 'icon_512x512@2x.png'],
  ];

  for (const [width, height, filename] of sizes) {
    run('sips', ['-z', width, height, iconPngPath, '--out', path.join(iconsetDir, filename)]);
  }

  run('iconutil', ['-c', 'icns', iconsetDir, '-o', builtIconPath]);
  run('rm', ['-rf', iconsetDir]);
  run('bash', ['-lc', 'npx --yes png-to-ico build/icon.png > build/icon.ico']);
}

function buildLiquidGlassIcon() {
  if (!existsSync(buildLiquidGlassScript)) {
    return;
  }

  const result = spawnSync(process.execPath, [buildLiquidGlassScript], {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    console.warn('[patch-electron-branding] Liquid glass icon build failed; using legacy .icns only.');
  }
}

function patchNexusAppBundle() {
  if (process.platform !== 'darwin') {
    return null;
  }

  if (!existsSync(electronSourceAppPath)) {
    console.warn('[patch-electron-branding] Electron.app not found, skipping.');
    return null;
  }

  if (existsSync(nexusAppPath)) {
    rmSync(nexusAppPath, { recursive: true, force: true });
  }

  run('cp', ['-R', electronSourceAppPath, nexusAppPath]);

  try {
    execFileSync('plutil', ['-replace', 'CFBundleDisplayName', '-string', dockName, nexusInfoPlistPath]);
    execFileSync('plutil', ['-replace', 'CFBundleName', '-string', dockName, nexusInfoPlistPath]);
  } catch (error) {
    console.error('[patch-electron-branding] Failed to patch Nexus.app Info.plist', error);
    process.exit(1);
  }

  if (existsSync(builtIconPath) && existsSync(path.dirname(nexusIconPath))) {
    copyFileSync(builtIconPath, nexusIconPath);
  }

  if (existsSync(assetsCarPath) && existsSync(path.dirname(nexusAssetsCarPath))) {
    copyFileSync(assetsCarPath, nexusAssetsCarPath);
    try {
      execFileSync('plutil', ['-replace', 'CFBundleIconName', '-string', dockName, nexusInfoPlistPath]);
    } catch (error) {
      console.error('[patch-electron-branding] Failed to set CFBundleIconName', error);
      process.exit(1);
    }
  }

  if (!existsSync(nexusBinaryPath)) {
    console.warn('[patch-electron-branding] Nexus.app binary not found.');
    return null;
  }

  console.log(`[patch-electron-branding] Nexus.app ready as "${dockName}".`);
  return nexusBinaryPath;
}

generateMacAppIcons();
buildLiquidGlassIcon();
patchNexusAppBundle();

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
const calendarHelperSourcePath = path.join(rootDir, 'resources/shell/macosCalendarHelper.swift');
const calendarHelperBinaryPath = path.join(rootDir, 'resources/shell/macosCalendarHelper');
const calendarHelperInfoPlistPath = path.join(rootDir, 'resources/shell/CalendarHelper-Info.plist');
const notificationReaderSourcePath = path.join(rootDir, 'resources/shell/macosNotificationReader.swift');
const notificationReaderBinaryPath = path.join(rootDir, 'resources/shell/macosNotificationReader');
const notificationHelperAppPath = path.join(rootDir, 'resources/shell/NotificationHelper.app');
const notificationHelperBinaryPath = path.join(
  notificationHelperAppPath,
  'Contents/MacOS/NotificationHelper',
);
const notificationHelperInfoPlistPath = path.join(rootDir, 'resources/shell/NotificationHelper-Info.plist');
const nexusNotificationHelperAppPath = path.join(nexusAppPath, 'Contents/Helpers/NotificationHelper.app');
const nexusNotificationHelperBinaryPath = path.join(
  nexusNotificationHelperAppPath,
  'Contents/MacOS/NotificationHelper',
);
const nexusCalendarHelperAppPath = path.join(nexusAppPath, 'Contents/Helpers/CalendarHelper.app');
const nexusCalendarHelperBinaryPath = path.join(
  nexusCalendarHelperAppPath,
  'Contents/MacOS/CalendarHelper',
);
const dockName = 'Nexus';
const bundleIdentifier = 'com.nexus.ide';

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

function buildCalendarHelper() {
  if (process.platform !== 'darwin' || !existsSync(calendarHelperSourcePath)) {
    return;
  }

  run('swiftc', [
    '-o',
    calendarHelperBinaryPath,
    calendarHelperSourcePath,
    '-framework',
    'EventKit',
    '-framework',
    'AppKit',
  ]);
}

function buildNotificationReader() {
  if (process.platform !== 'darwin' || !existsSync(notificationReaderSourcePath)) {
    return;
  }

  run('swiftc', ['-o', notificationReaderBinaryPath, notificationReaderSourcePath, '-l', 'sqlite3']);
  execFileSync('chmod', ['+x', notificationReaderBinaryPath]);

  run('mkdir', ['-p', path.dirname(notificationHelperBinaryPath)]);
  copyFileSync(notificationReaderBinaryPath, notificationHelperBinaryPath);
  execFileSync('chmod', ['+x', notificationHelperBinaryPath]);
  copyFileSync(
    notificationHelperInfoPlistPath,
    path.join(notificationHelperAppPath, 'Contents/Info.plist'),
  );

  try {
    execFileSync('codesign', ['--force', '-s', '-', notificationHelperAppPath]);
  } catch (error) {
    console.warn('[patch-electron-branding] NotificationHelper codesign skipped:', error.message);
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
    execFileSync('plutil', ['-replace', 'CFBundleIdentifier', '-string', bundleIdentifier, nexusInfoPlistPath]);
    execFileSync('plutil', [
      '-replace',
      'NSCalendarsUsageDescription',
      '-string',
      'O Nexus IDE exibe seus eventos do Calendário na barra lateral.',
      nexusInfoPlistPath,
    ]);
    execFileSync('plutil', [
      '-replace',
      'NSCalendarsFullAccessUsageDescription',
      '-string',
      'O Nexus IDE precisa ler seus eventos do Calendário para exibi-los na barra lateral.',
      nexusInfoPlistPath,
    ]);
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

  if (existsSync(calendarHelperBinaryPath) && existsSync(calendarHelperInfoPlistPath)) {
    run('mkdir', ['-p', path.dirname(nexusCalendarHelperBinaryPath)]);
    copyFileSync(calendarHelperBinaryPath, nexusCalendarHelperBinaryPath);
    execFileSync('chmod', ['+x', nexusCalendarHelperBinaryPath]);
    copyFileSync(
      calendarHelperInfoPlistPath,
      path.join(nexusCalendarHelperAppPath, 'Contents/Info.plist'),
    );
  }

  if (existsSync(notificationHelperAppPath)) {
    run('mkdir', ['-p', path.dirname(nexusNotificationHelperBinaryPath)]);
    run('cp', ['-R', notificationHelperAppPath, path.dirname(nexusNotificationHelperAppPath)]);
    execFileSync('chmod', ['+x', nexusNotificationHelperBinaryPath]);
  }

  try {
    execFileSync('codesign', ['--force', '--deep', '-s', '-', nexusAppPath]);
  } catch (error) {
    console.warn('[patch-electron-branding] codesign skipped:', error.message);
  }

  console.log(`[patch-electron-branding] Nexus.app ready as "${dockName}".`);
  return nexusBinaryPath;
}

generateMacAppIcons();
buildLiquidGlassIcon();
buildCalendarHelper();
buildNotificationReader();
patchNexusAppBundle();

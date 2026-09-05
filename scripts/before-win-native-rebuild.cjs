const { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const gypPath = path.join(rootDir, 'native/macos-calendar/binding.gyp');
const skippedPath = `${gypPath}.win-skip`;

function resolveWinArch(arch) {
  if (arch === 0 || arch === 'ia32') {
    return 'ia32';
  }

  if (arch === 3 || arch === 'arm64') {
    return 'arm64';
  }

  return 'x64';
}

function ensureWinRipgrep(arch) {
  const winArch = resolveWinArch(arch);
  const ripgrepPkg = require(path.join(rootDir, 'node_modules/@vscode/ripgrep/package.json'));
  const packageName = `@vscode/ripgrep-win32-${winArch}`;
  const destDir = path.join(rootDir, 'node_modules/@vscode', `ripgrep-win32-${winArch}`);
  const binaryPath = path.join(destDir, 'bin', 'rg.exe');

  if (existsSync(binaryPath)) {
    return;
  }

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'nexus-ripgrep-'));

  try {
    const pack = spawnSync(
      'npm',
      ['pack', `${packageName}@${ripgrepPkg.version}`, '--pack-destination', tmpDir],
      {
        cwd: rootDir,
        encoding: 'utf8',
      },
    );

    if (pack.status !== 0) {
      throw new Error(pack.stderr || pack.stdout || `npm pack failed for ${packageName}`);
    }

    const packedLines = pack.stdout.trim().split(/\r?\n/).filter(Boolean);
    const tarballName = packedLines[packedLines.length - 1];

    if (!tarballName) {
      throw new Error(`npm pack did not return a tarball for ${packageName}`);
    }

    mkdirSync(destDir, { recursive: true });

    const extract = spawnSync(
      'tar',
      ['-xzf', path.join(tmpDir, path.basename(tarballName)), '-C', destDir, '--strip-components', '1'],
      { encoding: 'utf8' },
    );

    if (extract.status !== 0 || !existsSync(binaryPath)) {
      throw new Error(extract.stderr || `Failed to extract ${packageName}`);
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

module.exports = async function beforeBuild(context) {
  const isWindows = context.platform.name === 'windows';

  if (isWindows) {
    ensureWinRipgrep(context.arch);

    if (existsSync(gypPath)) {
      renameSync(gypPath, skippedPath);
    }

    return;
  }

  if (existsSync(skippedPath)) {
    renameSync(skippedPath, gypPath);
  }
};

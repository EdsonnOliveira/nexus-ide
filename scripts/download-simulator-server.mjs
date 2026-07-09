import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SIMULATOR_SERVER_SHA = '10dae08e';
const rootDir = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const targetRoot = path.join(rootDir, 'resources/simulator-server/darwin');
const versionFile = path.join(rootDir, 'resources/simulator-server/version.txt');
const binaryPath = path.join(targetRoot, 'simulator-server');

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function download(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'nexus-ide-setup' },
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${url} (HTTP ${response.status})`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function extractTarGz(archivePath, destinationDir) {
  const result = spawnSync('tar', ['-xzf', archivePath, '-C', destinationDir], {
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`Failed to extract ${archivePath}`);
  }
}

async function main() {
  if (process.platform !== 'darwin') {
    return;
  }

  if (
    existsSync(versionFile) &&
    readFileSync(versionFile, 'utf8').trim() === SIMULATOR_SERVER_SHA &&
    existsSync(binaryPath)
  ) {
    chmodSync(binaryPath, 0o755);
    return;
  }

  const tag = `simulator-server-${SIMULATOR_SERVER_SHA}`;
  const baseUrl = `https://github.com/mobile-dev-inc/simulator-server-releases/releases/download/${tag}`;
  const assetName = `simulator-server-${SIMULATOR_SERVER_SHA}-darwin-universal.tar.gz`;

  const sumsText = (await download(`${baseUrl}/SHA256SUMS`)).toString('utf8');
  const expectedHash = sumsText
    .split('\n')
    .map((line) => line.trim().split(/\s+/, 2))
    .find((parts) => parts[1] === assetName)?.[0];

  if (!expectedHash) {
    throw new Error(`SHA256SUMS has no entry for ${assetName}`);
  }

  const archiveBytes = await download(`${baseUrl}/${assetName}`);
  const actualHash = sha256(archiveBytes);

  if (actualHash !== expectedHash) {
    throw new Error(`Checksum mismatch for ${assetName}`);
  }

  const tempDir = path.join(rootDir, 'resources/simulator-server/.tmp');
  const archivePath = path.join(tempDir, assetName);

  mkdirSync(tempDir, { recursive: true });
  writeFileSync(archivePath, archiveBytes);

  const extractDir = path.join(tempDir, 'extract');
  mkdirSync(extractDir, { recursive: true });
  extractTarGz(archivePath, extractDir);

  await rm(targetRoot, { recursive: true, force: true });
  mkdirSync(path.dirname(targetRoot), { recursive: true });

  const extractedEntries = spawnSync('ls', ['-1', extractDir], { encoding: 'utf8' });

  if (extractedEntries.status !== 0) {
    throw new Error('Failed to inspect extracted simulator-server archive');
  }

  const topLevel = extractedEntries.stdout.trim().split('\n').filter(Boolean);

  if (topLevel.length === 1) {
    spawnSync('mv', [path.join(extractDir, topLevel[0]), targetRoot], { stdio: 'inherit' });
  } else {
    spawnSync('mv', [extractDir, targetRoot], { stdio: 'inherit' });
  }

  chmodSync(binaryPath, 0o755);
  mkdirSync(path.dirname(versionFile), { recursive: true });
  writeFileSync(versionFile, `${SIMULATOR_SERVER_SHA}\n`);

  await rm(tempDir, { recursive: true, force: true });
}

main().catch((error) => {
  console.error('[simulator-server]', error instanceof Error ? error.message : error);
  process.exit(1);
});

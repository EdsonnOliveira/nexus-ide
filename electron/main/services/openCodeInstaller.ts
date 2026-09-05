import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { invalidateCliAgentCache, isCliAgentCommandInstalled } from './cliAgents';
import { buildCliPathEnv } from '../utils/cliPathEnv';

export interface CliSetupStatus {
  opencodeInstalled: boolean;
  pendingInstall: boolean;
  shouldOfferSetup: boolean;
}

export type CliSetupInstallResult =
  { ok: true; alreadyInstalled: boolean } | { ok: false; error: string };

interface CliSetupStoreFile {
  completed?: boolean;
}

const OPENCODE_CONFIG = {
  $schema: 'https://opencode.ai/config.json',
  model: 'opencode/big-pickle',
};

function getHomeMarkerDir(): string {
  return path.join(os.homedir(), '.nexus-ide');
}

function getPendingInstallPath(): string {
  return path.join(getHomeMarkerDir(), 'pending-opencode-install');
}

function getSkipSetupPath(): string {
  return path.join(getHomeMarkerDir(), 'skip-opencode-setup');
}

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'cli-setup.json');
}

function readStore(): CliSetupStoreFile {
  const filePath = getStorePath();

  if (!existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as CliSetupStoreFile;
  } catch {
    return {};
  }
}

function writeStore(store: CliSetupStoreFile): void {
  mkdirSync(path.dirname(getStorePath()), { recursive: true });
  writeFileSync(getStorePath(), `${JSON.stringify(store)}\n`);
}

function hasMarker(filePath: string): boolean {
  return existsSync(filePath);
}

function removeMarker(filePath: string): void {
  try {
    rmSync(filePath, { force: true });
  } catch {
    return;
  }
}

function getInstallDir(): string {
  return path.join(os.homedir(), '.opencode', 'bin');
}

function getBinaryName(): string {
  return process.platform === 'win32' ? 'opencode.exe' : 'opencode';
}

function getReleaseAssetName(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

  if (process.platform === 'win32') {
    return `opencode-windows-${arch}.zip`;
  }

  if (process.platform === 'darwin') {
    return `opencode-darwin-${arch}.zip`;
  }

  return `opencode-linux-${arch}.tar.gz`;
}

function findExtractedBinary(root: string): string | null {
  const names = new Set(
    process.platform === 'win32' ? ['opencode.exe', 'opencode.cmd', 'opencode'] : ['opencode'],
  );

  const entries = readdirSync(root, { withFileTypes: true, recursive: true });

  for (const entry of entries) {
    if (!entry.isFile() || !names.has(entry.name)) {
      continue;
    }

    const parent =
      'parentPath' in entry && typeof entry.parentPath === 'string' ? entry.parentPath : root;
    return path.join(parent, entry.name);
  }

  return null;
}

async function downloadArchive(url: string, dest: string): Promise<void> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Nexus-IDE' },
    redirect: 'follow',
    signal: AbortSignal.timeout(180_000),
  });

  if (!response.ok) {
    throw new Error(`Falha ao baixar OpenCode (HTTP ${response.status})`);
  }

  writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
}

function extractArchive(archivePath: string, dest: string): void {
  const result = spawnSync('tar', ['-xf', archivePath, '-C', dest], {
    encoding: 'utf8',
    timeout: 120_000,
  });

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(detail || 'Falha ao extrair o OpenCode');
  }
}

function installExtractedBinary(source: string): void {
  const installDir = getInstallDir();
  const target = path.join(installDir, getBinaryName());

  mkdirSync(installDir, { recursive: true });
  copyFileSync(source, target);

  if (process.platform !== 'win32') {
    chmodSync(target, 0o755);
  }
}

function ensureOpenCodeConfig(): void {
  const configDir = path.join(os.homedir(), '.config', 'opencode');
  const configPath = path.join(configDir, 'opencode.json');

  if (existsSync(configPath)) {
    return;
  }

  mkdirSync(configDir, { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(OPENCODE_CONFIG, null, 2)}\n`);
}

function runCommand(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, PATH: buildCliPathEnv(), HOME: os.homedir() },
    shell: process.platform === 'win32',
  });

  return result.status === 0;
}

function installViaOfficialScript(): boolean {
  if (process.platform === 'win32') {
    return false;
  }

  return runCommand('bash', ['-lc', 'curl -fsSL https://opencode.ai/install | bash']);
}

function installViaNpm(): boolean {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return runCommand(npmCommand, ['install', '-g', 'opencode-ai@latest']);
}

async function installFromGitHubRelease(): Promise<void> {
  const assetName = getReleaseAssetName();
  const url = `https://github.com/anomalyco/opencode/releases/latest/download/${assetName}`;
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'nexus-opencode-'));
  const archivePath = path.join(tempDir, assetName);
  const extractDir = path.join(tempDir, 'extract');

  try {
    mkdirSync(extractDir, { recursive: true });
    await downloadArchive(url, archivePath);
    extractArchive(archivePath, extractDir);

    const binaryPath = findExtractedBinary(extractDir);

    if (!binaryPath) {
      throw new Error('Binário do OpenCode não encontrado no pacote');
    }

    installExtractedBinary(binaryPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function isOpenCodeInstalled(): boolean {
  invalidateCliAgentCache();
  return isCliAgentCommandInstalled('opencode');
}

export function getCliSetupStatus(): CliSetupStatus {
  const pendingInstall = hasMarker(getPendingInstallPath());
  const skipped = hasMarker(getSkipSetupPath());
  const opencodeInstalled = isOpenCodeInstalled();
  const store = readStore();

  if (skipped && !pendingInstall) {
    if (!store.completed) {
      writeStore({ completed: true });
    }

    return {
      opencodeInstalled,
      pendingInstall: false,
      shouldOfferSetup: false,
    };
  }

  if (store.completed && !pendingInstall) {
    return {
      opencodeInstalled,
      pendingInstall: false,
      shouldOfferSetup: false,
    };
  }

  if (opencodeInstalled && !pendingInstall) {
    writeStore({ completed: true });
    return {
      opencodeInstalled: true,
      pendingInstall: false,
      shouldOfferSetup: false,
    };
  }

  return {
    opencodeInstalled,
    pendingInstall,
    shouldOfferSetup: true,
  };
}

export function dismissCliSetup(): void {
  writeStore({ completed: true });
  removeMarker(getPendingInstallPath());
  mkdirSync(getHomeMarkerDir(), { recursive: true });
  writeFileSync(getSkipSetupPath(), '1\n');
}

export async function installOpenCode(): Promise<CliSetupInstallResult> {
  if (isOpenCodeInstalled()) {
    ensureOpenCodeConfig();
    writeStore({ completed: true });
    removeMarker(getPendingInstallPath());
    return { ok: true, alreadyInstalled: true };
  }

  const errors: string[] = [];

  try {
    await installFromGitHubRelease();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));

    if (!installViaOfficialScript() && !installViaNpm()) {
      return {
        ok: false,
        error: errors[0] || 'Não foi possível baixar o OpenCode',
      };
    }
  }

  if (!isOpenCodeInstalled()) {
    return {
      ok: false,
      error: 'OpenCode foi baixado, mas o comando ainda não está no PATH',
    };
  }

  ensureOpenCodeConfig();
  writeStore({ completed: true });
  removeMarker(getPendingInstallPath());
  return { ok: true, alreadyInstalled: false };
}

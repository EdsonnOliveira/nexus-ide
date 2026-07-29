import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { buildCliPathEnv } from '../../utils/cliPathEnv';

const execFileAsync = promisify(execFile);

const CANDIDATE_BINARIES = [
  '/opt/homebrew/bin/whisper-cli',
  '/usr/local/bin/whisper-cli',
  '/opt/homebrew/bin/whisper',
  '/usr/local/bin/whisper',
  'whisper-cli',
  'whisper-cpp',
  'whisper',
];

const CANDIDATE_MODELS = [
  join(homedir(), 'Library/Application Support/nexus-ide/whisper/ggml-tiny.bin'),
  join(homedir(), 'Library/Application Support/nexus-ide/whisper/ggml-base.bin'),
  join(homedir(), '.cache/whisper/ggml-tiny.bin'),
  join(homedir(), '.cache/whisper/ggml-base.bin'),
  '/opt/homebrew/share/whisper-cpp/ggml-base.bin',
  '/usr/local/share/whisper-cpp/ggml-base.bin',
];

export interface WhisperResolveResult {
  binary: string | null;
  model: string | null;
  available: boolean;
  detail: string;
  engine: 'whisper' | 'none';
}

function whisperEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: buildCliPathEnv(process.env.PATH),
  };
}

async function resolveBinary(preferred?: string | null): Promise<string | null> {
  if (preferred?.trim() && existsSync(preferred.trim())) {
    return preferred.trim();
  }

  for (const candidate of CANDIDATE_BINARIES) {
    if (candidate.includes('/')) {
      if (existsSync(candidate)) {
        return candidate;
      }
      continue;
    }

    try {
      const { stdout } = await execFileAsync('/usr/bin/which', [candidate], {
        timeout: 2_000,
        env: whisperEnv(),
      });
      const resolved = stdout.trim().split('\n')[0]?.trim();
      if (resolved && existsSync(resolved)) {
        return resolved;
      }
    } catch {
    }
  }

  return null;
}

function resolveModel(preferred?: string | null): string | null {
  if (preferred?.trim() && existsSync(preferred.trim())) {
    return preferred.trim();
  }

  for (const candidate of CANDIDATE_MODELS) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function resolveWhisperTools(
  preferredBinary?: string | null,
  preferredModel?: string | null,
): Promise<WhisperResolveResult> {
  const binary = await resolveBinary(preferredBinary);
  const model = resolveModel(preferredModel);

  if (!binary) {
    return {
      binary: null,
      model,
      available: false,
      detail: 'Whisper não encontrado (instale: brew install whisper-cpp)',
      engine: 'none',
    };
  }

  const needsModel = /whisper-cli|whisper-cpp/i.test(binary);
  if (needsModel && !model) {
    return {
      binary,
      model: null,
      available: false,
      detail:
        'Modelo Whisper ausente. Salve ggml-tiny.bin em ~/Library/Application Support/nexus-ide/whisper/',
      engine: 'none',
    };
  }

  return {
    binary,
    model,
    available: true,
    detail: 'Whisper pronto',
    engine: 'whisper',
  };
}

function decodeBase64Audio(base64: string): Buffer {
  const cleaned = base64.replace(/^data:audio\/\w+;base64,/, '').trim();
  return Buffer.from(cleaned, 'base64');
}

async function transcribeWithWhisper(
  wavPath: string,
  binary: string,
  model: string | null,
  tempDir: string,
): Promise<string> {
  const outBase = join(tempDir, 'utterance');

  try {
    if (/whisper-cli|whisper-cpp/i.test(binary)) {
      if (!model) {
        throw new Error('Modelo Whisper ausente');
      }
      await execFileAsync(
        binary,
        ['-m', model, '-l', 'pt', '-f', wavPath, '-otxt', '-of', outBase, '-np'],
        { timeout: 120_000, maxBuffer: 1024 * 1024, env: whisperEnv() },
      );
      const txtPath = `${outBase}.txt`;
      if (!existsSync(txtPath)) {
        throw new Error('Whisper não gerou transcript');
      }
      return readFileSync(txtPath, 'utf8').trim();
    }

    await execFileAsync(
      binary,
      [
        wavPath,
        '--language',
        'pt',
        '--model',
        'base',
        '--output_format',
        'txt',
        '--output_dir',
        tempDir,
      ],
      { timeout: 180_000, maxBuffer: 1024 * 1024, env: whisperEnv() },
    );
    const txtPath = join(tempDir, 'utterance.txt');
    if (!existsSync(txtPath)) {
      throw new Error('Whisper não gerou transcript');
    }
    return readFileSync(txtPath, 'utf8').trim();
  } catch (error) {
    const err = error as { stderr?: Buffer | string; message?: string };
    const stderr = typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString('utf8');
    const detail = stderr?.trim().split('\n').pop() || err.message || 'Falha no Whisper';
    throw new Error(detail.slice(0, 180));
  }
}

const MAX_WAV_BYTES = 4 * 1024 * 1024;

export async function transcribeWavBase64(
  wavBase64: string,
  options?: { binary?: string | null; model?: string | null },
): Promise<string> {
  const tools = await resolveWhisperTools(options?.binary, options?.model);
  if (!tools.available || !tools.binary) {
    throw new Error(tools.detail);
  }

  if (wavBase64.length > 6_000_000) {
    throw new Error('Áudio muito grande');
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'nexus-jarvis-'));
  const wavPath = join(tempDir, 'utterance.wav');

  try {
    const audio = decodeBase64Audio(wavBase64);
    if (audio.byteLength < 1000) {
      return '';
    }
    if (audio.byteLength > MAX_WAV_BYTES) {
      throw new Error('Áudio muito grande');
    }
    writeFileSync(wavPath, audio);
    return await transcribeWithWhisper(wavPath, tools.binary, tools.model, tempDir);
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
    }
  }
}

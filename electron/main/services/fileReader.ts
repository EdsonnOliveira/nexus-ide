import { existsSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export type ReadTextFileResult =
  | {
      ok: true;
      content: string;
    }
  | {
      ok: false;
      error: string;
    };

export type WriteTextFileResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
    };

export function resolveFilePath(filePath: string): string {
  return path.resolve(filePath);
}

export async function readTextFile(filePath: string): Promise<ReadTextFileResult> {
  const resolvedPath = resolveFilePath(filePath);

  if (!resolvedPath || !existsSync(resolvedPath)) {
    return { ok: false, error: 'Arquivo não encontrado' };
  }

  const stats = statSync(resolvedPath);

  if (!stats.isFile()) {
    return { ok: false, error: 'Caminho inválido' };
  }

  if (stats.size > MAX_TEXT_BYTES) {
    return { ok: false, error: 'Arquivo muito grande para visualizar' };
  }

  const buffer = await readFile(resolvedPath);

  if (buffer.includes(0)) {
    return { ok: false, error: 'Arquivo binário não pode ser exibido como texto' };
  }

  return { ok: true, content: buffer.toString('utf8') };
}

export async function writeTextFile(filePath: string, content: string): Promise<WriteTextFileResult> {
  const resolvedPath = resolveFilePath(filePath);

  if (!resolvedPath || !existsSync(resolvedPath)) {
    return { ok: false, error: 'Arquivo não encontrado' };
  }

  const stats = statSync(resolvedPath);

  if (!stats.isFile()) {
    return { ok: false, error: 'Caminho inválido' };
  }

  const bytes = Buffer.byteLength(content, 'utf8');

  if (bytes > MAX_TEXT_BYTES) {
    return { ok: false, error: 'Arquivo muito grande para salvar' };
  }

  try {
    await writeFile(resolvedPath, content, 'utf8');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Não foi possível salvar o arquivo' };
  }
}

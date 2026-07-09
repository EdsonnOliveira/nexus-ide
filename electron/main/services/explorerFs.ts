import { cpSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type ExplorerFsResult =
  | {
      ok: true;
      path: string;
      entryType?: 'file' | 'directory';
    }
  | {
      ok: false;
      error: string;
    };

function sanitizeEntryName(name: string): string | null {
  const trimmed = name.trim();

  if (!trimmed || trimmed === '.' || trimmed === '..') {
    return null;
  }

  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return null;
  }

  return trimmed;
}

function resolveUniqueEntryPath(destinationDirPath: string, entryName: string): string {
  const initialPath = path.join(destinationDirPath, entryName);

  if (!existsSync(initialPath)) {
    return initialPath;
  }

  const extension = path.extname(entryName);
  const baseName = path.basename(entryName, extension);
  let counter = 1;

  while (true) {
    const candidateName = extension
      ? `${baseName} (${counter})${extension}`
      : `${baseName} (${counter})`;
    const candidatePath = path.join(destinationDirPath, candidateName);

    if (!existsSync(candidatePath)) {
      return candidatePath;
    }

    counter += 1;
  }
}

function isDescendantPath(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);

  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function createEmptyFile(dirPath: string, name: string): ExplorerFsResult {
  const safeName = sanitizeEntryName(name);

  if (!safeName) {
    return { ok: false, error: 'Nome inválido' };
  }

  const resolvedDir = path.resolve(dirPath);

  if (!existsSync(resolvedDir) || !statSync(resolvedDir).isDirectory()) {
    return { ok: false, error: 'Pasta não encontrada' };
  }

  const nextPath = path.join(resolvedDir, safeName);

  if (existsSync(nextPath)) {
    return { ok: false, error: 'Já existe um item com esse nome' };
  }

  try {
    writeFileSync(nextPath, '', 'utf8');
    return { ok: true, path: nextPath };
  } catch {
    return { ok: false, error: 'Não foi possível criar o arquivo' };
  }
}

export function createDirectory(dirPath: string, name: string): ExplorerFsResult {
  const safeName = sanitizeEntryName(name);

  if (!safeName) {
    return { ok: false, error: 'Nome inválido' };
  }

  const resolvedDir = path.resolve(dirPath);

  if (!existsSync(resolvedDir) || !statSync(resolvedDir).isDirectory()) {
    return { ok: false, error: 'Pasta não encontrada' };
  }

  const nextPath = path.join(resolvedDir, safeName);

  if (existsSync(nextPath)) {
    return { ok: false, error: 'Já existe um item com esse nome' };
  }

  try {
    mkdirSync(nextPath);
    return { ok: true, path: nextPath };
  } catch {
    return { ok: false, error: 'Não foi possível criar a pasta' };
  }
}

export function importEntry(destinationDirPath: string, sourcePath: string): ExplorerFsResult {
  const resolvedSource = path.resolve(sourcePath);
  const resolvedDestinationDir = path.resolve(destinationDirPath);

  if (!existsSync(resolvedSource)) {
    return { ok: false, error: 'Item não encontrado' };
  }

  if (!existsSync(resolvedDestinationDir) || !statSync(resolvedDestinationDir).isDirectory()) {
    return { ok: false, error: 'Pasta de destino inválida' };
  }

  const nextPath = resolveUniqueEntryPath(
    resolvedDestinationDir,
    path.basename(resolvedSource),
  );

  try {
    cpSync(resolvedSource, nextPath, { recursive: true });
    const entryType = statSync(nextPath).isDirectory() ? 'directory' : 'file';
    return { ok: true, path: nextPath, entryType };
  } catch {
    return { ok: false, error: 'Não foi possível importar o item' };
  }
}

export function importEntries(
  destinationDirPath: string,
  sourcePaths: string[],
): ExplorerFsResult[] {
  return sourcePaths.map((sourcePath) => importEntry(destinationDirPath, sourcePath));
}

export function moveEntry(sourcePath: string, destinationDirPath: string): ExplorerFsResult {
  const resolvedSource = path.resolve(sourcePath);
  const resolvedDestinationDir = path.resolve(destinationDirPath);

  if (!existsSync(resolvedSource)) {
    return { ok: false, error: 'Item não encontrado' };
  }

  if (!existsSync(resolvedDestinationDir) || !statSync(resolvedDestinationDir).isDirectory()) {
    return { ok: false, error: 'Pasta de destino inválida' };
  }

  if (resolvedSource === resolvedDestinationDir) {
    return { ok: false, error: 'Não é possível mover para o mesmo local' };
  }

  const sourceStats = statSync(resolvedSource);

  if (sourceStats.isDirectory() && isDescendantPath(resolvedSource, resolvedDestinationDir)) {
    return { ok: false, error: 'Não é possível mover a pasta para dentro dela mesma' };
  }

  const nextPath = path.join(resolvedDestinationDir, path.basename(resolvedSource));

  if (resolvedSource === nextPath) {
    return { ok: true, path: nextPath };
  }

  if (existsSync(nextPath)) {
    return { ok: false, error: 'Já existe um item com esse nome no destino' };
  }

  try {
    renameSync(resolvedSource, nextPath);
    return { ok: true, path: nextPath };
  } catch {
    return { ok: false, error: 'Não foi possível mover o item' };
  }
}

export function renameEntry(entryPath: string, nextName: string): ExplorerFsResult {
  const safeName = sanitizeEntryName(nextName);

  if (!safeName) {
    return { ok: false, error: 'Nome inválido' };
  }

  const resolved = path.resolve(entryPath);

  if (!existsSync(resolved)) {
    return { ok: false, error: 'Item não encontrado' };
  }

  const parentDir = path.dirname(resolved);
  const nextPath = path.join(parentDir, safeName);

  if (resolved === nextPath) {
    return { ok: true, path: nextPath };
  }

  if (existsSync(nextPath)) {
    return { ok: false, error: 'Já existe um item com esse nome' };
  }

  try {
    renameSync(resolved, nextPath);
    return { ok: true, path: nextPath };
  } catch {
    return { ok: false, error: 'Não foi possível renomear o item' };
  }
}

export function deleteEntry(entryPath: string): ExplorerFsResult {
  const resolved = path.resolve(entryPath);

  if (!existsSync(resolved)) {
    return { ok: false, error: 'Item não encontrado' };
  }

  try {
    rmSync(resolved, { recursive: true, force: true });
    return { ok: true, path: resolved };
  } catch {
    return { ok: false, error: 'Não foi possível deletar o item' };
  }
}

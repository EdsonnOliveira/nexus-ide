import { access, appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const NEXUS_GITIGNORE_ENTRY = '.nexus/';
const NEXUS_GITIGNORE_MARKER = '# Nexus IDE local storage';

function gitignoreAlreadyContainsNexus(content: string): boolean {
  return content.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      return false;
    }

    const normalized = trimmed.replace(/\/$/, '');

    return (
      normalized === '.nexus' ||
      normalized === '**/.nexus' ||
      normalized.endsWith('/.nexus')
    );
  });
}

export async function ensureNexusGitignore(projectPath: string): Promise<void> {
  const gitignorePath = path.join(projectPath, '.gitignore');

  try {
    const content = await readFile(gitignorePath, 'utf8');

    if (gitignoreAlreadyContainsNexus(content)) {
      return;
    }

    const prefix = content.endsWith('\n') || content.length === 0 ? '' : '\n';
    const block = `${prefix}\n${NEXUS_GITIGNORE_MARKER}\n${NEXUS_GITIGNORE_ENTRY}`;

    await appendFile(gitignorePath, block, 'utf8');
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  await writeFile(
    gitignorePath,
    `${NEXUS_GITIGNORE_MARKER}\n${NEXUS_GITIGNORE_ENTRY}\n`,
    'utf8',
  );
}

export async function ensureNexusProjectDir(
  projectPath: string,
  ...segments: string[]
): Promise<string> {
  await ensureNexusGitignore(projectPath);

  const targetDir = path.join(projectPath, '.nexus', ...segments);
  const { mkdir } = await import('node:fs/promises');

  await mkdir(targetDir, { recursive: true });
  return targetDir;
}

export async function hasNexusProjectDir(projectPath: string): Promise<boolean> {
  try {
    await access(path.join(projectPath, '.nexus'));
    return true;
  } catch {
    return false;
  }
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PREFERRED_VOICES = ['Luciana', 'Fernanda', 'Joana'];

let cachedVoice: string | null = null;

async function resolvePortugueseVoice(): Promise<string> {
  if (cachedVoice) {
    return cachedVoice;
  }

  try {
    const { stdout } = await execFileAsync('/usr/bin/say', ['-v', '?'], {
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });
    const lines = stdout.split('\n');
    for (const preferred of PREFERRED_VOICES) {
      const match = lines.find((line) => line.startsWith(`${preferred} `));
      if (match) {
        cachedVoice = preferred;
        return preferred;
      }
    }
    const ptVoice = lines.find((line) => /\bpt[_-]BR\b/i.test(line) || /\bpt_BR\b/i.test(line));
    if (ptVoice) {
      const name = ptVoice.split(/\s+/)[0]?.trim();
      if (name) {
        cachedVoice = name;
        return name;
      }
    }
  } catch {
  }

  cachedVoice = 'Luciana';
  return cachedVoice;
}

export async function speakText(text: string): Promise<void> {
  const trimmed = text.trim().slice(0, 2_000);
  if (!trimmed) {
    return;
  }

  const voice = await resolvePortugueseVoice();
  await execFileAsync('/usr/bin/say', ['-v', voice, trimmed], {
    timeout: 120_000,
    maxBuffer: 1024 * 256,
  });
}

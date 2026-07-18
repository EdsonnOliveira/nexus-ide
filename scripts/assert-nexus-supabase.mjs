import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED = 'ktmngnpwmgvciutrgqbq';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env.local');

if (!existsSync(envPath)) {
  console.error('[nexus-cloud] missing .env.local');
  process.exit(1);
}

const env = readFileSync(envPath, 'utf8');
const urlMatch = env.match(/^VITE_SUPABASE_URL=(.+)$/m);
const refMatch = env.match(/^NEXUS_SUPABASE_PROJECT_REF=(.+)$/m);
const url = urlMatch?.[1]?.trim() ?? '';
const ref = refMatch?.[1]?.trim() ?? '';

if (!url.includes(EXPECTED) || (ref && ref !== EXPECTED)) {
  console.error(
    `[nexus-cloud] refusing wrong Supabase project. expected ${EXPECTED}, got url=${url} ref=${ref}`,
  );
  process.exit(1);
}

console.log(`[nexus-cloud] ok — project ${EXPECTED}`);

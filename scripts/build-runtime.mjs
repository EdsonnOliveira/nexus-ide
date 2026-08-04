import { build } from 'esbuild';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist-runtime');
const entry = path.join(root, 'apps/runtime/src/index.ts');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: [entry],
  outfile: path.join(outDir, 'index.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node22'],
  sourcemap: false,
  legalComments: 'none',
  external: ['node-pty'],
  logLevel: 'info',
  banner: {
    js: "var __nexus_import_meta_url = require('node:url').pathToFileURL(__filename).href;",
  },
  define: {
    'import.meta.url': '__nexus_import_meta_url',
  },
});

console.log(`[build-runtime] wrote ${path.join(outDir, 'index.cjs')}`);

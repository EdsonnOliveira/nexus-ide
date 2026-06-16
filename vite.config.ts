import { rmSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { electronSimple } from 'vite-plugin-electron/multi-env';
import { notBundle } from 'vite-plugin-electron/plugin';
import pkg from './package.json';

const external = Object.keys(
  'dependencies' in pkg ? (pkg.dependencies as Record<string, string>) : {},
);

export default defineConfig(({ command }) => {
  const isBuild = command === 'build';

  if (isBuild) {
    rmSync('dist-electron', { recursive: true, force: true });
  }

  const isServe = command === 'serve';
  const sourcemap = isServe || !!process.env.VSCODE_DEBUG;

  return {
    resolve: {
      alias: {
        '@': path.join(__dirname, 'src'),
      },
    },
    plugins: [
      react(),
      electronSimple({
        main: {
          input: 'electron/main/index.ts',
          plugins: [notBundle()],
          options: {
            build: {
              sourcemap,
              minify: isBuild,
              outDir: 'dist-electron/main',
              rolldownOptions: {
                external,
              },
            },
          },
        },
        preload: {
          input: 'electron/preload/index.ts',
          plugins: [notBundle()],
          options: {
            build: {
              sourcemap: sourcemap ? 'inline' : undefined,
              minify: isBuild,
              outDir: 'dist-electron/preload',
              rolldownOptions: {
                external,
                output: {
                  format: 'cjs',
                  entryFileNames: '[name].cjs',
                  chunkFileNames: '[name].cjs',
                },
              },
            },
          },
        },
      }),
    ],
    clearScreen: false,
    optimizeDeps: {
      include: ['react', 'react-dom', 'zustand', 'lucide-react'],
    },
  };
});

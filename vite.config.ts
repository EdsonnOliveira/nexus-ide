import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { electronSimple } from 'vite-plugin-electron/multi-env';
import { notBundle } from 'vite-plugin-electron/plugin';
import pkg from './package.json';

const external = Object.keys(
  'dependencies' in pkg ? (pkg.dependencies as Record<string, string>) : {},
);

const nexusElectronBinary = path.join(__dirname, 'build/Nexus.app/Contents/MacOS/Electron');

function stopBundledElectronApp(): void {
  const running = (process as NodeJS.Process & { electronApp?: ChildProcess | null }).electronApp;

  if (!running || running.killed) {
    return;
  }

  running.removeAllListeners('exit');
  running.kill();
  (process as NodeJS.Process & { electronApp?: ChildProcess | null }).electronApp = null;
}

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
    css: {
      transformer: 'postcss',
    },
    build: {
      cssMinify: 'esbuild',
    },
    plugins: [
      react(),
      electronSimple({
        main: {
          input: 'electron/main/index.ts',
          plugins: [notBundle()],
          onstart({ startup }) {
            if (process.platform === 'darwin' && existsSync(nexusElectronBinary)) {
              stopBundledElectronApp();

              const child = spawn(nexusElectronBinary, ['.', '--no-sandbox'], {
                cwd: process.cwd(),
                stdio: 'inherit',
                env: { ...process.env, NODE_OPTIONS: undefined },
              });

              child.on('exit', () => {
                process.electronApp = null;
              });

              process.electronApp = child;
              return;
            }

            void startup();
          },
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
          input: {
            index: 'electron/preload/index.ts',
            'browser-guest': 'electron/preload/browser-guest.ts',
          },
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
                  codeSplitting: true,
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
      include: [
        'react',
        'react-dom',
        'zustand',
        'lucide-react',
        '@xterm/xterm',
        '@xterm/addon-fit',
        '@uiw/react-codemirror',
      ],
    },
  };
});

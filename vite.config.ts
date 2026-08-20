import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { electronSimple } from 'vite-plugin-electron/multi-env';
import { notBundle } from 'vite-plugin-electron/plugin';
import pkg from './package.json';

const external = Object.keys(
  'dependencies' in pkg ? (pkg.dependencies as Record<string, string>) : {},
);

const nexusElectronBinary = path.join(__dirname, 'build/Nexus.app/Contents/MacOS/Electron');
const ELECTRON_RESTART_DEBOUNCE_MS = 400;
const ELECTRON_EXIT_TIMEOUT_MS = 1500;

type ViteElectronProcess = NodeJS.Process & { electronApp?: ChildProcess | null };

function getViteProcess(): ViteElectronProcess {
  return process as ViteElectronProcess;
}

function isNexusElectronRunning(): boolean {
  try {
    const result = spawnSync('pgrep', ['-f', 'nexus-ide/build/Nexus.app/Contents/MacOS/Electron'], {
      encoding: 'utf8',
    });
    return result.status === 0 && Boolean(result.stdout?.trim());
  } catch {
    return false;
  }
}

function isChildAlive(child: ChildProcess | null | undefined): boolean {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (!isChildAlive(child)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(killTimer);
      clearTimeout(hardTimer);
      child.removeListener('exit', finish);
      resolve();
    };

    const killTimer = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeoutMs);

    const hardTimer = setTimeout(finish, timeoutMs + 500);

    child.once('exit', finish);
  });
}

async function stopBundledElectronApp(): Promise<void> {
  const viteProcess = getViteProcess();
  const running = viteProcess.electronApp;

  if (!running) {
    return;
  }

  running.removeAllListeners('exit');
  const exited = waitForChildExit(running, ELECTRON_EXIT_TIMEOUT_MS);

  if (isChildAlive(running)) {
    running.kill('SIGTERM');
  }

  await exited;
  viteProcess.electronApp = null;
}

let electronRestartTimer: ReturnType<typeof setTimeout> | null = null;
let electronRestarting = false;
let electronRestartQueued = false;
let unexpectedExitCount = 0;
let lastElectronSpawnAt = 0;

let electronWatchdogTimer: ReturnType<typeof setInterval> | null = null;
let lastBundledStartup: (() => void) | null = null;

function startElectronWatchdog(startup: () => void): void {
  lastBundledStartup = startup;

  if (electronWatchdogTimer) {
    return;
  }

  electronWatchdogTimer = setInterval(() => {
    if (electronRestarting || !lastBundledStartup) {
      return;
    }

    if (isChildAlive(getViteProcess().electronApp) || isNexusElectronRunning()) {
      return;
    }

    console.warn('[vite] Electron missing — watchdog respawn');
    scheduleBundledElectronRestart(lastBundledStartup, { force: true });
  }, 5000);
}

async function restartBundledElectron(
  startup: () => void,
  options: { force?: boolean } = {},
): Promise<void> {
  if (electronRestarting) {
    electronRestartQueued = true;
    return;
  }

  electronRestarting = true;

  try {
    do {
      electronRestartQueued = false;

      if (process.platform === 'darwin' && existsSync(nexusElectronBinary)) {
        const running = getViteProcess().electronApp;
        const force = Boolean(options.force);

        if (!force && (isChildAlive(running) || isNexusElectronRunning())) {
          console.warn('[vite] Electron already running — not restarting');
          return;
        }

        await stopBundledElectronApp();

        if (force && isNexusElectronRunning()) {
          spawnSync('pkill', ['-f', 'nexus-ide/build/Nexus.app/Contents/MacOS/Electron'], {
            encoding: 'utf8',
          });
          await new Promise((resolve) => setTimeout(resolve, 300));
        }

        lastElectronSpawnAt = Date.now();

        const child = spawn(
          nexusElectronBinary,
          ['.', '--no-sandbox', '--remote-debugging-port=9222'],
          {
            cwd: process.cwd(),
            detached: true,
            stdio: 'ignore',
            env: { ...process.env, NODE_OPTIONS: undefined },
          },
        );

        child.unref();

        child.on('exit', (code, signal) => {
          getViteProcess().electronApp = null;
          console.warn(`[vite] Electron exited code=${code} signal=${signal ?? 'none'}`);

          if (electronRestarting) {
            return;
          }

          const now = Date.now();

          if (now - lastElectronSpawnAt > 15_000) {
            unexpectedExitCount = 0;
          }

          unexpectedExitCount += 1;

          if (unexpectedExitCount > 5) {
            console.error('[vite] Electron exited repeatedly — not respawning');
            return;
          }

          console.warn('[vite] respawning Electron after unexpected exit');
          scheduleBundledElectronRestart(startup, { force: true });
        });

        getViteProcess().electronApp = child;
        startElectronWatchdog(startup);
        continue;
      }

      void startup();
      startElectronWatchdog(startup);
      return;
    } while (electronRestartQueued);
  } finally {
    electronRestarting = false;
  }
}

function scheduleBundledElectronRestart(
  startup: () => void,
  options: { force?: boolean } = {},
): void {
  if (electronRestartTimer) {
    clearTimeout(electronRestartTimer);
  }

  electronRestartTimer = setTimeout(() => {
    electronRestartTimer = null;
    void restartBundledElectron(startup, options);
  }, ELECTRON_RESTART_DEBOUNCE_MS);
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
        '@nexus/protocol': path.join(__dirname, 'packages/protocol/src/index.ts'),
        '@nexus/supabase': path.join(__dirname, 'packages/supabase/src/index.ts'),
        '@nexus/bridge': path.join(__dirname, 'packages/bridge/src/index.ts'),
      },
    },
    envDir: __dirname,
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
            scheduleBundledElectronRestart(startup);
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
    server: {
      port: 5260,
      strictPort: true,
    },
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

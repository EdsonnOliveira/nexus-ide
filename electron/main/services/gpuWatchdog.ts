import { app, type BrowserWindow } from 'electron';

const SAMPLE_MS = 2000;
const SPIKE_SAMPLES = 1;
const RECOVER_SAMPLES = 5;
const GPU_SPIKE_PERCENT = 35;
const RENDERER_SPIKE_PERCENT = 45;
const PEAK_SPIKE_PERCENT = 70;
const RECOVER_PERCENT = 20;

let timer: ReturnType<typeof setInterval> | null = null;
let getWindow: () => BrowserWindow | null = () => null;
let spikeCount = 0;
let recoverCount = 0;
let powerSave = false;

function readHotCpu(): { gpu: number; renderer: number; peak: number } {
  const win = getWindow();
  const rendererPid = win && !win.isDestroyed() ? win.webContents.getOSProcessId() : 0;
  let gpu = 0;
  let renderer = 0;
  let peak = 0;

  for (const metric of app.getAppMetrics()) {
    const cpu = metric.cpu?.percentCPUUsage ?? 0;
    const type = String(metric.type ?? '').toLowerCase();
    peak = Math.max(peak, cpu);

    if (type === 'gpu' || type.includes('gpu')) {
      gpu = Math.max(gpu, cpu);
    }

    if (metric.pid === rendererPid || type === 'tab') {
      renderer = Math.max(renderer, cpu);
    }
  }

  return { gpu, renderer, peak };
}

function publish(enabled: boolean): void {
  const win = getWindow();

  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return;
  }

  win.webContents.send('app:power-save', enabled);
  void win.webContents
    .executeJavaScript(
      `document.documentElement.classList.toggle('nexus-power-save', ${enabled ? 'true' : 'false'})`,
    )
    .catch(() => undefined);
}

function tick(): void {
  const { gpu, renderer, peak } = readHotCpu();
  const hot =
    gpu >= GPU_SPIKE_PERCENT || renderer >= RENDERER_SPIKE_PERCENT || peak >= PEAK_SPIKE_PERCENT;

  if (hot) {
    spikeCount += 1;
    recoverCount = 0;

    if (!powerSave && spikeCount >= SPIKE_SAMPLES) {
      powerSave = true;
      publish(true);
    }

    return;
  }

  recoverCount += 1;
  spikeCount = 0;

  if (
    powerSave &&
    gpu < RECOVER_PERCENT &&
    renderer < RECOVER_PERCENT &&
    peak < RECOVER_PERCENT &&
    recoverCount >= RECOVER_SAMPLES
  ) {
    powerSave = false;
    publish(false);
  }
}

export function startGpuWatchdog(getter: () => BrowserWindow | null): void {
  getWindow = getter;

  if (timer) {
    return;
  }

  timer = setInterval(tick, SAMPLE_MS);
  tick();
}

export function stopGpuWatchdog(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  spikeCount = 0;
  recoverCount = 0;

  if (powerSave) {
    powerSave = false;
    publish(false);
  }
}

const LIGHT_VIBRATE_MS = 10;
const HAPTIC_SWITCH_ID = 'nexus-web-haptic-switch';

let installed = false;
let labelEl: HTMLLabelElement | null = null;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
    return true;
  }
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

function ensureIosHapticSwitch(): HTMLLabelElement | null {
  if (typeof document === 'undefined') {
    return null;
  }

  if (labelEl?.isConnected) {
    return labelEl;
  }

  let input = document.getElementById(HAPTIC_SWITCH_ID) as HTMLInputElement | null;
  if (!input) {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.id = HAPTIC_SWITCH_ID;
    input.setAttribute('switch', '');
    input.setAttribute('aria-hidden', 'true');
    input.tabIndex = -1;
    input.style.cssText =
      'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;margin:0;';
    document.body.appendChild(input);
  }

  labelEl = document.createElement('label');
  labelEl.htmlFor = HAPTIC_SWITCH_ID;
  labelEl.setAttribute('aria-hidden', 'true');
  labelEl.style.cssText =
    'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;margin:0;';
  document.body.appendChild(labelEl);
  return labelEl;
}

export function triggerWebHaptic(): void {
  if (typeof window === 'undefined' || prefersReducedMotion()) {
    return;
  }

  if (isIosDevice()) {
    ensureIosHapticSwitch()?.click();
    return;
  }

  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(LIGHT_VIBRATE_MS);
  }
}

function onTrustedClick(event: MouseEvent): void {
  if (!event.isTrusted) {
    return;
  }
  triggerWebHaptic();
}

export function installWebHaptics(): void {
  if (typeof window === 'undefined' || installed) {
    return;
  }
  installed = true;
  if (isIosDevice()) {
    ensureIosHapticSwitch();
  }
  document.addEventListener('click', onTrustedClick, true);
}

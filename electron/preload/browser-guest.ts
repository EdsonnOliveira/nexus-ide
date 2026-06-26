import { ipcRenderer } from 'electron';

const PASSWORD_FOCUS_CONSOLE_PREFIX = '__NEXUS_PW_FOCUS__';

interface GuestInputRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PasswordFocusPayload {
  type: string;
  name: string;
  id: string;
  autocomplete: string;
  rect: GuestInputRect;
}

function isFillableElement(
  target: EventTarget | null,
): target is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function buildPayload(
  target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): PasswordFocusPayload {
  const rect = target.getBoundingClientRect();

  return {
    type: target instanceof HTMLSelectElement ? 'select' : target.type,
    name: target.name,
    id: target.id,
    autocomplete: target instanceof HTMLSelectElement ? '' : target.autocomplete,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
  };
}

function notifyInputFocus(target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void {
  const payload = buildPayload(target);

  ipcRenderer.sendToHost('password-input-focus', payload);
  console.log(`${PASSWORD_FOCUS_CONSOLE_PREFIX}${JSON.stringify(payload)}`);
}

function handlePointerTarget(target: EventTarget | null): void {
  if (!isFillableElement(target)) {
    return;
  }

  notifyInputFocus(target);
}

function installInputFocusListener(): void {
  document.addEventListener(
    'focusin',
    (event) => {
      handlePointerTarget(event.target);
    },
    true,
  );

  document.addEventListener(
    'click',
    (event) => {
      handlePointerTarget(event.target);
    },
    true,
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installInputFocusListener, { once: true });
} else {
  installInputFocusListener();
}

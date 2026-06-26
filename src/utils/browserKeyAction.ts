import type { WebviewTag } from 'electron';
import type { PasswordFieldAction } from '@/types/password';

export const BROWSER_FIELD_ACTION_DELAY_MS = 40;

export function waitForBrowserFieldAction(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, BROWSER_FIELD_ACTION_DELAY_MS);
  });
}

export function dispatchBrowserFieldAction(
  webview: WebviewTag,
  action: PasswordFieldAction,
): void {
  if (action === 'none') {
    return;
  }

  webview.focus();

  if (action === 'tab') {
    webview.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    webview.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    return;
  }

  webview.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  webview.sendInputEvent({ type: 'char', keyCode: 'Return' });
  webview.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
}

export async function fillBrowserFieldWithAction(
  webview: WebviewTag,
  fillScript: string,
  action: PasswordFieldAction,
): Promise<boolean> {
  let filled = false;

  try {
    filled = Boolean(await webview.executeJavaScript(fillScript));
  } catch {
    return false;
  }

  if (!filled) {
    return false;
  }

  if (action === 'none') {
    return true;
  }

  await waitForBrowserFieldAction();
  dispatchBrowserFieldAction(webview, action);

  return true;
}

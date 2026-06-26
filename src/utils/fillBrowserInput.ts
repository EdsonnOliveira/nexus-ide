import type { PasswordFieldAction } from '@/types/password';

const FIELD_MATCHING_HELPERS = `
  function normalize(value) {
    return String(value || '').trim().toLowerCase();
  }

  function setElementValue(el, value) {
    el.focus();

    if (el instanceof HTMLSelectElement) {
      el.value = value;
    } else {
      const proto =
        el instanceof HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

      if (nativeSetter) {
        nativeSetter.call(el, value);
      } else {
        el.value = value;
      }
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function matchesField(input, labelNorm) {
    const type = input.type || '';

    if (
      type === 'hidden' ||
      type === 'submit' ||
      type === 'button' ||
      type === 'checkbox' ||
      type === 'radio' ||
      type === 'file'
    ) {
      return false;
    }

    const name = normalize(input.name);
    const id = normalize(input.id);
    const placeholder = normalize(input.placeholder);
    const autocomplete = normalize(input.autocomplete);

    if (labelNorm.includes('senha') || labelNorm.includes('password')) {
      return type === 'password';
    }

    if (
      labelNorm.includes('email') ||
      labelNorm.includes('e-mail') ||
      labelNorm.includes('usuario') ||
      labelNorm.includes('usuário') ||
      labelNorm.includes('user')
    ) {
      return (
        type === 'email' ||
        autocomplete.includes('email') ||
        autocomplete.includes('username') ||
        (type === 'text' && !name.includes('password') && !id.includes('password'))
      );
    }

    if (!name && !id && !placeholder) {
      return false;
    }

    return (
      (name && (name.includes(labelNorm) || labelNorm.includes(name))) ||
      (id && (id.includes(labelNorm) || labelNorm.includes(id))) ||
      (placeholder && (placeholder.includes(labelNorm) || labelNorm.includes(placeholder)))
    );
  }
`;

export function buildResetBrowserFormFillStateScript(): string {
  return 'window.__nexusPasswordFillUsed = new Set(); true;';
}

export function buildFillBrowserInputScript(value: string): string {
  const serialized = JSON.stringify(value);

  return `(function () {
    const el = document.activeElement;

    if (!el || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
      return false;
    }

    const nextValue = ${serialized};
    el.focus();

    if (el instanceof HTMLSelectElement) {
      el.value = nextValue;
    } else {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
        'value',
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(el, nextValue);
      } else {
        el.value = nextValue;
      }
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;
}

export function buildFillBrowserFieldByLabelScript(label: string, value: string): string {
  const serializedLabel = JSON.stringify(label);
  const serializedValue = JSON.stringify(value);

  return `(function () {
    ${FIELD_MATCHING_HELPERS}

    const labelNorm = normalize(${serializedLabel});
    const nextValue = ${serializedValue};

    if (!labelNorm || !nextValue) {
      return false;
    }

    const used = window.__nexusPasswordFillUsed = window.__nexusPasswordFillUsed || new Set();
    const inputs = Array.from(document.querySelectorAll('input, textarea, select'));

    for (const input of inputs) {
      if (used.has(input) || !matchesField(input, labelNorm)) {
        continue;
      }

      setElementValue(input, nextValue);
      used.add(input);
      return true;
    }

    return false;
  })()`;
}

export interface BrowserFormFillEntry {
  label: string;
  value: string;
  action: PasswordFieldAction;
}

export function buildFillBrowserFormScript(entries: BrowserFormFillEntry[]): string {
  const serialized = JSON.stringify(entries);

  return `(function () {
    ${FIELD_MATCHING_HELPERS}

    const entries = ${serialized};
    const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
    const used = new Set();
    let filled = 0;

    for (const entry of entries) {
      const labelNorm = normalize(entry.label);

      if (!labelNorm || !entry.value) {
        continue;
      }

      for (const input of inputs) {
        if (used.has(input) || !matchesField(input, labelNorm)) {
          continue;
        }

        setElementValue(input, entry.value);
        used.add(input);
        filled += 1;
        break;
      }
    }

    return filled;
  })()`;
}

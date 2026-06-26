import type { PasswordCollection, PasswordFieldAction } from '@/types/password';

export function createDefaultPasswordCollection(): PasswordCollection {
  return {
    id: crypto.randomUUID(),
    name: '',
    fields: [
      { id: crypto.randomUUID(), label: 'E-mail', action: 'tab' },
      { id: crypto.randomUUID(), label: 'Senha', action: 'enter' },
    ],
  };
}

export const PASSWORD_FIELD_ACTION_OPTIONS: Array<{ value: PasswordFieldAction; label: string }> = [
  { value: 'none', label: 'Somente preencher' },
  { value: 'tab', label: 'Preencher + Tab' },
  { value: 'enter', label: 'Preencher + Enter' },
];

export function normalizePasswordFieldAction(action: PasswordFieldAction | undefined): PasswordFieldAction {
  if (action === 'tab' || action === 'enter') {
    return action;
  }

  return 'none';
}

export function getPasswordFieldActionLabel(action: PasswordFieldAction | undefined): string {
  return (
    PASSWORD_FIELD_ACTION_OPTIONS.find(
      (option) => option.value === normalizePasswordFieldAction(action),
    )?.label ?? 'Somente preencher'
  );
}

import { memo } from 'react';
import type { PasswordFieldAction } from '@/types/password';
import { normalizePasswordFieldAction } from '@/utils/createDefaultPasswordCollection';

interface PasswordFieldActionLabelProps {
  action: PasswordFieldAction | undefined;
}

function PasswordFieldActionLabelComponent({ action }: PasswordFieldActionLabelProps) {
  const normalized = normalizePasswordFieldAction(action);

  if (normalized === 'none') {
    return <span className='password-field-action-label'>Somente preencher</span>;
  }

  const keyLabel = normalized === 'tab' ? 'Tab' : 'Enter';

  return (
    <span className='password-field-action-label'>
      <span className='password-field-action-label__text'>Preencher +</span>
      <kbd className='global-search__key-badge'>{keyLabel}</kbd>
    </span>
  );
}

export const PasswordFieldActionLabel = memo(PasswordFieldActionLabelComponent);

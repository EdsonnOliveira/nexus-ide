import { X } from 'lucide-react';
import { memo, useCallback } from 'react';
import { PasswordFieldActionLabel } from '@/components/passwords/PasswordFieldActionLabel';
import type { PasswordField, PasswordFieldAction } from '@/types/password';
import { isSensitivePasswordFieldLabel } from '@/utils/passwordLabels';

interface BrowserCredentialBarProps {
  collectionName: string;
  fields: PasswordField[];
  values: Record<string, string>;
  onClose: () => void;
  onSelectField: (fieldId: string, value: string, action: PasswordFieldAction) => void;
}

function BrowserCredentialBarComponent({
  collectionName,
  fields,
  values,
  onClose,
  onSelectField,
}: BrowserCredentialBarProps) {
  const handleSelect = useCallback(
    (field: PasswordField, value: string) => () => {
      if (!value) {
        return;
      }

      onSelectField(field.id, value, field.action ?? 'none');
    },
    [onSelectField],
  );

  return (
    <div className='browser-panel__credential-bar app-button--enter'>
      <div className='browser-panel__credential-bar-head'>
        <span className='browser-panel__credential-bar-title'>{collectionName}</span>
        <span className='browser-panel__credential-bar-hint'>Escolha um campo para preencher</span>
        <button
          type='button'
          className='browser-panel__credential-bar-close app-button app-button--enter'
          aria-label='Fechar campos da coleção'
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>
      <div className='browser-panel__credential-bar-fields'>
        {fields.map((field) => {
          const value = values[field.id] ?? '';
          const sensitive = isSensitivePasswordFieldLabel(field.label);
          const displayValue = sensitive && value ? '••••••••' : value || '—';

          return (
            <button
              key={field.id}
              type='button'
              className='browser-panel__credential-bar-field app-button app-button--enter'
              disabled={!value}
              onClick={handleSelect(field, value)}
            >
              <span className='browser-panel__credential-bar-field-label'>{field.label}</span>
              <span className='browser-panel__credential-bar-field-value'>{displayValue}</span>
              {field.action && field.action !== 'none' ? (
                <span className='browser-panel__credential-bar-field-action'>
                  <PasswordFieldActionLabel action={field.action} />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const BrowserCredentialBar = memo(BrowserCredentialBarComponent);

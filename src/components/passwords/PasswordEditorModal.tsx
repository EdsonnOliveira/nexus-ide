import { ArrowLeft, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { memo, useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { AppCheckbox } from '@/components/overlay/AppCheckbox';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { PasswordFieldActionLabel } from '@/components/passwords/PasswordFieldActionLabel';
import type { PasswordFieldAction } from '@/types/password';
import {
  PASSWORD_FIELD_ACTION_OPTIONS,
  normalizePasswordFieldAction,
} from '@/utils/createDefaultPasswordCollection';
import { isSensitivePasswordFieldLabel } from '@/utils/passwordLabels';

const PASSWORD_FIELD_ACTION_SELECT_OPTIONS = PASSWORD_FIELD_ACTION_OPTIONS.map((option) => ({
  ...option,
  labelNode: <PasswordFieldActionLabel action={option.value} />,
}));

export interface PasswordDraftField {
  id: string;
  label: string;
  value: string;
  action: PasswordFieldAction;
}

export interface PasswordDraft {
  id: string;
  name: string;
  fields: PasswordDraftField[];
  browserAutofillEnabled: boolean;
  browserUrl: string;
}

interface PasswordFieldRowProps {
  field: PasswordDraftField;
  onChange: (fieldId: string, patch: Partial<PasswordDraftField>) => void;
  onRemove: (fieldId: string) => void;
  canRemove: boolean;
}

function PasswordFieldRowComponent({
  field,
  onChange,
  onRemove,
  canRemove,
}: PasswordFieldRowProps) {
  const [visible, setVisible] = useState(false);
  const sensitive = isSensitivePasswordFieldLabel(field.label);

  const handleLabelChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange(field.id, { label: event.target.value });
    },
    [field.id, onChange],
  );

  const handleValueChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange(field.id, { value: event.target.value });
    },
    [field.id, onChange],
  );

  const handleToggleVisible = useCallback(() => {
    setVisible((current) => !current);
  }, []);

  const handleRemove = useCallback(() => {
    onRemove(field.id);
  }, [field.id, onRemove]);

  const handleActionChange = useCallback(
    (value: string) => {
      onChange(field.id, { action: normalizePasswordFieldAction(value as PasswordFieldAction) });
    },
    [field.id, onChange],
  );

  return (
    <div className='password-editor__field-row'>
      <label className='password-editor__field'>
        <span>Campo</span>
        <input
          type='text'
          value={field.label}
          placeholder='E-mail, Senha...'
          onChange={handleLabelChange}
        />
      </label>
      <label className='password-editor__field password-editor__field--value'>
        <span>Valor</span>
        <div className='password-editor__secret'>
          <input
            type={sensitive && !visible ? 'password' : 'text'}
            value={field.value}
            placeholder='Valor do campo'
            onChange={handleValueChange}
          />
          {sensitive ? (
            <button
              type='button'
              className='password-editor__secret-toggle app-button app-button--enter'
              aria-label={visible ? 'Ocultar' : 'Mostrar'}
              onClick={handleToggleVisible}
            >
              {visible ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          ) : null}
        </div>
      </label>
      <label className='password-editor__field password-editor__field--action'>
        <span>Ação</span>
        <AnchoredSelect
          value={field.action}
          options={PASSWORD_FIELD_ACTION_SELECT_OPTIONS}
          triggerClassName='password-editor__action-select'
          onChange={handleActionChange}
        />
      </label>
      <button
        type='button'
        className='password-editor__remove-field app-button app-button--enter'
        aria-label='Remover campo'
        disabled={!canRemove}
        onClick={handleRemove}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

const PasswordFieldRow = memo(PasswordFieldRowComponent);

interface PasswordEditorModalProps {
  draft: PasswordDraft;
  isExisting: boolean;
  onChange: Dispatch<SetStateAction<PasswordDraft>>;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
}

function PasswordEditorModalComponent({
  draft,
  isExisting,
  onChange,
  onClose,
  onSave,
  onDelete,
}: PasswordEditorModalProps) {
  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange((current) => ({ ...current, name: event.target.value }));
    },
    [onChange],
  );

  const handleFieldChange = useCallback(
    (fieldId: string, patch: Partial<PasswordDraftField>) => {
      onChange((current) => ({
        ...current,
        fields: current.fields.map((field) =>
          field.id === fieldId ? { ...field, ...patch } : field,
        ),
      }));
    },
    [onChange],
  );

  const handleAddField = useCallback(() => {
    onChange((current) => ({
      ...current,
      fields: [
        ...current.fields,
        { id: crypto.randomUUID(), label: '', value: '', action: 'none' as const },
      ],
    }));
  }, [onChange]);

  const handleBrowserAutofillToggle = useCallback(
    (checked: boolean) => {
      onChange((current) => ({
        ...current,
        browserAutofillEnabled: checked,
        browserUrl: checked ? current.browserUrl : '',
      }));
    },
    [onChange],
  );

  const handleBrowserUrlChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange((current) => ({ ...current, browserUrl: event.target.value }));
    },
    [onChange],
  );

  const handleRemoveField = useCallback(
    (fieldId: string) => {
      onChange((current) => ({
        ...current,
        fields: current.fields.filter((field) => field.id !== fieldId),
      }));
    },
    [onChange],
  );

  return (
    <AnimatedModal panelClassName='project-dialog password-editor-modal' onClose={onClose}>
      {() => (
        <div className='password-editor'>
          <div className='password-editor__header'>
            <button
              type='button'
              className='password-editor__back app-button app-button--enter'
              aria-label='Voltar'
              onClick={onClose}
            >
              <ArrowLeft size={16} />
            </button>
            <input
              className='password-editor__name'
              type='text'
              value={draft.name}
              placeholder='Nome da coleção'
              onChange={handleNameChange}
            />
            {isExisting && onDelete ? (
              <button
                type='button'
                className='password-editor__delete app-button app-button--enter'
                aria-label='Excluir coleção'
                onClick={onDelete}
              >
                <Trash2 size={15} />
              </button>
            ) : null}
            <button
              type='button'
              className='password-editor__save app-button app-button--enter'
              onClick={onSave}
            >
              Salvar
            </button>
          </div>
          <div className='password-editor__browser-section'>
            <label className='password-editor__browser-toggle'>
              <AppCheckbox
                checked={draft.browserAutofillEnabled}
                aria-label='Preencher automaticamente no browser'
                onChange={handleBrowserAutofillToggle}
              />
              <span>Preencher automaticamente no browser</span>
            </label>
            {draft.browserAutofillEnabled ? (
              <label className='password-editor__field password-editor__field--url'>
                <span>URL</span>
                <input
                  type='text'
                  value={draft.browserUrl}
                  placeholder='https://exemplo.com/login'
                  onChange={handleBrowserUrlChange}
                />
              </label>
            ) : null}
          </div>
          <div className='password-editor__fields'>
            {draft.fields.map((field) => (
              <PasswordFieldRow
                key={field.id}
                field={field}
                canRemove={draft.fields.length > 1}
                onChange={handleFieldChange}
                onRemove={handleRemoveField}
              />
            ))}
          </div>
          <button
            type='button'
            className='password-editor__add-field app-button app-button--enter'
            onClick={handleAddField}
          >
            <Plus size={14} />
            <span className='app-button__label'>Adicionar campo</span>
          </button>
        </div>
      )}
    </AnimatedModal>
  );
}

export const PasswordEditorModal = memo(PasswordEditorModalComponent);

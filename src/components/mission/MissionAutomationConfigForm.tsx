import { memo, useCallback, useMemo } from 'react';
import { AppCheckbox } from '@/components/overlay/AppCheckbox';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import {
  getMissionAutomationCatalogEntry,
  resolveMissionAutomationFields,
  type MissionAutomationCatalogEntry,
  type MissionAutomationField,
} from '@/constants/missionAutomationCatalog';
import type { MissionAutomationConfig, MissionAutomationConfigValue } from '@/types/mission';

interface MissionAutomationConfigFormProps {
  automation: MissionAutomationConfig;
  onChange: (next: MissionAutomationConfig) => void;
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: MissionAutomationField;
  value: MissionAutomationConfigValue;
  onChange: (value: MissionAutomationConfigValue) => void;
}) {
  if (field.type === 'boolean') {
    return (
      <AppCheckbox
        checked={Boolean(value)}
        aria-label={field.label}
        onChange={(checked) => onChange(checked)}
      />
    );
  }

  if (field.type === 'select') {
    return (
      <AnchoredSelect
        value={value == null ? '' : String(value)}
        options={(field.options ?? []).map((option) => ({
          value: option.value,
          label: option.label,
        }))}
        onChange={(next) => onChange(next)}
        triggerClassName='mission-inspector__select'
      />
    );
  }

  if (field.type === 'textarea') {
    return (
      <textarea
        className='mission-inspector__textarea'
        value={value == null ? '' : String(value)}
        rows={4}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <input
      className='mission-inspector__textarea'
      type={field.type === 'number' ? 'number' : 'text'}
      value={value == null ? '' : String(value)}
      placeholder={field.placeholder}
      onChange={(event) => {
        if (field.type === 'number') {
          const next = event.target.value;
          onChange(next === '' ? null : Number(next));
          return;
        }
        onChange(event.target.value);
      }}
    />
  );
}

function MissionAutomationConfigFormComponent({
  automation,
  onChange,
}: MissionAutomationConfigFormProps) {
  const catalogId = String(automation.config.catalogId ?? '');
  const entry = useMemo(
    () => getMissionAutomationCatalogEntry(catalogId),
    [catalogId],
  ) as MissionAutomationCatalogEntry | undefined;

  const actionValue =
    automation.action ??
    (typeof automation.config.action === 'string' ? automation.config.action : null);

  const fields = useMemo(
    () => (entry ? resolveMissionAutomationFields(entry, actionValue) : []),
    [actionValue, entry],
  );

  const actionOptions = useMemo(
    () =>
      (entry?.actions ?? []).map((action) => ({
        value: action.value,
        label: action.label,
      })),
    [entry],
  );

  const patchConfig = useCallback(
    (key: string, value: MissionAutomationConfigValue) => {
      onChange({
        ...automation,
        config: {
          ...automation.config,
          [key]: value,
        },
      });
    },
    [automation, onChange],
  );

  const handleActionChange = useCallback(
    (value: string) => {
      onChange({
        ...automation,
        action: value || undefined,
        config: {
          ...automation.config,
          action: value || null,
        },
      });
    },
    [automation, onChange],
  );

  if (!entry) {
    return (
      <p className='mission-inspector__text'>
        Configuração do nó indisponível. Recrie o nó pelo seletor.
      </p>
    );
  }

  return (
    <div className='mission-automation-form'>
      {actionOptions.length > 0 ? (
        <div className='mission-inspector__section'>
          <label className='mission-inspector__label'>Ação</label>
          <AnchoredSelect
            value={actionValue ?? ''}
            options={actionOptions}
            onChange={handleActionChange}
            triggerClassName='mission-inspector__select'
          />
        </div>
      ) : null}
      {fields.map((field) => (
        <div key={field.key} className='mission-inspector__section'>
          <label className='mission-inspector__label'>{field.label}</label>
          <FieldControl
            field={field}
            value={automation.config[field.key] ?? null}
            onChange={(value) => patchConfig(field.key, value)}
          />
        </div>
      ))}
      {automation.output ? (
        <div className='mission-inspector__section'>
          <label className='mission-inspector__label'>Última saída</label>
          <pre className='mission-inspector__pre'>
            {JSON.stringify(automation.output, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

export const MissionAutomationConfigForm = memo(MissionAutomationConfigFormComponent);

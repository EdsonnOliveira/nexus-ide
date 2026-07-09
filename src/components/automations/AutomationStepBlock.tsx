import { Bot, Braces, ChevronDown, ChevronUp, Globe, Smartphone, Terminal, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { AppCheckbox } from '@/components/overlay/AppCheckbox';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { AGENT_MODE_OPTIONS } from '@/constants/agentModes';
import { useProjectStore } from '@/stores/useProjectStore';
import type { EmulatorDevice } from '@/types';
import type { AutomationAgentMode, AutomationHttpMethod, AutomationStep } from '@/types/automation';
import { HTTP_METHODS } from '@/utils/apiCollectionUtils';
import { getAutomationStepLabel } from '@/utils/automationLabels';

interface AutomationStepBlockProps {
  step: AutomationStep;
  showReorderControls: boolean;
  showRemoveControl: boolean;
  removeConfirmRequired: boolean;
  removeConfirmTarget: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canJoinSplit: boolean;
  showTabFields: boolean;
  mergeVariant: 'standalone' | 'leader' | 'member';
  onChange: (step: AutomationStep) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function stepIcon(type: AutomationStep['type']) {
  if (type === 'agent') {
    return Bot;
  }

  if (type === 'browser') {
    return Globe;
  }

  if (type === 'emulator') {
    return Smartphone;
  }

  if (type === 'api') {
    return Braces;
  }

  return Terminal;
}

function AutomationStepBlockComponent({
  step,
  canJoinSplit,
  showTabFields,
  mergeVariant,
  showReorderControls,
  showRemoveControl,
  removeConfirmRequired,
  removeConfirmTarget,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: AutomationStepBlockProps) {
  const Icon = stepIcon(step.type);
  const projectPath = useProjectStore((state) => {
    const activeId = state.activeProjectId;

    return state.projects.find((project) => project.id === activeId)?.path ?? null;
  });
  const [agentModelOptions, setAgentModelOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [emulatorDevices, setEmulatorDevices] = useState<EmulatorDevice[]>([]);
  const [isLoadingEmulatorDevices, setIsLoadingEmulatorDevices] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);

  const handleRemoveClick = useCallback(() => {
    if (!removeConfirmRequired) {
      onRemove();
      return;
    }

    setRemoveConfirmOpen(true);
  }, [onRemove, removeConfirmRequired]);

  const handleRemoveConfirm = useCallback(
    (requestClose: () => void) => {
      onRemove();
      requestClose();
      setRemoveConfirmOpen(false);
    },
    [onRemove],
  );

  useEffect(() => {
    if (step.type !== 'agent' || !projectPath) {
      return;
    }

    let cancelled = false;

    void window.nexus.files.getAgentSkillHints(projectPath).then((hints) => {
      if (cancelled) {
        return;
      }

      setAgentModelOptions(
        hints
          .filter((hint) => hint.hintKind === 'model')
          .map((hint) => ({
            id: hint.command.replace(/^\/model\s+/, '').replace(/\n$/, '').trim(),
            label: hint.label,
          })),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [projectPath, step.type]);

  useEffect(() => {
    if (step.type !== 'emulator') {
      setEmulatorDevices([]);
      setIsLoadingEmulatorDevices(false);
      return;
    }

    let cancelled = false;
    setIsLoadingEmulatorDevices(true);

    void window.nexus.emulator.listDevices(step.platform ?? 'android').then((devices) => {
      if (cancelled) {
        return;
      }

      setEmulatorDevices(devices);
      setIsLoadingEmulatorDevices(false);
    });

    return () => {
      cancelled = true;
    };
  }, [step.platform, step.type]);

  const agentModeSelectOptions = useMemo(
    () => AGENT_MODE_OPTIONS.map((mode) => ({ value: mode.id, label: mode.label })),
    [],
  );

  const agentModelSelectOptions = useMemo(
    () => agentModelOptions.map((model) => ({ value: model.id, label: model.label })),
    [agentModelOptions],
  );

  const platformSelectOptions = useMemo(
    () => [
      { value: 'android' as const, label: 'Android' },
      { value: 'ios' as const, label: 'iOS' },
    ],
    [],
  );

  const deviceSelectOptions = useMemo(
    () =>
      emulatorDevices.map((device) => ({
        value: device.id,
        label: device.subtitle ? `${device.name} · ${device.subtitle}` : device.name,
        subtitle: device.platform === 'ios' ? device.id : undefined,
      })),
    [emulatorDevices],
  );

  const methodSelectOptions = useMemo(
    () => HTTP_METHODS.map((method) => ({ value: method, label: method })),
    [],
  );

  return (
    <div
      className={`automation-step-block automation-step-block--${step.type}${mergeVariant !== 'standalone' ? ` automation-step-block--group-${mergeVariant}` : ''}`}
    >
      <div className='automation-step-block__header'>
        {showReorderControls ? (
          <div className='automation-step-block__reorder'>
            <button
              type='button'
              className='automation-step-block__reorder-btn app-button'
              aria-label='Mover ação para cima'
              disabled={!canMoveUp}
              onClick={onMoveUp}
            >
              <ChevronUp size={12} strokeWidth={2} aria-hidden />
            </button>
            <button
              type='button'
              className='automation-step-block__reorder-btn app-button'
              aria-label='Mover ação para baixo'
              disabled={!canMoveDown}
              onClick={onMoveDown}
            >
              <ChevronDown size={12} strokeWidth={2} aria-hidden />
            </button>
          </div>
        ) : null}
        <Icon size={14} strokeWidth={2} aria-hidden />
        <span className='automation-step-block__title'>{getAutomationStepLabel(step.type)}</span>
        {showRemoveControl ? (
          <button
            type='button'
            className='automation-step-block__remove app-button'
            aria-label='Remover ação'
            onClick={handleRemoveClick}
          >
            <X size={12} strokeWidth={2} />
          </button>
        ) : null}
      </div>
      {canJoinSplit ? (
        <div className='automation-step-block__layout'>
          <span className='automation-step-block__layout-label'>Disposição</span>
          <div className='automation-step-block__segmented'>
            <button
              type='button'
              className={`automation-step-block__segment${(step.openMode ?? 'separate') === 'separate' ? ' automation-step-block__segment--active' : ''}`}
              onClick={() => onChange({ ...step, openMode: 'separate' })}
            >
              Aba separada
            </button>
            <button
              type='button'
              className={`automation-step-block__segment${step.openMode === 'split-with-previous' ? ' automation-step-block__segment--active' : ''}`}
              onClick={() => onChange({ ...step, openMode: 'split-with-previous' })}
            >
              Split com anterior
            </button>
          </div>
        </div>
      ) : null}
      {showTabFields ? (
        <div className='automation-step-block__fields automation-step-block__fields--tab'>
          <label className='automation-step-block__field'>
            <span>Nome da aba</span>
            <input
              value={step.tabTitle ?? ''}
              placeholder='Opcional'
              onChange={(event) => onChange({ ...step, tabTitle: event.target.value })}
            />
          </label>
          <div className='automation-step-block__checkbox'>
            <AppCheckbox
              checked={step.pinned ?? false}
              onChange={(pinned) => onChange({ ...step, pinned })}
              aria-label='Manter aba fixa'
            />
            <button
              type='button'
              className='automation-step-block__checkbox-label'
              onClick={() => onChange({ ...step, pinned: !step.pinned })}
            >
              Manter aba fixa
            </button>
          </div>
        </div>
      ) : null}
      {(step.type === 'terminal' || step.type === 'agent') && (
        <div className='automation-step-block__fields'>
          <label className='automation-step-block__field'>
            <span>Pasta</span>
            <input
              value={step.cwd ?? ''}
              placeholder='./ (opcional)'
              onChange={(event) => onChange({ ...step, cwd: event.target.value })}
            />
          </label>
          <label className='automation-step-block__field'>
            <span>Comando</span>
            <input
              value={step.command ?? ''}
              placeholder={step.type === 'agent' ? 'cursor-agent' : 'yarn dev'}
              onChange={(event) => onChange({ ...step, command: event.target.value })}
            />
          </label>
          {step.type === 'agent' ? (
            <>
              <label className='automation-step-block__field'>
                <span>Modo</span>
                <AnchoredSelect
                  value={step.agentMode ?? ''}
                  options={agentModeSelectOptions}
                  allowEmpty
                  emptyLabel='Padrão'
                  triggerClassName='automation-step-block__select'
                  onChange={(value) =>
                    onChange({
                      ...step,
                      agentMode: value ? (value as AutomationAgentMode) : undefined,
                    })
                  }
                />
              </label>
              <label className='automation-step-block__field'>
                <span>Modelo</span>
                <AnchoredSelect
                  value={step.agentModel ?? ''}
                  options={agentModelSelectOptions}
                  allowEmpty
                  emptyLabel='Padrão'
                  triggerClassName='automation-step-block__select'
                  onChange={(value) =>
                    onChange({
                      ...step,
                      agentModel: value || undefined,
                    })
                  }
                />
              </label>
            </>
          ) : null}
        </div>
      )}
      {step.type === 'browser' && (
        <div className='automation-step-block__fields'>
          <label className='automation-step-block__field'>
            <span>URL</span>
            <input
              value={step.url ?? ''}
              placeholder='http://localhost:3000'
              onChange={(event) => onChange({ ...step, url: event.target.value })}
            />
          </label>
        </div>
      )}
      {step.type === 'emulator' && (
        <div className='automation-step-block__fields'>
          <label className='automation-step-block__field'>
            <span>Plataforma</span>
            <AnchoredSelect
              value={step.platform ?? 'android'}
              options={platformSelectOptions}
              triggerClassName='automation-step-block__select'
              onChange={(value) =>
                onChange({
                  ...step,
                  platform: (value || 'android') as 'android' | 'ios',
                  deviceId: undefined,
                })
              }
            />
          </label>
          <label className='automation-step-block__field'>
            <span>Dispositivo</span>
            <AnchoredSelect
              value={step.deviceId ?? ''}
              options={deviceSelectOptions}
              allowEmpty
              emptyLabel={isLoadingEmulatorDevices ? 'Carregando...' : 'Padrão'}
              triggerClassName='automation-step-block__select'
              onChange={(value) =>
                onChange({
                  ...step,
                  deviceId: value || undefined,
                })
              }
            />
          </label>
          <div className='automation-step-block__checkbox'>
            <AppCheckbox
              checked={step.autoStartEmulator !== false}
              onChange={(autoStartEmulator) => onChange({ ...step, autoStartEmulator })}
              aria-label='Iniciar emulador ao executar automação'
            />
            <button
              type='button'
              className='automation-step-block__checkbox-label'
              onClick={() =>
                onChange({ ...step, autoStartEmulator: step.autoStartEmulator === false })
              }
            >
              Iniciar emulador ao executar automação
            </button>
          </div>
        </div>
      )}
      {step.type === 'api' && (
        <div className='automation-step-block__fields'>
          <label className='automation-step-block__field'>
            <span>Requisição</span>
            <input
              value={step.title ?? ''}
              placeholder='Minha request'
              onChange={(event) => onChange({ ...step, title: event.target.value })}
            />
          </label>
          <label className='automation-step-block__field'>
            <span>Método</span>
            <AnchoredSelect
              value={step.method ?? 'GET'}
              options={methodSelectOptions}
              triggerClassName='automation-step-block__select'
              onChange={(value) =>
                onChange({ ...step, method: (value || 'GET') as AutomationHttpMethod })
              }
            />
          </label>
          <label className='automation-step-block__field'>
            <span>URL</span>
            <input
              value={step.url ?? ''}
              placeholder='http://localhost:3000/api'
              onChange={(event) => onChange({ ...step, url: event.target.value })}
            />
          </label>
          <label className='automation-step-block__field'>
            <span>Headers</span>
            <textarea
              value={step.headers ?? ''}
              placeholder={'Content-Type: application/json\nAuthorization: Bearer token'}
              rows={3}
              onChange={(event) => onChange({ ...step, headers: event.target.value })}
            />
          </label>
          <label className='automation-step-block__field'>
            <span>Body</span>
            <textarea
              value={step.body ?? ''}
              placeholder='{"key":"value"}'
              rows={4}
              onChange={(event) => onChange({ ...step, body: event.target.value })}
            />
          </label>
        </div>
      )}
      {removeConfirmOpen ? (
        <AnimatedModal onClose={() => setRemoveConfirmOpen(false)} panelClassName='project-dialog'>
          {(requestClose) => (
            <>
              <span className='project-dialog__title'>Remover ação</span>
              <p className='project-dialog__message'>
                Tem certeza que deseja remover <strong>{removeConfirmTarget}</strong>?
              </p>
              <div className='project-dialog__actions'>
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--ghost app-button'
                  onClick={requestClose}
                >
                  Cancelar
                </button>
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--danger app-button'
                  onClick={() => handleRemoveConfirm(requestClose)}
                >
                  Remover
                </button>
              </div>
            </>
          )}
        </AnimatedModal>
      ) : null}
    </div>
  );
}

export const AutomationStepBlock = memo(AutomationStepBlockComponent);

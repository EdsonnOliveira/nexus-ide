import { ArrowDownToLine, ArrowLeft, ClipboardCopy, ClipboardPaste, Play, Trash2 } from 'lucide-react';
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { AutomationActionLibrary } from '@/components/automations/AutomationActionLibrary';
import { AutomationPromptModal } from '@/components/automations/AutomationPromptModal';
import { AutomationStepBlock } from '@/components/automations/AutomationStepBlock';
import { EmptyState } from '@/components/overlay/EmptyState';
import { AppCheckbox } from '@/components/overlay/AppCheckbox';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import type { Automation, AutomationStep, AutomationStepType } from '@/types/automation';
import {
  AUTOMATION_MAX_STEPS,
} from '@/types/automation';
import { isAutomationStepEmpty, serializeAutomationPrompt } from '@/utils/automationPrompt';
import { getAutomationStepLabel } from '@/utils/automationLabels';
import { canAddAutomationStep } from '@/utils/createDefaultAutomation';
import {
  buildAutomationDefaultActiveStepOptions,
  groupAutomationSteps,
  normalizeAutomationDefaultActiveStepId,
  normalizeAutomationSteps,
  type AutomationStepGroup,
} from '@/utils/normalizeAutomation';

interface AutomationEditorViewProps {
  draft: Automation;
  isExisting: boolean;
  onChange: Dispatch<SetStateAction<Automation>>;
  onBack: () => void;
  onSave: () => void;
  onPlay: () => void;
  onDelete?: () => void;
}

function createStep(type: AutomationStepType): AutomationStep {
  if (type === 'api') {
    return {
      id: crypto.randomUUID(),
      type,
      title: '',
      method: 'GET',
      url: '',
      headers: '',
      body: '',
      openMode: 'separate',
    };
  }

  if (type === 'emulator') {
    return {
      id: crypto.randomUUID(),
      type,
      openMode: 'separate',
      autoStartEmulator: true,
    };
  }

  return {
    id: crypto.randomUUID(),
    type,
    openMode: 'separate',
  };
}

function patchDraftSteps(draft: Automation, steps: AutomationStep[]): Automation {
  const normalizedSteps = normalizeAutomationSteps(steps);
  const defaultActiveStepId = normalizeAutomationDefaultActiveStepId(
    normalizedSteps,
    draft.defaultActiveStepId,
  );

  return {
    ...draft,
    steps: normalizedSteps,
    defaultActiveStepId,
  };
}

function moveGroupByOffset(steps: AutomationStep[], groupLeaderStepId: string, offset: -1 | 1): AutomationStep[] {
  const groups = groupAutomationSteps(steps);
  const groupIndex = groups.findIndex((group) => group.steps[0]?.step.id === groupLeaderStepId);

  if (groupIndex === -1) {
    return steps;
  }

  const targetGroupIndex = groupIndex + offset;

  if (targetGroupIndex < 0 || targetGroupIndex >= groups.length) {
    return steps;
  }

  const nextGroups = [...groups];
  [nextGroups[groupIndex], nextGroups[targetGroupIndex]] = [
    nextGroups[targetGroupIndex],
    nextGroups[groupIndex],
  ];

  return nextGroups.flatMap((group) => group.steps.map((item) => item.step));
}

function removeAutomationStepGroup(steps: AutomationStep[], group: AutomationStepGroup): AutomationStep[] {
  const groupIds = new Set(group.steps.map((item) => item.step.id));
  return steps.filter((step) => !groupIds.has(step.id));
}

function AutomationEditorViewComponent({
  draft,
  isExisting,
  onChange,
  onBack,
  onSave,
  onPlay,
  onDelete,
}: AutomationEditorViewProps) {
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const scrollToBottomRef = useRef(false);
  const prevStepsLengthRef = useRef(draft.steps.length);

  const promptText = useMemo(() => serializeAutomationPrompt(draft), [draft]);

  const defaultActiveStepOptions = useMemo(
    () => buildAutomationDefaultActiveStepOptions(draft.steps),
    [draft.steps],
  );

  const canAddMoreSteps = canAddAutomationStep(draft.steps.length);

  useLayoutEffect(() => {
    const prevLength = prevStepsLengthRef.current;
    prevStepsLengthRef.current = draft.steps.length;

    if (!scrollToBottomRef.current || draft.steps.length <= prevLength) {
      scrollToBottomRef.current = false;
      return;
    }

    scrollToBottomRef.current = false;
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    requestAnimationFrame(() => {
      canvas.scrollTop = canvas.scrollHeight;
    });
  }, [draft.steps.length]);

  const handleAddStep = useCallback(
    (type: AutomationStepType) => {
      scrollToBottomRef.current = true;
      onChange((current) => {
        if (!canAddAutomationStep(current.steps.length)) {
          scrollToBottomRef.current = false;
          return current;
        }

        return patchDraftSteps(current, [...current.steps, createStep(type)]);
      });
    },
    [onChange],
  );

  const stepGroups = useMemo(() => groupAutomationSteps(draft.steps), [draft.steps]);

  const handleMoveStep = useCallback(
    (groupLeaderStepId: string, offset: -1 | 1) => {
      onChange((current) =>
        patchDraftSteps(current, moveGroupByOffset(current.steps, groupLeaderStepId, offset)),
      );
    },
    [onChange],
  );

  const handleRemoveGroup = useCallback(
    (group: AutomationStepGroup) => {
      onChange((current) => patchDraftSteps(current, removeAutomationStepGroup(current.steps, group)));
    },
    [onChange],
  );

  const handleApplyPrompt = useCallback(
    (data: Omit<Automation, 'id'>) => {
      onChange({
        ...data,
        id: draft.id,
      });
      setPromptModalOpen(false);
    },
    [draft.id, onChange],
  );

  return (
    <div className='automation-editor'>
      <div className='automation-editor__header'>
        <button type='button' className='automation-editor__back app-button app-button--enter' onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={2} />
        </button>
        <input
          className='automation-editor__name'
          value={draft.name}
          placeholder='Nome da automação'
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
        <button
          type='button'
          className='automation-editor__prompt app-button app-button--enter'
          aria-label={isExisting ? 'Copiar prompt' : 'Colar prompt'}
          onClick={() => setPromptModalOpen(true)}
        >
          {isExisting ? (
            <ClipboardCopy size={14} strokeWidth={2} />
          ) : (
            <ClipboardPaste size={14} strokeWidth={2} />
          )}
        </button>
        <button
          type='button'
          className='automation-editor__delete app-button app-button--enter'
          aria-label='Excluir automação'
          onClick={onDelete}
          disabled={!onDelete}
        >
          <Trash2 size={14} strokeWidth={2} />
        </button>
        <button
          type='button'
          className='automation-editor__play app-button app-button--enter'
          aria-label='Executar automação'
          onClick={onPlay}
        >
          <Play size={14} strokeWidth={2} />
        </button>
        <button type='button' className='automation-editor__save app-button app-button--enter' onClick={onSave}>
          Salvar
        </button>
      </div>

      <div className='automation-editor__meta'>
        <div className='automation-editor__segmented'>
          <button
            type='button'
            className={`automation-editor__segment${draft.trigger === 'manual' ? ' automation-editor__segment--active' : ''}`}
            onClick={() => onChange({ ...draft, trigger: 'manual', intervalMinutes: undefined })}
          >
            Por clique
          </button>
          <button
            type='button'
            className={`automation-editor__segment${draft.trigger === 'interval' ? ' automation-editor__segment--active' : ''}`}
            onClick={() => onChange({ ...draft, trigger: 'interval', intervalMinutes: draft.intervalMinutes ?? 1 })}
          >
            Por tempo
          </button>
          <button
            type='button'
            className={`automation-editor__segment${draft.trigger === 'app_open' ? ' automation-editor__segment--active' : ''}`}
            onClick={() => onChange({ ...draft, trigger: 'app_open', intervalMinutes: undefined })}
          >
            Ao abrir a IDE
          </button>
        </div>
        {draft.trigger === 'interval' ? (
          <label className='automation-editor__interval'>
            <span>Min</span>
            <input
              type='number'
              min={1}
              value={draft.intervalMinutes ?? 1}
              onChange={(event) =>
                onChange({ ...draft, intervalMinutes: Math.max(1, Number(event.target.value) || 1) })
              }
            />
          </label>
        ) : null}
        <div className='automation-editor__checkbox'>
          <AppCheckbox
            checked={draft.closeOpenTabsBeforeRun}
            onChange={(closeOpenTabsBeforeRun) =>
              onChange({ ...draft, closeOpenTabsBeforeRun })
            }
            aria-label='Fechar abas abertas para executar automação?'
          />
          <button
            type='button'
            className='automation-editor__checkbox-label'
            onClick={() =>
              onChange({ ...draft, closeOpenTabsBeforeRun: !draft.closeOpenTabsBeforeRun })
            }
          >
            Fechar abas abertas para executar automação?
          </button>
        </div>
        <label className='automation-editor__default-tab'>
          <span>Aba selecionada ao executar</span>
          <AnchoredSelect
            value={draft.defaultActiveStepId ?? ''}
            options={defaultActiveStepOptions}
            allowEmpty
            emptyLabel='Última aba (padrão)'
            disabled={defaultActiveStepOptions.length === 0}
            triggerClassName='automation-editor__default-tab-select'
            onChange={(value) =>
              onChange({ ...draft, defaultActiveStepId: value || null })
            }
          />
        </label>
      </div>

      <div className='automation-editor__body'>
        <div ref={canvasRef} className='automation-editor__canvas'>
          {draft.steps.length === 0 ? (
            <EmptyState
              icon={ArrowDownToLine}
              message='Adicione uma ação pela lista Abas'
              compact
              className='automation-editor__empty'
            />
          ) : (
            stepGroups.map((group, groupIndex) => (
              <div
                key={group.steps.map((item) => item.step.id).join('-')}
                className='automation-editor__step-wrap'
              >
                {groupIndex > 0 ? <span className='automation-step-connector' aria-hidden /> : null}
                <div className={group.steps.length > 1 ? 'automation-step-group' : undefined}>
                  {group.steps.map(({ step, index }, memberIndex) => {
                    const isSplitMember = group.steps.length > 1 && memberIndex > 0;
                    const groupLeaderId = group.steps[0].step.id;

                    return (
                    <AutomationStepBlock
                      key={step.id}
                      step={step}
                      showReorderControls={!isSplitMember}
                      showRemoveControl={!isSplitMember}
                      removeConfirmRequired={group.steps.some(
                        ({ step: groupStep }) => !isAutomationStepEmpty(groupStep),
                      )}
                      removeConfirmTarget={
                        group.steps.length > 1
                          ? 'estas ações em split'
                          : getAutomationStepLabel(group.steps[0].step.type)
                      }
                      canMoveUp={groupIndex > 0}
                      canMoveDown={groupIndex < stepGroups.length - 1}
                      canJoinSplit={index > 0}
                      showTabFields={(step.openMode ?? 'separate') === 'separate'}
                      mergeVariant={
                        group.steps.length === 1
                          ? 'standalone'
                          : memberIndex === 0
                            ? 'leader'
                            : 'member'
                      }
                      onChange={(nextStep) =>
                        onChange(
                          patchDraftSteps(
                            draft,
                            draft.steps.map((item) => (item.id === nextStep.id ? nextStep : item)),
                          ),
                        )
                      }
                      onRemove={() => handleRemoveGroup(group)}
                      onMoveUp={() => handleMoveStep(groupLeaderId, -1)}
                      onMoveDown={() => handleMoveStep(groupLeaderId, 1)}
                    />
                    );
                  })}
                </div>
              </div>
            ))
          )}
          {draft.steps.length > 0 && draft.steps.length < AUTOMATION_MAX_STEPS ? (
            <span className='automation-step-connector automation-step-connector--tail' aria-hidden />
          ) : null}
        </div>
        <AutomationActionLibrary canAddMore={canAddMoreSteps} onAddStep={handleAddStep} />
      </div>

      {promptModalOpen ? (
        <AutomationPromptModal
          mode={isExisting ? 'copy' : 'paste'}
          promptText={promptText}
          onClose={() => setPromptModalOpen(false)}
          onApply={isExisting ? undefined : handleApplyPrompt}
        />
      ) : null}
    </div>
  );
}

export const AutomationEditorView = memo(AutomationEditorViewComponent);

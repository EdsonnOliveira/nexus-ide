import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import type { Automation } from '@/types/automation';
import {
  AUTOMATION_PROMPT_PLACEHOLDER,
  parseAutomationPrompt,
} from '@/utils/automationPrompt';

type AutomationPromptModalMode = 'paste' | 'copy';

interface AutomationPromptModalProps {
  mode: AutomationPromptModalMode;
  promptText: string;
  onClose: () => void;
  onApply?: (data: Omit<Automation, 'id'>) => void;
}

function AutomationPromptModalComponent({
  mode,
  promptText,
  onClose,
  onApply,
}: AutomationPromptModalProps) {
  const [value, setValue] = useState(() => (mode === 'copy' ? promptText : ''));
  const [error, setError] = useState<string | null>(null);
  const [copiedKind, setCopiedKind] = useState<'example' | 'content' | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();

    if (mode === 'paste') {
      textareaRef.current?.select();
    }
  }, [mode]);

  const handleApply = useCallback(
    (requestClose: () => void) => {
      const result = parseAutomationPrompt(value);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      onApply?.(result.data);
      requestClose();
    },
    [onApply, value],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopiedKind('content');
      setError(null);
      window.setTimeout(() => setCopiedKind(null), 1500);
    } catch {
      setError('Não foi possível copiar o prompt.');
    }
  }, [promptText]);

  const handleCopyExample = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(AUTOMATION_PROMPT_PLACEHOLDER);
      setCopiedKind('example');
      setError(null);
      window.setTimeout(() => setCopiedKind(null), 1500);
    } catch {
      setError('Não foi possível copiar o exemplo.');
    }
  }, []);

  const handleChange = useCallback((nextValue: string) => {
    setValue(nextValue);
    setError(null);
  }, []);

  return (
    <AnimatedModal onClose={onClose} panelClassName='project-dialog automation-prompt-modal'>
      {(requestClose) => (
        <>
          <div className='automation-prompt-modal__header'>
            <span className='project-dialog__title'>
              {mode === 'paste' ? 'Colar prompt' : 'Copiar prompt'}
            </span>
            {mode === 'paste' ? (
              <button
                type='button'
                className='automation-prompt-modal__copy-example app-button app-button--enter'
                onClick={() => void handleCopyExample()}
              >
                Copiar exemplo
              </button>
            ) : null}
          </div>
          <label className='project-dialog__label automation-prompt-modal__label'>
            {mode === 'paste' ? 'Prompt JSON' : 'Prompt da automação'}
            <textarea
              ref={textareaRef}
              className='automation-prompt-modal__textarea'
              value={mode === 'copy' ? promptText : value}
              readOnly={mode === 'copy'}
              placeholder={mode === 'paste' ? AUTOMATION_PROMPT_PLACEHOLDER : undefined}
              rows={12}
              onChange={(event) => {
                if (mode === 'paste') {
                  handleChange(event.target.value);
                }
              }}
            />
          </label>
          {error ? <p className='automation-prompt-modal__error'>{error}</p> : null}
          {copiedKind ? (
            <p className='automation-prompt-modal__success'>
              {copiedKind === 'example' ? 'Exemplo copiado.' : 'Prompt copiado.'}
            </p>
          ) : null}
          <div className='project-dialog__actions'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--ghost app-button'
              onClick={requestClose}
            >
              Cancelar
            </button>
            {mode === 'paste' ? (
              <button
                type='button'
                className='project-dialog__btn project-dialog__btn--primary app-button app-button--enter'
                onClick={() => handleApply(requestClose)}
              >
                Aplicar
              </button>
            ) : (
              <button
                type='button'
                className='project-dialog__btn project-dialog__btn--primary app-button app-button--enter'
                onClick={() => void handleCopy()}
              >
                Copiar
              </button>
            )}
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

export const AutomationPromptModal = memo(AutomationPromptModalComponent);

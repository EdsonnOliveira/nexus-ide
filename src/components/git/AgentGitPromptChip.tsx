import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';

import { sanitizeAgentPrompt } from '@/utils/terminalShellPrompt';

interface AgentGitPromptLabelProps {
  prompt: string;
  className?: string;
  onOpen: (prompt: string) => void;
}

export const AgentGitPromptLabel = memo(function AgentGitPromptLabelComponent({
  prompt,
  className,
  onOpen,
}: AgentGitPromptLabelProps) {
  const displayPrompt = sanitizeAgentPrompt(prompt);
  const labelRef = useRef<HTMLButtonElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const element = labelRef.current;

    if (!element) {
      return;
    }

    const checkTruncation = () => {
      setIsTruncated(element.scrollWidth > element.clientWidth);
    };

    checkTruncation();

    const observer = new ResizeObserver(checkTruncation);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [displayPrompt]);

  const handleClick = useCallback(() => {
    if (isTruncated) {
      onOpen(displayPrompt);
    }
  }, [displayPrompt, isTruncated, onOpen]);

  return (
    <button
      ref={labelRef}
      type='button'
      className={`git-scm__prompt-label git-scm__prompt-label-btn app-button app-button--enter${isTruncated ? ' git-scm__prompt-label-btn--expandable' : ''}${className ? ` ${className}` : ''}`}
      title={isTruncated ? displayPrompt : undefined}
      onClick={handleClick}
    >
      &ldquo;{displayPrompt}&rdquo;
    </button>
  );
});

interface AgentGitPromptModalProps {
  prompt: string;
  onClose: () => void;
}

export const AgentGitPromptModal = memo(function AgentGitPromptModalComponent({
  prompt,
  onClose,
}: AgentGitPromptModalProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setError(null);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Não foi possível copiar o prompt.');
    }
  }, [prompt]);

  return (
    <AnimatedModal onClose={onClose} panelClassName='project-dialog automation-prompt-modal git-prompt-modal'>
      {(requestClose) => (
        <>
          <span className='project-dialog__title'>Prompt do agent</span>
          <label className='project-dialog__label automation-prompt-modal__label'>
            Texto completo
            <textarea
              className='automation-prompt-modal__textarea git-prompt-modal__textarea'
              value={prompt}
              readOnly
              rows={8}
            />
          </label>
          {error ? <p className='automation-prompt-modal__error'>{error}</p> : null}
          {copied ? <p className='automation-prompt-modal__success'>Prompt copiado.</p> : null}
          <div className='project-dialog__actions'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--ghost app-button'
              onClick={requestClose}
            >
              Fechar
            </button>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--primary app-button app-button--enter'
              onClick={() => void handleCopy()}
            >
              Copiar
            </button>
          </div>
        </>
      )}
    </AnimatedModal>
  );
});

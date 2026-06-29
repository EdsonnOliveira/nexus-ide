import { memo, useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface AgentResponseCopyPillProps {
  content: string;
}

function AgentResponseCopyPillComponent({ content }: AgentResponseCopyPillProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!content.trim()) {
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [content]);

  return (
    <button
      type='button'
      className={`agent-view__response-pill agent-view__response-copy app-button app-button--enter${copied ? ' agent-view__response-copy--copied' : ''}`}
      aria-label={copied ? 'Resposta copiada' : 'Copiar resposta'}
      onClick={() => void handleCopy()}
    >
      <span className='agent-view__response-copy-icon' aria-hidden='true'>
        <Copy size={12} className='agent-view__response-copy-icon-copy' />
        <Check size={12} className='agent-view__response-copy-icon-check' />
      </span>
      <span className='agent-view__response-copy-label'>{copied ? 'Copiado' : 'Copiar'}</span>
    </button>
  );
}

export const AgentResponseCopyPill = memo(AgentResponseCopyPillComponent);

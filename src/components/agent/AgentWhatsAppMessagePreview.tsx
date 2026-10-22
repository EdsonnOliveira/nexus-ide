import { memo, useMemo } from 'react';
import { CheckCheck } from 'lucide-react';

interface AgentWhatsAppMessagePreviewProps {
  message: string;
  emptyLabel?: string;
}

function formatWhatsAppPreviewTime(date = new Date()): string {
  return date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function AgentWhatsAppMessagePreviewComponent({
  message,
  emptyLabel = 'Digite a mensagem…',
}: AgentWhatsAppMessagePreviewProps) {
  const timeLabel = useMemo(() => formatWhatsAppPreviewTime(), []);
  const displayText = message.trim() || emptyLabel;
  const isEmpty = !message.trim();

  return (
    <div className='agent-whatsapp-preview' aria-hidden='true'>
      <div className='agent-whatsapp-preview__wallpaper' />
      <div className='agent-whatsapp-preview__row'>
        <div
          className={`agent-whatsapp-preview__bubble${isEmpty ? ' agent-whatsapp-preview__bubble--empty' : ''}`}
        >
          <p className='agent-whatsapp-preview__text'>{displayText}</p>
          <span className='agent-whatsapp-preview__meta'>
            <span className='agent-whatsapp-preview__time'>{timeLabel}</span>
            <CheckCheck size={14} strokeWidth={2.25} className='agent-whatsapp-preview__checks' />
          </span>
        </div>
      </div>
    </div>
  );
}

export const AgentWhatsAppMessagePreview = memo(AgentWhatsAppMessagePreviewComponent);

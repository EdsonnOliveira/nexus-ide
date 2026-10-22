import { memo, useCallback, type ChangeEvent, type RefObject } from 'react';

interface AgentWhatsAppNotifyFieldsProps {
  message: string;
  link: string;
  error: string | null;
  messageInputRef?: RefObject<HTMLTextAreaElement | null>;
  onMessageChange: (value: string) => void;
  onLinkChange: (value: string) => void;
}

function AgentWhatsAppNotifyFieldsComponent({
  message,
  link,
  error,
  messageInputRef,
  onMessageChange,
  onLinkChange,
}: AgentWhatsAppNotifyFieldsProps) {
  const handleMessageChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      onMessageChange(event.target.value);
    },
    [onMessageChange],
  );

  const handleLinkChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onLinkChange(event.target.value);
    },
    [onLinkChange],
  );

  return (
    <div className='agent-whatsapp-notify__fields'>
      <label className='project-dialog__label agent-whatsapp-notify__field'>
        <span>Mensagem</span>
        <textarea
          ref={messageInputRef}
          className='agent-whatsapp-notify__textarea'
          value={message}
          rows={4}
          placeholder='Digite a mensagem do WhatsApp'
          spellCheck={false}
          onChange={handleMessageChange}
        />
      </label>
      <label className='project-dialog__label agent-whatsapp-notify__field'>
        <span>Número ou link da conversa</span>
        <input
          type='tel'
          inputMode='tel'
          autoComplete='tel'
          className='project-dialog__input'
          value={link}
          placeholder='Insira o numero ou url'
          onChange={handleLinkChange}
        />
      </label>
      {error ? <span className='agent-whatsapp-notify__error'>{error}</span> : null}
    </div>
  );
}

export const AgentWhatsAppNotifyFields = memo(AgentWhatsAppNotifyFieldsComponent);

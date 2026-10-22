import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { AgentWhatsAppMessagePreview } from '@/components/agent/AgentWhatsAppMessagePreview';
import { AgentWhatsAppNotifyFields } from '@/components/agent/AgentWhatsAppNotifyFields';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { SidebarWhatsAppIcon } from '@/components/sidebar/SidebarWhatsAppIcon';
import type { AgentWhatsAppNotify } from '@/types';
import { parseSidebarWhatsAppLink } from '@/utils/sidebarWhatsAppLink';

interface AgentWhatsAppMarkModalProps {
  initialMessage: string;
  initialLink: string;
  isMarked: boolean;
  onClose: () => void;
  onSave: (notify: AgentWhatsAppNotify) => void;
  onRemove?: () => void;
}

function AgentWhatsAppMarkModalComponent({
  initialMessage,
  initialLink,
  isMarked,
  onClose,
  onSave,
  onRemove,
}: AgentWhatsAppMarkModalProps) {
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState(initialMessage);
  const [link, setLink] = useState(initialLink);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    messageInputRef.current?.focus();
  }, []);

  const clearError = useCallback(() => {
    if (error) {
      setError(null);
    }
  }, [error]);

  const handleMessageChange = useCallback(
    (value: string) => {
      setMessage(value);
      clearError();
    },
    [clearError],
  );

  const handleLinkChange = useCallback(
    (value: string) => {
      setLink(value);
      clearError();
    },
    [clearError],
  );

  const handleSave = useCallback(() => {
    const parsed = parseSidebarWhatsAppLink(link);

    if (!parsed) {
      setError('Informe um número com DDI (ex.: +55 61 99919-1442) ou um link oficial do WhatsApp.');
      return;
    }

    onSave({
      message: message.trim(),
      link: parsed,
    });
  }, [link, message, onSave]);

  return (
    <AnimatedModal panelClassName='project-dialog agent-whatsapp-notify-modal' onClose={onClose}>
      {(requestClose) => (
        <>
          <div className='agent-whatsapp-notify__header'>
            <div className='agent-whatsapp-notify__heading'>
              <span className='agent-whatsapp-notify__badge' aria-hidden='true'>
                <SidebarWhatsAppIcon size={14} />
              </span>
              <div className='agent-whatsapp-notify__intro'>
                <h2 className='project-dialog__title agent-whatsapp-notify__title'>
                  Avisar no WhatsApp
                </h2>
                <p className='agent-whatsapp-notify__subtitle'>
                  Quando este prompt terminar, você poderá enviar a mensagem.
                </p>
              </div>
            </div>
            <button
              type='button'
              className='project-dialog__close app-button'
              aria-label='Fechar'
              onClick={requestClose}
            >
              <X size={16} />
            </button>
          </div>
          <AgentWhatsAppMessagePreview message={message} />
          <AgentWhatsAppNotifyFields
            message={message}
            link={link}
            error={error}
            messageInputRef={messageInputRef}
            onMessageChange={handleMessageChange}
            onLinkChange={handleLinkChange}
          />
          <div className='project-dialog__actions project-dialog__actions--split'>
            <div className='project-dialog__actions-group'>
              {isMarked && onRemove ? (
                <button
                  type='button'
                  className='project-dialog__btn project-dialog__btn--ghost app-button app-button--enter'
                  onClick={onRemove}
                >
                  Remover
                </button>
              ) : null}
            </div>
            <div className='project-dialog__actions-group'>
              <button
                type='button'
                className='project-dialog__btn project-dialog__btn--ghost app-button app-button--enter'
                onClick={requestClose}
              >
                Cancelar
              </button>
              <button
                type='button'
                className='project-dialog__btn project-dialog__btn--primary app-button app-button--enter'
                onClick={handleSave}
              >
                Salvar
              </button>
            </div>
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

export const AgentWhatsAppMarkModal = memo(AgentWhatsAppMarkModalComponent);

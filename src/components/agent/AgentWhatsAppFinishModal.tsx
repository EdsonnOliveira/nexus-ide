import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { AgentWhatsAppMessagePreview } from '@/components/agent/AgentWhatsAppMessagePreview';
import { AgentWhatsAppNotifyFields } from '@/components/agent/AgentWhatsAppNotifyFields';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { ProjectIconMark } from '@/components/sidebar/ProjectIconMark';
import { SidebarWhatsAppIcon } from '@/components/sidebar/SidebarWhatsAppIcon';
import type { AgentWhatsAppFinishPayload } from '@/stores/useAgentWhatsAppNotifyStore';
import { useAgentWhatsAppNotifyStore } from '@/stores/useAgentWhatsAppNotifyStore';
import { useProjectStore } from '@/stores/useProjectStore';
import {
  buildWhatsAppSendUrl,
  openSidebarWhatsAppLink,
  parseSidebarWhatsAppLink,
} from '@/utils/sidebarWhatsAppLink';

interface AgentWhatsAppFinishModalProps {
  payload: AgentWhatsAppFinishPayload;
  onSent?: (turnId: string, message: string, link: string) => void;
}

function AgentWhatsAppFinishModalComponent({ payload, onSent }: AgentWhatsAppFinishModalProps) {
  const closeFinish = useAgentWhatsAppNotifyStore((state) => state.closeFinish);
  const project = useProjectStore((state) =>
    state.projects.find((entry) => entry.id === payload.projectId),
  );
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState(payload.message);
  const [link, setLink] = useState(payload.link);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    setMessage(payload.message);
    setLink(payload.link);
    setError(null);
  }, [payload.link, payload.message, payload.turnId]);

  useEffect(() => {
    messageInputRef.current?.focus();
  }, [payload.turnId]);

  useEffect(() => {
    let cancelled = false;

    setLogoSrc(null);
    setLogoFailed(false);

    const logoPath = project?.logo?.trim();

    if (!logoPath || !window.nexus?.files?.readImageAsDataUrl) {
      return;
    }

    void window.nexus.files.readImageAsDataUrl(logoPath).then((dataUrl) => {
      if (cancelled) {
        return;
      }

      if (dataUrl) {
        setLogoSrc(dataUrl);
        return;
      }

      setLogoFailed(true);
    });

    return () => {
      cancelled = true;
    };
  }, [project?.logo, payload.projectId]);

  const showLogo = Boolean(logoSrc) && !logoFailed;
  const projectColor = project?.color?.trim() || undefined;
  const projectIcon = project?.icon?.trim() || '📁';

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

  const handleSend = useCallback(async () => {
    const parsed = parseSidebarWhatsAppLink(link);

    if (!parsed) {
      setError('Informe um número com DDI (ex.: +55 61 99919-1442) ou um link oficial do WhatsApp.');
      return;
    }

    const sendUrl = buildWhatsAppSendUrl(parsed, message);

    if (!sendUrl) {
      setError('Não foi possível montar o link do WhatsApp.');
      return;
    }

    setSending(true);

    try {
      await openSidebarWhatsAppLink(sendUrl);
      onSent?.(payload.turnId, message.trim(), parsed);
      closeFinish();
    } catch {
      setError('Não foi possível abrir o WhatsApp.');
    } finally {
      setSending(false);
    }
  }, [closeFinish, link, message, onSent, payload.turnId]);

  return (
    <AnimatedModal
      panelClassName='project-dialog agent-whatsapp-notify-modal'
      onClose={closeFinish}
      closeDisabled={sending}
    >
      {(requestClose) => (
        <>
          <div className='agent-whatsapp-notify__header'>
            <div className='agent-whatsapp-notify__heading'>
              <span
                className={`agent-whatsapp-notify__project-mark${showLogo ? ' agent-whatsapp-notify__project-mark--logo' : ''}`}
                style={
                  !showLogo && projectColor
                    ? { backgroundColor: projectColor }
                    : undefined
                }
                aria-hidden='true'
              >
                {showLogo ? (
                  <img
                    src={logoSrc ?? undefined}
                    alt=''
                    className='agent-whatsapp-notify__project-logo'
                  />
                ) : (
                  <ProjectIconMark icon={projectIcon} size={14} />
                )}
              </span>
              <div className='agent-whatsapp-notify__intro'>
                <div className='agent-whatsapp-notify__title-row'>
                  <h2 className='project-dialog__title agent-whatsapp-notify__title'>
                    Prompt finalizado
                  </h2>
                  <span className='agent-whatsapp-notify__whatsapp-chip' aria-hidden='true'>
                    <SidebarWhatsAppIcon size={12} />
                  </span>
                </div>
                <p className='agent-whatsapp-notify__subtitle'>{payload.agentLabel}</p>
              </div>
            </div>
            <button
              type='button'
              className='project-dialog__close app-button'
              aria-label='Fechar'
              disabled={sending}
              onClick={requestClose}
            >
              <X size={16} />
            </button>
          </div>
          <div className='agent-whatsapp-notify__prompt-card'>
            <span className='agent-whatsapp-notify__prompt-label'>Prompt</span>
            <p className='agent-whatsapp-notify__prompt-text'>{payload.promptPreview}</p>
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
          <div className='project-dialog__actions'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--ghost app-button app-button--enter'
              disabled={sending}
              onClick={requestClose}
            >
              Depois
            </button>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--primary app-button app-button--enter'
              disabled={sending}
              onClick={() => void handleSend()}
            >
              Enviar mensagem
            </button>
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

export const AgentWhatsAppFinishModal = memo(AgentWhatsAppFinishModalComponent);

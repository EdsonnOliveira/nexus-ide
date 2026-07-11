import { memo, useCallback, useMemo } from 'react';
import { Mail } from 'lucide-react';
import { EmptyState } from '@/components/overlay/EmptyState';
import { useAppleMailInbox } from '@/hooks/useAppleMailInbox';
import type { MailMailboxRef } from '@/types';
import { formatMailDate } from '@/utils/mailLabels';

interface SidebarMailPanelProps {
  mailbox: MailMailboxRef;
}

function MailListSkeleton() {
  return (
    <div className='sidebar-mail-panel__skeleton' aria-hidden='true'>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className='sidebar-mail-panel__skeleton-row' />
      ))}
    </div>
  );
}

function SidebarMailPanelComponent({ mailbox }: SidebarMailPanelProps) {
  const { snapshot, loading, hydrated, openMessage } = useAppleMailInbox(true, mailbox);

  const unreadCount = useMemo(
    () => snapshot.messages.filter((message) => message.unread).length,
    [snapshot.messages],
  );

  const statusMessage = useMemo(() => {
    if (!snapshot.platformSupported) {
      return 'Disponível apenas no macOS';
    }

    if (!snapshot.accessGranted) {
      return 'Permita acesso total ao disco';
    }

    if (!snapshot.mailReady) {
      return 'Não foi possível ler a caixa';
    }

    if (!snapshot.available) {
      return 'Não foi possível carregar a caixa';
    }

    return snapshot.mailboxLabel;
  }, [
    snapshot.accessGranted,
    snapshot.available,
    snapshot.mailReady,
    snapshot.mailboxLabel,
    snapshot.platformSupported,
  ]);

  const handleOpenMessage = useCallback(
    (messageId: string) => {
      void openMessage(messageId);
    },
    [openMessage],
  );

  const showSkeleton = !hydrated || (loading && snapshot.messages.length === 0);
  const showEmpty = hydrated && !loading && snapshot.available && snapshot.messages.length === 0;
  const showList = hydrated && snapshot.messages.length > 0;

  return (
    <section className='sidebar-mail-panel app-button--enter'>
      <div className='sidebar-mail-panel__header'>
        <span className='sidebar-mail-panel__badge' aria-hidden='true'>
          <Mail size={14} />
        </span>
        <div className='sidebar-mail-panel__meta'>
          <span className='sidebar-mail-panel__eyebrow'>Conta de e-mail</span>
          <span className='sidebar-mail-panel__title' title={statusMessage}>
            {statusMessage}
          </span>
          {unreadCount > 0 ? (
            <span className='sidebar-mail-panel__unread'>{unreadCount} não lidos</span>
          ) : null}
        </div>
      </div>

      <div className='sidebar-mail-panel__list-wrap app-button--enter'>
        {showSkeleton ? (
          <MailListSkeleton />
        ) : !snapshot.accessGranted ? (
          <EmptyState
            icon={Mail}
            message='Permita acesso total ao disco para ler e-mails com o Mail fechado'
            compact
          >
            <button
              type='button'
              className='sidebar-mail-panel__permission app-button app-button--enter'
              onClick={() => void window.nexus.systemNotifications.openFullDiskAccessSettings()}
            >
              Permitir acesso aos e-mails
            </button>
          </EmptyState>
        ) : showEmpty ? (
          <EmptyState icon={Mail} message='Nenhum e-mail nesta caixa' compact />
        ) : showList ? (
          <ul className='sidebar-mail-panel__list'>
            {snapshot.messages.map((message) => (
              <li key={message.id}>
                <button
                  type='button'
                  className={`sidebar-mail-panel__item app-button app-button--enter${message.unread ? ' sidebar-mail-panel__item--unread' : ''}`}
                  title={`${message.subject} — ${message.sender}`}
                  aria-label={`Abrir e-mail ${message.subject}`}
                  onClick={() => {
                    handleOpenMessage(message.id);
                  }}
                >
                  <span className='sidebar-mail-panel__subject'>{message.subject}</span>
                  <span className='sidebar-mail-panel__sender'>{message.sender}</span>
                  <span className='sidebar-mail-panel__date'>{formatMailDate(message.dateReceived)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Mail} message='Não foi possível carregar os e-mails' compact />
        )}
      </div>
    </section>
  );
}

export const SidebarMailPanel = memo(SidebarMailPanelComponent);

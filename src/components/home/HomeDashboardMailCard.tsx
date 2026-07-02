import { Mail } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import { EmptyState } from '@/components/overlay/EmptyState';
import { HomeDashboardSection } from '@/components/home/HomeDashboardSection';
import {
  HomeDashboardMailSkeleton,
  HomeDashboardSelectSkeleton,
} from '@/components/home/HomeDashboardSkeletons';
import { useHomeDashboardMail } from '@/hooks/useHomeDashboardMail';
import type { HomeDashboardMailMessage } from '@/hooks/useHomeDashboardMailInbox';
import { useHomeDashboardMailInbox } from '@/hooks/useHomeDashboardMailInbox';
import { formatMailDate } from '@/utils/mailLabels';

function HomeDashboardMailCardComponent() {
  const {
    mailboxOptions,
    selectedMailbox,
    selectedMailboxId,
    selectOptions,
    loadingMailboxes,
    selectMailboxById,
    resolveMailboxLabel,
    resolveMailboxAccent,
  } = useHomeDashboardMail();
  const { snapshot, messages, loading, hydrated, openMessage } = useHomeDashboardMailInbox(
    true,
    mailboxOptions,
    selectedMailbox,
  );

  const unreadCount = useMemo(
    () => messages.filter((message) => message.unread).length,
    [messages],
  );

  const mailboxSelect = useMemo(() => {
    if (loadingMailboxes) {
      return <HomeDashboardSelectSkeleton />;
    }

    return (
      <AnchoredSelect
        value={selectedMailboxId}
        options={selectOptions}
        allowEmpty
        emptyLabel='Todas as caixas'
        disabled={selectOptions.length === 0}
        onChange={selectMailboxById}
        triggerClassName='home-dashboard__mail-select'
      />
    );
  }, [loadingMailboxes, selectMailboxById, selectOptions, selectedMailboxId]);

  const handleOpenMessage = useCallback(
    (message: HomeDashboardMailMessage) => {
      void openMessage(message);
    },
    [openMessage],
  );

  const showSkeleton =
    loadingMailboxes || !hydrated || (loading && messages.length === 0);
  const showEmpty =
    hydrated && !loadingMailboxes && !loading && snapshot.available && messages.length === 0;
  const showList = hydrated && messages.length > 0;

  return (
    <HomeDashboardSection
      icon={Mail}
      title='E-mail'
      accent='#38bdf8'
      className='home-dashboard__mail-section'
      enterDelayMs={200}
      headerAction={mailboxSelect}
      headerMeta={
        unreadCount > 0 ? (
          <span className='home-dashboard__mail-unread'>{unreadCount} não lidos</span>
        ) : null
      }
    >
      {!snapshot.platformSupported ? (
        <EmptyState icon={Mail} message='E-mail disponível apenas no macOS' compact />
      ) : loadingMailboxes ? (
        <HomeDashboardMailSkeleton />
      ) : selectOptions.length === 0 ? (
        <EmptyState icon={Mail} message='Mail indisponível ou sem contas' compact />
      ) : !snapshot.mailReady ? (
        <EmptyState icon={Mail} message='Mail indisponível' compact />
      ) : showSkeleton ? (
        <HomeDashboardMailSkeleton />
      ) : showEmpty ? (
        <EmptyState
          icon={Mail}
          message={selectedMailbox ? 'Nenhum e-mail nesta caixa' : 'Nenhum e-mail recente'}
          compact
        />
      ) : showList ? (
        <ul className='home-dashboard__mail-list'>
          {messages.map((message, index) => (
            <li key={`${message.mailbox.accountName}-${message.id}`}>
              <button
                type='button'
                className={`home-dashboard__mail-row app-button app-button--enter${message.unread ? ' home-dashboard__mail-row--unread' : ''}`}
                style={{ animationDelay: `${180 + index * 35}ms` }}
                title={`${message.subject} — ${message.sender}`}
                aria-label={`Abrir e-mail ${message.subject}`}
                onClick={() => handleOpenMessage(message)}
              >
                <span className='home-dashboard__mail-copy'>
                  <span className='home-dashboard__mail-subject'>{message.subject}</span>
                  <span className='home-dashboard__mail-meta'>
                    {!selectedMailbox ? (
                      <span
                        className='home-dashboard__mail-chip'
                        style={{
                          ['--mailbox-accent' as string]: resolveMailboxAccent(message.mailbox),
                        }}
                      >
                        {resolveMailboxLabel(message.mailbox)}
                      </span>
                    ) : null}
                    <span className='home-dashboard__mail-sender'>{message.sender}</span>
                    <span className='home-dashboard__mail-date'>
                      {formatMailDate(message.dateReceived)}
                    </span>
                  </span>
                </span>
                {message.unread ? (
                  <span className='home-dashboard__mail-dot' aria-hidden='true' />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Mail} message='Não foi possível carregar os e-mails' compact />
      )}
    </HomeDashboardSection>
  );
}

export const HomeDashboardMailCard = memo(HomeDashboardMailCardComponent);

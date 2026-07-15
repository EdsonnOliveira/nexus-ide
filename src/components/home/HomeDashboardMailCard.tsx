import { Mail } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
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

const MAIL_FILTER_STORAGE_KEY = 'nexus.home-dashboard.mail-filter';

function readStoredMailUnreadOnly(): boolean {
  try {
    return localStorage.getItem(MAIL_FILTER_STORAGE_KEY) === 'unread';
  } catch {
    return false;
  }
}

function writeStoredMailUnreadOnly(unreadOnly: boolean): void {
  try {
    localStorage.setItem(MAIL_FILTER_STORAGE_KEY, unreadOnly ? 'unread' : 'all');
  } catch {
    return;
  }
}

function HomeDashboardMailCardComponent() {
  const {
    mailboxOptions,
    accessGranted,
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
  const [unreadOnly, setUnreadOnly] = useState(readStoredMailUnreadOnly);

  const unreadCount = useMemo(
    () => messages.filter((message) => message.unread).length,
    [messages],
  );

  const filteredMessages = useMemo(
    () => (unreadOnly ? messages.filter((message) => message.unread) : messages),
    [messages, unreadOnly],
  );

  const handleUnreadOnlyChange = useCallback((nextUnreadOnly: boolean) => {
    setUnreadOnly(nextUnreadOnly);
    writeStoredMailUnreadOnly(nextUnreadOnly);
  }, []);

  const headerActions = useMemo(() => {
    if (loadingMailboxes) {
      return <HomeDashboardSelectSkeleton />;
    }

    return (
      <div className='home-dashboard__mail-header-actions'>
        <div className='home-dashboard__mail-filter' role='group' aria-label='Filtrar e-mails'>
          <button
            type='button'
            className={`home-dashboard__mail-filter-btn app-button app-button--enter${unreadOnly ? ' home-dashboard__mail-filter-btn--active' : ''}`}
            aria-pressed={unreadOnly}
            onClick={() => handleUnreadOnlyChange(true)}
          >
            Não lidas
          </button>
          <button
            type='button'
            className={`home-dashboard__mail-filter-btn app-button app-button--enter${!unreadOnly ? ' home-dashboard__mail-filter-btn--active' : ''}`}
            aria-pressed={!unreadOnly}
            onClick={() => handleUnreadOnlyChange(false)}
          >
            Todas
          </button>
        </div>
        <AnchoredSelect
          value={selectedMailboxId}
          options={selectOptions}
          allowEmpty
          emptyLabel='Todas as caixas'
          disabled={selectOptions.length === 0}
          onChange={selectMailboxById}
          triggerClassName='home-dashboard__mail-select'
        />
      </div>
    );
  }, [
    handleUnreadOnlyChange,
    loadingMailboxes,
    selectMailboxById,
    selectOptions,
    selectedMailboxId,
    unreadOnly,
  ]);

  const handleOpenMessage = useCallback(
    (message: HomeDashboardMailMessage) => {
      void openMessage(message);
    },
    [openMessage],
  );

  const showSkeleton =
    loadingMailboxes || !hydrated || (loading && messages.length === 0);
  const showEmpty =
    hydrated &&
    !loadingMailboxes &&
    !loading &&
    snapshot.available &&
    filteredMessages.length === 0;
  const showUnreadFilterEmpty = showEmpty && unreadOnly && messages.length > 0;
  const showList = hydrated && filteredMessages.length > 0;

  return (
    <HomeDashboardSection
      icon={Mail}
      title='E-mail'
      accent='#94a3b8'
      className='home-dashboard__mail-section'
      enterDelayMs={220}
      headerAction={headerActions}
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
      ) : !accessGranted ? (
        <EmptyState
          icon={Mail}
          message='Permita Acesso total ao disco para ler e-mails com o Mail fechado'
          compact
        >
          <button
            type='button'
            className='home-dashboard__permission-hint app-button app-button--enter'
            onClick={() => void window.nexus.systemNotifications.openFullDiskAccessSettings()}
          >
            Permitir acesso aos e-mails
          </button>
        </EmptyState>
      ) : selectOptions.length === 0 ? (
        <EmptyState icon={Mail} message='Nenhuma conta do Mail encontrada' compact />
      ) : !snapshot.mailReady ? (
        <EmptyState icon={Mail} message='Não foi possível ler a caixa de e-mail' compact />
      ) : showSkeleton ? (
        <HomeDashboardMailSkeleton />
      ) : showEmpty ? (
        <EmptyState
          icon={Mail}
          message={
            showUnreadFilterEmpty
              ? 'Nenhum e-mail não lido nos recentes'
              : unreadOnly
                ? selectedMailbox
                  ? 'Nenhum e-mail não lido nesta caixa'
                  : 'Nenhum e-mail não lido'
                : selectedMailbox
                  ? 'Nenhum e-mail nesta caixa'
                  : 'Nenhum e-mail recente'
          }
          compact
        >
          {showUnreadFilterEmpty ? (
            <button
              type='button'
              className='home-dashboard__permission-hint app-button app-button--enter'
              onClick={() => handleUnreadOnlyChange(false)}
            >
              Ver todos os e-mails
            </button>
          ) : null}
        </EmptyState>
      ) : showList ? (
        <ul className='home-dashboard__mail-list'>
          {filteredMessages.map((message, index) => (
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

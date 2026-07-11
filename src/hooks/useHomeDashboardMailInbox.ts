import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MailInboxSnapshot, MailMailboxOption, MailMailboxRef, MailMessageItem } from '@/types';

const POLL_INTERVAL_MS = 30_000;
export const HOME_DASHBOARD_MAIL_LIMIT = 12;

const EMPTY_SNAPSHOT: MailInboxSnapshot = {
  platformSupported: true,
  mailReady: false,
  accessGranted: false,
  available: false,
  mailboxLabel: '',
  messages: [],
};

export interface HomeDashboardMailMessage extends MailMessageItem {
  mailbox: MailMailboxRef;
}

function mailboxFromOption(option: MailMailboxOption): MailMailboxRef {
  return {
    accountName: option.accountName,
    mailboxName: option.mailboxName,
  };
}

function attachMailboxToMessages(
  messages: MailMessageItem[],
  mailbox: MailMailboxRef,
): HomeDashboardMailMessage[] {
  return messages.map((message) => ({
    ...message,
    mailbox,
  }));
}

async function fetchMailboxSnapshot(
  mailbox: MailMailboxRef,
): Promise<MailInboxSnapshot> {
  return window.nexus.mail.getInboxMessages(mailbox);
}

async function fetchAggregatedMailboxSnapshot(
  mailboxOptions: MailMailboxOption[],
): Promise<MailInboxSnapshot> {
  if (mailboxOptions.length === 0) {
    return EMPTY_SNAPSHOT;
  }

  const results = await Promise.all(
    mailboxOptions.map(async (option) => {
      const mailbox = mailboxFromOption(option);
      const snapshot = await fetchMailboxSnapshot(mailbox);
      return { mailbox, snapshot };
    }),
  );

  const platformSupported = results.some((entry) => entry.snapshot.platformSupported);
  const mailReady = results.some((entry) => entry.snapshot.mailReady);
  const accessGranted = results.some((entry) => entry.snapshot.accessGranted);
  const available = results.some((entry) => entry.snapshot.available);

  const messages = results
    .flatMap(({ mailbox, snapshot }) =>
      snapshot.available ? attachMailboxToMessages(snapshot.messages, mailbox) : [],
    )
    .sort((left, right) => right.dateReceived - left.dateReceived)
    .slice(0, HOME_DASHBOARD_MAIL_LIMIT);

  return {
    platformSupported,
    mailReady,
    accessGranted,
    available,
    mailboxLabel: 'Todas as caixas',
    messages,
  };
}

export function useHomeDashboardMailInbox(
  enabled: boolean,
  mailboxOptions: MailMailboxOption[],
  selectedMailbox: MailMailboxRef | null,
) {
  const [snapshot, setSnapshot] = useState<MailInboxSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const requestIdRef = useRef(0);

  const mailboxOptionsKey = useMemo(
    () => mailboxOptions.map((option) => option.id).sort().join('|'),
    [mailboxOptions],
  );

  const selectedMailboxKey = selectedMailbox
    ? `${selectedMailbox.accountName}\u001d${selectedMailbox.mailboxName}`
    : 'all';

  const refresh = useCallback(async (background = false) => {
    if (!enabled || !window.nexus?.mail || mailboxOptions.length === 0) {
      setHydrated(true);
      setSnapshot(EMPTY_SNAPSHOT);
      return EMPTY_SNAPSHOT;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!background) {
      setLoading(true);
    }

    try {
      const nextSnapshot = selectedMailbox
        ? await (async () => {
            const singleSnapshot = await fetchMailboxSnapshot(selectedMailbox);

            return {
              ...singleSnapshot,
              messages: attachMailboxToMessages(singleSnapshot.messages, selectedMailbox),
            };
          })()
        : await fetchAggregatedMailboxSnapshot(mailboxOptions);

      if (requestIdRef.current === requestId) {
        setSnapshot(nextSnapshot);
      }

      return nextSnapshot;
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
        setHydrated(true);
      }
    }
  }, [enabled, mailboxOptions, selectedMailbox]);

  useEffect(() => {
    if (!enabled || mailboxOptions.length === 0) {
      setHydrated(false);
      setSnapshot(EMPTY_SNAPSHOT);
      return;
    }

    setHydrated(false);
    void refresh(false);

    const intervalId = window.setInterval(() => {
      void refresh(true);
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, mailboxOptions.length, mailboxOptionsKey, refresh, selectedMailboxKey]);

  const openMessage = useCallback(async (message: HomeDashboardMailMessage) => {
    if (!window.nexus?.mail) {
      return;
    }

    await window.nexus.mail.openMessage(message.mailbox, message.id);
  }, []);

  const messages = snapshot.messages as HomeDashboardMailMessage[];

  return {
    snapshot,
    messages,
    loading,
    hydrated,
    refresh,
    openMessage,
  };
}

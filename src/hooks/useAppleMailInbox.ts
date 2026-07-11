import { useCallback, useEffect, useRef, useState } from 'react';
import type { MailInboxSnapshot, MailMailboxRef } from '@/types';

const POLL_INTERVAL_MS = 30_000;

const EMPTY_SNAPSHOT: MailInboxSnapshot = {
  platformSupported: true,
  mailReady: false,
  accessGranted: false,
  available: false,
  mailboxLabel: '',
  messages: [],
};

export function useAppleMailInbox(enabled: boolean, mailbox: MailMailboxRef | null) {
  const [snapshot, setSnapshot] = useState<MailInboxSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled || !mailbox || !window.nexus?.mail) {
      setHydrated(true);
      setSnapshot(EMPTY_SNAPSHOT);
      return EMPTY_SNAPSHOT;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);

    try {
      const nextSnapshot = await window.nexus.mail.getInboxMessages(mailbox);

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
  }, [enabled, mailbox]);

  useEffect(() => {
    if (!enabled || !mailbox) {
      setHydrated(false);
      setSnapshot(EMPTY_SNAPSHOT);
      return;
    }

    setHydrated(false);
    void refresh();

    const intervalId = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, mailbox, refresh]);

  const openMessage = useCallback(
    async (messageId: string) => {
      if (!mailbox || !window.nexus?.mail) {
        return;
      }

      await window.nexus.mail.openMessage(mailbox, messageId);
    },
    [mailbox],
  );

  return {
    snapshot,
    loading,
    hydrated,
    refresh,
    openMessage,
  };
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MailMailboxOption, MailMailboxRef } from '@/types';
import { encodeMailboxKey, resolveMailboxAccentFromKey } from '@/utils/mailLabels';

const STORAGE_KEY = 'nexus.home-dashboard.mailbox';

function readStoredMailbox(): MailMailboxRef | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as MailMailboxRef;

    if (!parsed?.accountName?.trim()) {
      return null;
    }

    return {
      accountName: parsed.accountName.trim(),
      mailboxName: parsed.mailboxName?.trim() || 'INBOX',
    };
  } catch {
    return null;
  }
}

function writeStoredMailbox(mailbox: MailMailboxRef): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      accountName: mailbox.accountName,
      mailboxName: mailbox.mailboxName,
    }),
  );
}

function clearStoredMailbox(): void {
  localStorage.removeItem(STORAGE_KEY);
}

function mailboxFromOption(option: MailMailboxOption): MailMailboxRef {
  return {
    accountName: option.accountName,
    mailboxName: option.mailboxName,
  };
}

function mailboxMatchesOption(mailbox: MailMailboxRef, option: MailMailboxOption): boolean {
  return (
    mailbox.accountName === option.accountName && mailbox.mailboxName === option.mailboxName
  );
}

export function useHomeDashboardMail() {
  const [mailboxOptions, setMailboxOptions] = useState<MailMailboxOption[]>([]);
  const [selectedMailbox, setSelectedMailbox] = useState<MailMailboxRef | null>(null);
  const [loadingMailboxes, setLoadingMailboxes] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadMailboxes = async () => {
      if (!window.nexus?.mail) {
        if (!cancelled) {
          setMailboxOptions([]);
          setLoadingMailboxes(false);
        }
        return;
      }

      try {
        const options = await window.nexus.mail.getMailboxes();

        if (cancelled) {
          return;
        }

        setMailboxOptions(options);

        const storedMailbox = readStoredMailbox();
        const storedOption = storedMailbox
          ? options.find((option) => mailboxMatchesOption(storedMailbox, option))
          : null;

        setSelectedMailbox(storedOption ? mailboxFromOption(storedOption) : null);
      } finally {
        if (!cancelled) {
          setLoadingMailboxes(false);
        }
      }
    };

    void loadMailboxes();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectOptions = useMemo(
    () => mailboxOptions.map((option) => ({ value: option.id, label: option.label })),
    [mailboxOptions],
  );

  const selectedMailboxId = useMemo(() => {
    if (!selectedMailbox) {
      return '';
    }

    const match = mailboxOptions.find((option) =>
      mailboxMatchesOption(selectedMailbox, option),
    );

    return match?.id ?? '';
  }, [mailboxOptions, selectedMailbox]);

  const selectMailboxById = useCallback(
    (mailboxId: string) => {
      if (!mailboxId) {
        setSelectedMailbox(null);
        clearStoredMailbox();
        return;
      }

      const option = mailboxOptions.find((item) => item.id === mailboxId);

      if (!option) {
        return;
      }

      const nextMailbox = mailboxFromOption(option);
      setSelectedMailbox(nextMailbox);
      writeStoredMailbox(nextMailbox);
    },
    [mailboxOptions],
  );

  const mailboxAccentKeys = useMemo(
    () => mailboxOptions.map((option) => option.id),
    [mailboxOptions],
  );

  const resolveMailboxLabel = useCallback(
    (mailbox: MailMailboxRef) => {
      const match = mailboxOptions.find((option) => mailboxMatchesOption(mailbox, option));
      return match?.label ?? mailbox.accountName;
    },
    [mailboxOptions],
  );

  const resolveMailboxAccent = useCallback(
    (mailbox: MailMailboxRef) => {
      const match = mailboxOptions.find((option) => mailboxMatchesOption(mailbox, option));
      const key = match?.id ?? encodeMailboxKey(mailbox);
      return resolveMailboxAccentFromKey(key, mailboxAccentKeys);
    },
    [mailboxAccentKeys, mailboxOptions],
  );

  return {
    mailboxOptions,
    selectedMailbox,
    selectedMailboxId,
    selectOptions,
    loadingMailboxes,
    selectMailboxById,
    resolveMailboxLabel,
    resolveMailboxAccent,
  };
}

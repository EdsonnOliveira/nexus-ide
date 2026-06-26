import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { MailInboxSnapshot, MailMailboxOption, MailMailboxRef, MailMessageItem } from '../../types';

const execFileAsync = promisify(execFile);

const DELIMITER = '\u001f';
const ENTRY_DELIMITER = '\u001e';
const MAILBOX_ID_DELIMITER = '\u001d';
const MAX_MESSAGES = 80;
const MAIL_READY_POLL_MS = 200;
const MAIL_READY_MAX_ATTEMPTS = 15;
const EPOCH_REFERENCE = 'Thursday, 1 January 1970 00:00:00';

async function runAppleScript(script: string): Promise<string> {
  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script]);
  return stdout.trim();
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function encodeMailboxId(accountName: string, mailboxName: string): string {
  return `${accountName}${MAILBOX_ID_DELIMITER}${mailboxName}`;
}

function decodeMailboxId(id: string): { accountName: string; mailboxName: string } | null {
  const separatorIndex = id.indexOf(MAILBOX_ID_DELIMITER);

  if (separatorIndex <= 0) {
    return null;
  }

  return {
    accountName: id.slice(0, separatorIndex),
    mailboxName: id.slice(separatorIndex + 1),
  };
}

function parseNumber(value: string | undefined): number {
  if (!value?.trim()) {
    return 0;
  }

  const normalized = value.trim().replace(',', '.');
  const parsed = Number.parseFloat(normalized);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function parseBoolean(value: string | undefined): boolean {
  return value?.toLowerCase() === 'true';
}

function emptyInboxSnapshot(platformSupported: boolean, mailReady = false): MailInboxSnapshot {
  return {
    platformSupported,
    mailReady,
    available: false,
    mailboxLabel: '',
    messages: [],
  };
}

async function ensureMailAppReady(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false;
  }

  try {
    const runningCheck = await runAppleScript(`
tell application "System Events"
  return (name of processes) contains "Mail" as string
end tell
`);

    if (runningCheck === 'true') {
      return true;
    }

    await execFileAsync('/usr/bin/open', ['-gj', '-a', 'Mail']);

    for (let attempt = 0; attempt < MAIL_READY_MAX_ATTEMPTS; attempt += 1) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, MAIL_READY_POLL_MS);
      });

      const check = await runAppleScript(`
tell application "System Events"
  return (name of processes) contains "Mail" as string
end tell
`);

      if (check === 'true') {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

function normalizeMailboxPath(mailboxPath: string): string {
  return mailboxPath.trim() || 'INBOX';
}

function buildResolveMailboxScript(accountName: string, mailboxPath: string): string {
  const escapedAccount = escapeAppleScriptString(accountName);
  const normalizedPath = normalizeMailboxPath(mailboxPath);
  const segments = normalizedPath.split('/').filter(Boolean);

  if (segments.length === 1 && segments[0] === 'INBOX') {
    return `set targetContainer to mailbox "INBOX" of account "${escapedAccount}"\n`;
  }

  let resolveScript = `set targetContainer to account "${escapedAccount}"\n`;

  for (const segment of segments) {
    const escapedSegment = escapeAppleScriptString(segment);
    resolveScript += `set targetContainer to mailbox "${escapedSegment}" of targetContainer\n`;
  }

  return resolveScript;
}

function buildAccountLabel(accountName: string, emailAddress: string): string {
  if (!emailAddress.trim() || emailAddress.trim() === accountName.trim()) {
    return accountName.trim();
  }

  return `${accountName.trim()} (${emailAddress.trim()})`;
}

export async function getMailMailboxes(): Promise<MailMailboxOption[]> {
  if (process.platform !== 'darwin') {
    return [];
  }

  const mailReady = await ensureMailAppReady();

  if (!mailReady) {
    return [];
  }

  try {
    const raw = await runAppleScript(`
tell application "Mail"
  set outputList to {}
  repeat with mailAccount in accounts
    set accountName to name of mailAccount
    set accountEmail to ""
    try
      set accountEmails to email addresses of mailAccount
      if (count of accountEmails) > 0 then
        set accountEmail to item 1 of accountEmails
      end if
    end try
    set end of outputList to accountName & "${DELIMITER}" & accountEmail
  end repeat
end tell

set AppleScript's text item delimiters to "${ENTRY_DELIMITER}"
set outputText to outputList as string
set AppleScript's text item delimiters to ""
return outputText
`);

    if (!raw) {
      return [];
    }

    const options: MailMailboxOption[] = [];

    for (const entry of raw.split(ENTRY_DELIMITER)) {
      if (!entry.trim()) {
        continue;
      }

      const separatorIndex = entry.indexOf(DELIMITER);

      if (separatorIndex <= 0) {
        continue;
      }

      const accountName = entry.slice(0, separatorIndex).trim();
      const accountEmail = entry.slice(separatorIndex + 1).trim();

      if (!accountName) {
        continue;
      }

      options.push({
        id: encodeMailboxId(accountName, 'INBOX'),
        accountName,
        mailboxName: 'INBOX',
        label: buildAccountLabel(accountName, accountEmail),
      });
    }

    return options.sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'));
  } catch {
    return [];
  }
}

export async function getMailInboxMessages(mailbox: MailMailboxRef): Promise<MailInboxSnapshot> {
  const platformSupported = process.platform === 'darwin';

  if (!platformSupported) {
    return emptyInboxSnapshot(false);
  }

  const mailReady = await ensureMailAppReady();

  if (!mailReady) {
    return emptyInboxSnapshot(true, false);
  }

  try {
    const resolveScript = buildResolveMailboxScript(mailbox.accountName, mailbox.mailboxName);
    const raw = await runAppleScript(`
set refDate to date "${EPOCH_REFERENCE}"

tell application "Mail"
  ${resolveScript}
  set messageList to messages of targetContainer
  set messageCount to count of messageList
  set limitCount to ${MAX_MESSAGES}
  if messageCount < limitCount then
    set limitCount to messageCount
  end if
  set outputText to ""
  repeat with i from 1 to limitCount
    set msg to item i of messageList
    set msgId to id of msg as string
    set msgSubject to subject of msg
    set msgSender to sender of msg as string
    set msgDate to (date received of msg) - refDate
    set msgUnread to (read status of msg is false) as string
    set outputText to outputText & msgId & "${DELIMITER}" & msgSubject & "${DELIMITER}" & msgSender & "${DELIMITER}" & (msgDate as string) & "${DELIMITER}" & msgUnread & "${ENTRY_DELIMITER}"
  end repeat
  return outputText
end tell
`);

    const messages: MailMessageItem[] = [];

    for (const entry of raw.split(ENTRY_DELIMITER)) {
      if (!entry.trim()) {
        continue;
      }

      const parts = entry.split(DELIMITER);

      if (parts.length < 5) {
        continue;
      }

      const [id, subject, sender, dateRaw, unreadRaw] = parts;
      const dateSeconds = parseNumber(dateRaw);

      messages.push({
        id: id.trim(),
        subject: subject.trim() || '(Sem assunto)',
        sender: sender.trim() || 'Desconhecido',
        dateReceived: Math.round(dateSeconds * 1000),
        unread: parseBoolean(unreadRaw),
      });
    }

    return {
      platformSupported: true,
      mailReady: true,
      available: true,
      mailboxLabel: mailbox.accountName,
      messages,
    };
  } catch {
    return emptyInboxSnapshot(true, true);
  }
}

export async function openMailMessage(mailbox: MailMailboxRef, messageId: string): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }

  const mailReady = await ensureMailAppReady();

  if (!mailReady) {
    throw new Error('Mail app unavailable');
  }

  const parsedId = Number.parseInt(messageId, 10);

  if (!Number.isFinite(parsedId)) {
    throw new Error('Invalid message id');
  }

  const resolveScript = buildResolveMailboxScript(mailbox.accountName, mailbox.mailboxName);

  await runAppleScript(`
tell application "Mail"
  ${resolveScript}
  set targetMessage to first message of targetContainer whose id is ${parsedId}
  open targetMessage
  activate
end tell
`);
}

export function parseMailMailboxOptionId(id: string): MailMailboxRef | null {
  return decodeMailboxId(id);
}

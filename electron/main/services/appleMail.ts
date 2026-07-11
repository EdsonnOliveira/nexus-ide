import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { app } from 'electron';
import type {
  MailInboxSnapshot,
  MailMailboxOption,
  MailMailboxRef,
  MailMailboxesSnapshot,
  MailMessageItem,
} from '../../types';

const execFileAsync = promisify(execFile);

const MAILBOX_ID_DELIMITER = '\u001d';
const MAX_MESSAGES = 80;

interface HelperMailboxesSnapshot {
  accessGranted: boolean;
  options: MailMailboxOption[];
}

interface HelperInboxSnapshot {
  accessGranted: boolean;
  available: boolean;
  mailboxLabel: string;
  messages: MailMessageItem[];
}

interface MailAccountInfo {
  uuid: string;
  accountName: string;
  emailAddress: string;
}

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

function emptyMailboxesSnapshot(
  platformSupported: boolean,
  accessGranted = false,
): MailMailboxesSnapshot {
  return {
    platformSupported,
    accessGranted,
    options: [],
  };
}

function emptyInboxSnapshot(
  platformSupported: boolean,
  mailReady = false,
  accessGranted = false,
): MailInboxSnapshot {
  return {
    platformSupported,
    mailReady,
    accessGranted,
    available: false,
    mailboxLabel: '',
    messages: [],
  };
}

function buildAccountLabel(accountName: string, emailAddress: string): string {
  if (!emailAddress.trim() || emailAddress.trim() === accountName.trim()) {
    return accountName.trim();
  }

  return `${accountName.trim()} (${emailAddress.trim()})`;
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

function resolveNotificationHelperAppPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'resources/shell/NotificationHelper.app'),
    path.join(app.getAppPath(), 'Contents/Helpers/NotificationHelper.app'),
    path.join(process.resourcesPath, '../Helpers/NotificationHelper.app'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveMailHelperBinary(): string | null {
  const helperAppPath = resolveNotificationHelperAppPath();
  const helperBinary = helperAppPath
    ? path.join(helperAppPath, 'Contents/MacOS/NotificationHelper')
    : null;

  const candidates = [
    helperBinary,
    path.join(process.cwd(), 'resources/shell/macosNotificationReader'),
    path.join(process.resourcesPath, 'macosNotificationReader'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function waitForOutputFile(outputPath: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(outputPath)) {
      try {
        const content = await fs.readFile(outputPath, 'utf8');

        if (content.trim()) {
          return;
        }
      } catch {
      }
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  throw new Error('Mail helper output timeout');
}

async function runMailHelper(action: 'mail-mailboxes' | 'mail-inbox', ...params: string[]): Promise<string | null> {
  const outputPath = path.join(
    os.tmpdir(),
    `nexus-mail-out-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  const binaryPath = resolveMailHelperBinary();
  const helperAppPath = resolveNotificationHelperAppPath();

  try {
    if (binaryPath) {
      await execFileAsync(binaryPath, [outputPath, action, ...params], {
        timeout: 20_000,
        maxBuffer: 4 * 1024 * 1024,
      });
    } else if (helperAppPath) {
      await execFileAsync(
        '/usr/bin/open',
        ['-g', '-a', helperAppPath, '--args', outputPath, action, ...params],
        { timeout: 5_000 },
      );
      await waitForOutputFile(outputPath, 20_000);
    } else {
      return null;
    }

    return await fs.readFile(outputPath, 'utf8');
  } catch {
    return null;
  } finally {
    await fs.rm(outputPath, { force: true }).catch(() => undefined);
  }
}

async function resolveMailVersionRoot(): Promise<string | null> {
  const mailRoot = path.join(os.homedir(), 'Library/Mail');

  try {
    const entries = await fs.readdir(mailRoot);
    const versions = entries
      .filter((entry) => /^V\d+$/.test(entry))
      .sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
    const latest = versions.at(-1);

    if (!latest) {
      return null;
    }

    return path.join(mailRoot, latest);
  } catch {
    return null;
  }
}

async function resolveEnvelopeIndexPath(): Promise<string | null> {
  const versionRoot = await resolveMailVersionRoot();

  if (!versionRoot) {
    return null;
  }

  const dbPath = path.join(versionRoot, 'MailData', 'Envelope Index');

  try {
    await fs.access(dbPath);
    return dbPath;
  } catch {
    return null;
  }
}

async function openEnvelopeIndexCopy(): Promise<{ db: DatabaseSync; cleanupDir: string } | null> {
  const dbPath = await resolveEnvelopeIndexPath();

  if (!dbPath) {
    return null;
  }

  const cleanupDir = path.join(
    os.tmpdir(),
    `nexus-mail-db-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const tempDbPath = path.join(cleanupDir, 'Envelope Index');

  try {
    await fs.mkdir(cleanupDir, { recursive: true });
    await fs.copyFile(dbPath, tempDbPath);
    await fs.copyFile(`${dbPath}-wal`, `${tempDbPath}-wal`).catch(() => undefined);
    await fs.copyFile(`${dbPath}-shm`, `${tempDbPath}-shm`).catch(() => undefined);
    const db = new DatabaseSync(`file:${tempDbPath}?mode=ro&immutable=1`, { readOnly: true });
    return { db, cleanupDir };
  } catch {
    await fs.rm(cleanupDir, { recursive: true, force: true }).catch(() => undefined);
    return null;
  }
}

function isInboxUrl(url: string): boolean {
  const normalized = url.trim();

  if (!normalized) {
    return false;
  }

  const lowered = normalized.toLowerCase();

  if (
    lowered.includes('spam') ||
    lowered.includes('junk') ||
    lowered.includes('trash') ||
    lowered.includes('draft') ||
    lowered.includes('sent') ||
    lowered.includes('deleted')
  ) {
    return false;
  }

  if (lowered.endsWith('/inbox') || lowered.endsWith('/inbox/')) {
    return true;
  }

  return path.basename(normalized).toLowerCase() === 'inbox';
}

function extractAccountUuid(url: string): string {
  const schemeIndex = url.indexOf('://');

  if (schemeIndex < 0) {
    return '';
  }

  const afterScheme = url.slice(schemeIndex + 3);
  const slashIndex = afterScheme.indexOf('/');

  if (slashIndex < 0) {
    return afterScheme;
  }

  return afterScheme.slice(0, slashIndex);
}

async function loadAccountsFromPlist(): Promise<MailAccountInfo[]> {
  const versionRoot = await resolveMailVersionRoot();

  if (!versionRoot) {
    return [];
  }

  const plistPath = path.join(versionRoot, 'MailData', 'Accounts.plist');

  try {
    const { stdout } = await execFileAsync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plistPath], {
      maxBuffer: 4 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as Record<string, unknown> | unknown[];
    const rootAccounts = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as Record<string, unknown>).MailAccounts)
        ? ((parsed as Record<string, unknown>).MailAccounts as unknown[])
        : Array.isArray((parsed as Record<string, unknown>).Accounts)
          ? ((parsed as Record<string, unknown>).Accounts as unknown[])
          : [];

    const accounts: MailAccountInfo[] = [];

    for (const entry of rootAccounts) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const account = entry as Record<string, unknown>;
      const uuidCandidates = [
        account.AccountUUID,
        account.UniqueId,
        account.AccountPath,
        account.AccountID,
      ];
      const uuid = uuidCandidates
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .find(Boolean);

      const emailRaw = account.EmailAddresses;
      const emailAddress = Array.isArray(emailRaw)
        ? emailRaw.map((value) => (typeof value === 'string' ? value.trim() : '')).find(Boolean) ||
          ''
        : typeof emailRaw === 'string'
          ? emailRaw.trim()
          : '';

      const accountNameCandidates = [account.AccountName, account.Username, emailAddress];
      const accountName = accountNameCandidates
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .find(Boolean);

      if (!uuid || !accountName) {
        continue;
      }

      accounts.push({ uuid, accountName, emailAddress });
    }

    return accounts;
  } catch {
    return [];
  }
}

function resolveAccountUuid(accountName: string, accounts: MailAccountInfo[]): string | null {
  const trimmed = accountName.trim();

  if (!trimmed) {
    return null;
  }

  const byName = accounts.find((account) => account.accountName === trimmed);

  if (byName) {
    return byName.uuid;
  }

  const byUuid = accounts.find(
    (account) => account.uuid.toLowerCase() === trimmed.toLowerCase(),
  );

  if (byUuid) {
    return byUuid.uuid;
  }

  const byEmail = accounts.find(
    (account) => account.emailAddress.toLowerCase() === trimmed.toLowerCase(),
  );

  if (byEmail) {
    return byEmail.uuid;
  }

  return trimmed;
}

async function getMailboxesFromNode(): Promise<MailMailboxesSnapshot | null> {
  const opened = await openEnvelopeIndexCopy();

  if (!opened) {
    return null;
  }

  try {
    const accounts = await loadAccountsFromPlist();
    const rows = opened.db.prepare('SELECT url FROM mailboxes WHERE url IS NOT NULL').all() as Array<{
      url: string;
    }>;
    const inboxUrls = rows
      .map((row) => row.url)
      .filter((url) => typeof url === 'string' && isInboxUrl(url))
      .map((url) => ({ uuid: extractAccountUuid(url), url }));

    const options: MailMailboxOption[] = [];
    const seen = new Set<string>();

    if (accounts.length > 0) {
      for (const account of accounts) {
        const hasInbox = inboxUrls.some(
          (entry) => entry.uuid.toLowerCase() === account.uuid.toLowerCase(),
        );

        if (!hasInbox || seen.has(account.accountName)) {
          continue;
        }

        seen.add(account.accountName);
        options.push({
          id: encodeMailboxId(account.accountName, 'INBOX'),
          accountName: account.accountName,
          mailboxName: 'INBOX',
          label: buildAccountLabel(account.accountName, account.emailAddress),
        });
      }
    }

    if (options.length === 0) {
      for (const inbox of inboxUrls) {
        if (!inbox.uuid || seen.has(inbox.uuid)) {
          continue;
        }

        seen.add(inbox.uuid);
        options.push({
          id: encodeMailboxId(inbox.uuid, 'INBOX'),
          accountName: inbox.uuid,
          mailboxName: 'INBOX',
          label: inbox.uuid,
        });
      }
    }

    return {
      platformSupported: true,
      accessGranted: true,
      options: options.sort((left, right) => left.label.localeCompare(right.label, 'pt-BR')),
    };
  } catch {
    return null;
  } finally {
    opened.db.close();
    await fs.rm(opened.cleanupDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function getInboxFromNode(mailbox: MailMailboxRef): Promise<MailInboxSnapshot | null> {
  const opened = await openEnvelopeIndexCopy();

  if (!opened) {
    return null;
  }

  try {
    const accounts = await loadAccountsFromPlist();
    const accountUuid = resolveAccountUuid(mailbox.accountName, accounts);

    if (!accountUuid) {
      return {
        platformSupported: true,
        mailReady: true,
        accessGranted: true,
        available: false,
        mailboxLabel: mailbox.accountName,
        messages: [],
      };
    }

    const accountLabel =
      accounts.find((account) => account.uuid.toLowerCase() === accountUuid.toLowerCase())
        ?.accountName ?? mailbox.accountName;
    const targetMailbox = normalizeMailboxPath(mailbox.mailboxName).toLowerCase();
    const rows = opened.db
      .prepare(
        `
        SELECT m.ROWID as id,
               COALESCE(s.subject, '') as subject,
               CASE
                 WHEN COALESCE(a.comment, '') != '' AND COALESCE(a.address, '') != ''
                   THEN a.comment || ' <' || a.address || '>'
                 WHEN COALESCE(a.comment, '') != '' THEN a.comment
                 ELSE COALESCE(a.address, '')
               END as sender,
               COALESCE(m.date_received, 0) as date_received,
               COALESCE(m.read, 1) as read_flag,
               COALESCE(mb.url, '') as mailbox_url
        FROM messages m
        JOIN mailboxes mb ON m.mailbox = mb.ROWID
        LEFT JOIN subjects s ON m.subject = s.ROWID
        LEFT JOIN addresses a ON m.sender = a.ROWID
        WHERE COALESCE(m.deleted, 0) = 0
          AND mb.url LIKE ?
        ORDER BY m.date_received DESC
        LIMIT ?
      `,
      )
      .all(`%${accountUuid}/%`, MAX_MESSAGES * 3) as Array<{
      id: number | bigint;
      subject: string;
      sender: string;
      date_received: number | bigint;
      read_flag: number | bigint;
      mailbox_url: string;
    }>;

    const messages: MailMessageItem[] = [];

    for (const row of rows) {
      const mailboxUrl = String(row.mailbox_url ?? '');
      const urlPath = path.basename(mailboxUrl).toLowerCase();
      const isTarget =
        targetMailbox === 'inbox'
          ? isInboxUrl(mailboxUrl)
          : urlPath === targetMailbox || mailboxUrl.toLowerCase().endsWith(`/${targetMailbox}`);

      if (!isTarget) {
        continue;
      }

      messages.push({
        id: String(row.id),
        subject: String(row.subject || '').trim() || '(Sem assunto)',
        sender: String(row.sender || '').trim() || 'Desconhecido',
        dateReceived: Math.round(Number(row.date_received) * 1000),
        unread: Number(row.read_flag) === 0,
      });

      if (messages.length >= MAX_MESSAGES) {
        break;
      }
    }

    return {
      platformSupported: true,
      mailReady: true,
      accessGranted: true,
      available: true,
      mailboxLabel: accountLabel,
      messages,
    };
  } catch {
    return null;
  } finally {
    opened.db.close();
    await fs.rm(opened.cleanupDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function getMailboxesFromHelper(): Promise<MailMailboxesSnapshot | null> {
  const raw = await runMailHelper('mail-mailboxes');

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as HelperMailboxesSnapshot;

    if (typeof parsed.accessGranted !== 'boolean' || !Array.isArray(parsed.options)) {
      return null;
    }

    return {
      platformSupported: true,
      accessGranted: parsed.accessGranted,
      options: parsed.options
        .filter(
          (option) =>
            typeof option?.id === 'string' &&
            typeof option.accountName === 'string' &&
            typeof option.mailboxName === 'string' &&
            typeof option.label === 'string',
        )
        .map((option) => ({
          id: option.id,
          accountName: option.accountName,
          mailboxName: option.mailboxName || 'INBOX',
          label: option.label,
        })),
    };
  } catch {
    return null;
  }
}

async function getInboxFromHelper(mailbox: MailMailboxRef): Promise<MailInboxSnapshot | null> {
  const raw = await runMailHelper(
    'mail-inbox',
    mailbox.accountName,
    normalizeMailboxPath(mailbox.mailboxName),
    String(MAX_MESSAGES),
  );

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as HelperInboxSnapshot;

    if (typeof parsed.accessGranted !== 'boolean' || !Array.isArray(parsed.messages)) {
      return null;
    }

    return {
      platformSupported: true,
      mailReady: parsed.accessGranted,
      accessGranted: parsed.accessGranted,
      available: Boolean(parsed.available),
      mailboxLabel: parsed.mailboxLabel || mailbox.accountName,
      messages: parsed.messages
        .filter(
          (message) =>
            typeof message?.id === 'string' &&
            typeof message.subject === 'string' &&
            typeof message.sender === 'string' &&
            typeof message.dateReceived === 'number' &&
            typeof message.unread === 'boolean',
        )
        .map((message) => ({
          id: message.id,
          subject: message.subject || '(Sem assunto)',
          sender: message.sender || 'Desconhecido',
          dateReceived: Math.round(message.dateReceived),
          unread: message.unread,
        })),
    };
  } catch {
    return null;
  }
}

export async function getMailMailboxes(): Promise<MailMailboxesSnapshot> {
  if (process.platform !== 'darwin') {
    return emptyMailboxesSnapshot(false);
  }

  const helperSnapshot = await getMailboxesFromHelper();

  if (helperSnapshot?.accessGranted) {
    return helperSnapshot;
  }

  const nodeSnapshot = await getMailboxesFromNode();

  if (nodeSnapshot?.accessGranted) {
    return nodeSnapshot;
  }

  if (helperSnapshot) {
    return helperSnapshot;
  }

  return emptyMailboxesSnapshot(true, false);
}

export async function getMailInboxMessages(mailbox: MailMailboxRef): Promise<MailInboxSnapshot> {
  if (process.platform !== 'darwin') {
    return emptyInboxSnapshot(false);
  }

  const helperSnapshot = await getInboxFromHelper(mailbox);

  if (helperSnapshot?.accessGranted) {
    return helperSnapshot;
  }

  const nodeSnapshot = await getInboxFromNode(mailbox);

  if (nodeSnapshot?.accessGranted) {
    return nodeSnapshot;
  }

  if (helperSnapshot) {
    return helperSnapshot;
  }

  return emptyInboxSnapshot(true, false, false);
}

async function resolveMessageOpenTarget(
  rowId: number,
): Promise<{ messageIdHeader: string | null; subject: string | null } | null> {
  const opened = await openEnvelopeIndexCopy();

  if (!opened) {
    return null;
  }

  try {
    const queries = [
      `
        SELECT COALESCE(mgd.message_id_header, '') as message_id_header,
               COALESCE(s.subject, '') as subject
        FROM messages m
        LEFT JOIN message_global_data mgd ON m.global_message_id = mgd.ROWID
        LEFT JOIN subjects s ON m.subject = s.ROWID
        WHERE m.ROWID = ?
      `,
      `
        SELECT COALESCE(m.message_id, '') as message_id_header,
               COALESCE(s.subject, '') as subject
        FROM messages m
        LEFT JOIN subjects s ON m.subject = s.ROWID
        WHERE m.ROWID = ?
      `,
      `
        SELECT '' as message_id_header,
               COALESCE(s.subject, '') as subject
        FROM messages m
        LEFT JOIN subjects s ON m.subject = s.ROWID
        WHERE m.ROWID = ?
      `,
    ];

    for (const sql of queries) {
      try {
        const row = opened.db.prepare(sql).get(rowId) as
          | { message_id_header: string; subject: string }
          | undefined;

        if (!row) {
          continue;
        }

        return {
          messageIdHeader: String(row.message_id_header || '').trim() || null,
          subject: String(row.subject || '').trim() || null,
        };
      } catch {
      }
    }

    return null;
  } finally {
    opened.db.close();
    await fs.rm(opened.cleanupDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function openMailMessage(mailbox: MailMailboxRef, messageId: string): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }

  const parsedId = Number.parseInt(messageId, 10);

  if (!Number.isFinite(parsedId)) {
    throw new Error('Invalid message id');
  }

  const target = await resolveMessageOpenTarget(parsedId);

  if (target?.messageIdHeader) {
    const normalizedHeader = target.messageIdHeader.includes('<')
      ? target.messageIdHeader
      : `<${target.messageIdHeader}>`;
    await execFileAsync('/usr/bin/open', [`message:${encodeURIComponent(normalizedHeader)}`]);
    return;
  }

  if (!target?.subject) {
    throw new Error('Message not found');
  }

  const resolveScript = buildResolveMailboxScript(mailbox.accountName, mailbox.mailboxName);
  const escapedSubject = escapeAppleScriptString(target.subject);

  await runAppleScript(`
tell application "Mail"
  ${resolveScript}
  set candidates to (messages of targetContainer whose subject is "${escapedSubject}")
  if (count of candidates) > 0 then
    open item 1 of candidates
    activate
  end if
end tell
`);
}

export function parseMailMailboxOptionId(id: string): MailMailboxRef | null {
  return decodeMailboxId(id);
}

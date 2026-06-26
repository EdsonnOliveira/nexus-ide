import { ipcMain } from 'electron';
import type { MailMailboxRef } from '../../types';
import {
  getMailInboxMessages,
  getMailMailboxes,
  openMailMessage,
} from '../services/appleMail';

export function registerMailHandlers(): void {
  ipcMain.handle('mail:getMailboxes', () => getMailMailboxes());
  ipcMain.handle('mail:getInboxMessages', (_, mailbox: MailMailboxRef) =>
    getMailInboxMessages(mailbox),
  );
  ipcMain.handle('mail:openMessage', (_, mailbox: MailMailboxRef, messageId: string) =>
    openMailMessage(mailbox, messageId),
  );
}

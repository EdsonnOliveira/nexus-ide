import { ipcMain } from 'electron';
import { isWhatsAppDesktopInstalled, openWhatsAppLink } from '../services/whatsappDesktop';

export function registerWhatsAppHandlers(): void {
  ipcMain.handle('whatsapp:isDesktopInstalled', () => isWhatsAppDesktopInstalled());
  ipcMain.handle('whatsapp:openLink', (_, url: string) => openWhatsAppLink(url));
}

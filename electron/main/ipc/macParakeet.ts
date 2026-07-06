import { ipcMain } from 'electron';
import type { MacParakeetSourceType } from '../../types';
import {
  getMacParakeetTranscriptionDetail,
  getMacParakeetTranscriptionsSnapshot,
  openMacParakeetApp,
  renameMacParakeetTranscriptionTitle,
} from '../services/macParakeetTranscriptions';

export function registerMacParakeetHandlers(): void {
  ipcMain.handle(
    'macParakeet:getTranscriptions',
    (_, sourceType: MacParakeetSourceType | null, forceRefresh = false) =>
      getMacParakeetTranscriptionsSnapshot(sourceType, forceRefresh),
  );
  ipcMain.handle('macParakeet:getTranscriptionDetail', (_, id: string) =>
    getMacParakeetTranscriptionDetail(id),
  );
  ipcMain.handle('macParakeet:openApp', () => openMacParakeetApp());
  ipcMain.handle('macParakeet:renameTranscriptionTitle', (_, id: string, title: string) =>
    renameMacParakeetTranscriptionTitle(id, title),
  );
}

import { ipcMain } from 'electron';
import {
  getAppleMusicNowPlaying,
  nextAppleMusicTrack,
  previousAppleMusicTrack,
  toggleAppleMusicPlayback,
} from '../services/appleMusic';

export function registerMusicHandlers(): void {
  ipcMain.handle('music:getNowPlaying', () => getAppleMusicNowPlaying());
  ipcMain.handle('music:togglePlayback', () => toggleAppleMusicPlayback());
  ipcMain.handle('music:next', () => nextAppleMusicTrack());
  ipcMain.handle('music:previous', () => previousAppleMusicTrack());
}

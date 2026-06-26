import { ipcMain } from 'electron';
import {
  cycleAppleMusicRepeat,
  getAppleMusicNowPlaying,
  getAppleMusicPlaylists,
  nextAppleMusicTrack,
  playAppleMusicPlaylist,
  playAppleMusicQueueTrack,
  previousAppleMusicTrack,
  setAppleMusicPosition,
  toggleAppleMusicPlayback,
  toggleAppleMusicShuffle,
} from '../services/appleMusic';

export function registerMusicHandlers(): void {
  ipcMain.handle('music:getNowPlaying', () => getAppleMusicNowPlaying());
  ipcMain.handle('music:getPlaylists', () => getAppleMusicPlaylists());
  ipcMain.handle('music:togglePlayback', () => toggleAppleMusicPlayback());
  ipcMain.handle('music:next', () => nextAppleMusicTrack());
  ipcMain.handle('music:previous', () => previousAppleMusicTrack());
  ipcMain.handle('music:seek', (_, seconds: number) => setAppleMusicPosition(seconds));
  ipcMain.handle('music:cycleRepeat', () => cycleAppleMusicRepeat());
  ipcMain.handle('music:toggleShuffle', () => toggleAppleMusicShuffle());
  ipcMain.handle('music:playQueueTrack', (_, playlistIndex: number) =>
    playAppleMusicQueueTrack(playlistIndex),
  );
  ipcMain.handle('music:playPlaylist', (_, playlistId: string) =>
    playAppleMusicPlaylist(playlistId),
  );
}

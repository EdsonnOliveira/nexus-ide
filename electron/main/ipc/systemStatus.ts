import { ipcMain } from 'electron';
import { listAudioOutputDevices, setAudioOutputDevice } from '../services/audioOutput';
import {
  connectWifiNetwork,
  disconnectWifiNetwork,
  getConnectedWifiNetwork,
  getSystemStatusSnapshot,
  getWifiPopupState,
  getWifiPower,
  listWifiNetworks,
  setOutputMuted,
  setOutputVolume,
  setWifiPower,
} from '../services/systemStatus';

export function registerSystemStatusHandlers(): void {
  ipcMain.handle('systemStatus:getSnapshot', () => getSystemStatusSnapshot());
  ipcMain.handle('systemStatus:setVolume', (_, volume: number) => setOutputVolume(volume));
  ipcMain.handle('systemStatus:setMuted', (_, muted: boolean) => setOutputMuted(muted));
  ipcMain.handle('systemStatus:listAudioOutputDevices', () => listAudioOutputDevices());
  ipcMain.handle('systemStatus:setAudioOutputDevice', (_, deviceId: string) =>
    setAudioOutputDevice(deviceId),
  );
  ipcMain.handle('systemStatus:getWifiPower', () => getWifiPower());
  ipcMain.handle('systemStatus:setWifiPower', (_, enabled: boolean) => setWifiPower(enabled));
  ipcMain.handle('systemStatus:getConnectedWifiNetwork', () => getConnectedWifiNetwork());
  ipcMain.handle('systemStatus:getWifiPopupState', () => getWifiPopupState());
  ipcMain.handle('systemStatus:disconnectWifiNetwork', () => disconnectWifiNetwork());
  ipcMain.handle('systemStatus:listWifiNetworks', () => listWifiNetworks());
  ipcMain.handle('systemStatus:connectWifiNetwork', (_, ssid: string, password?: string) =>
    connectWifiNetwork(ssid, password),
  );
}

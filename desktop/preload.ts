import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pebblesDesktop', {
  sync: (req: unknown) => ipcRenderer.invoke('pebbles:sync', req),
  http: (url: string, init?: unknown) => ipcRenderer.invoke('pebbles:http', url, init),
  pairingStart: () => ipcRenderer.invoke('pebbles:pairing-start'),
  pairingStop: () => ipcRenderer.invoke('pebbles:pairing-stop'),
  devices: () => ipcRenderer.invoke('pebbles:devices'),
  revoke: (id: string) => ipcRenderer.invoke('pebbles:revoke', id),
  info: () => ipcRenderer.invoke('pebbles:info'),
  setPrefs: (p: unknown) => ipcRenderer.invoke('pebbles:set-prefs', p),
  openDataFolder: () => ipcRenderer.invoke('pebbles:open-data'),
  onRemoteChange: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on('pebbles:remote-change', fn);
    return () => ipcRenderer.removeListener('pebbles:remote-change', fn);
  },
});

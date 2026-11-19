// Pebbles for Windows: the app window plus the hub your phone syncs with.
import { app, BrowserWindow, ipcMain, Menu, nativeImage, net, protocol, shell, Tray, type MenuItemConstructorOptions } from 'electron';
import { promises as fs } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Hub } from './hub';
import type { SyncRequest } from '../src/core/sync';

process.on('unhandledRejection', (e) => console.error('Pebbles: unhandled', e));

const SCHEME = 'pebbles-app';
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } }]);

interface Prefs {
  closeToTray: boolean;
  startWithWindows: boolean;
  bounds?: { width: number; height: number; x?: number; y?: number };
}

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let hub: Hub;
let prefs: Prefs = { closeToTray: true, startWithWindows: false };
let quitting = false;
const dataDir = () => join(app.getPath('userData'), 'data');
const prefsFile = () => join(app.getPath('userData'), 'prefs.json');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.setAppUserModelId('app.pebbles.desktop');
  void app.whenReady().then(start);
}

async function loadPrefs() {
  try {
    prefs = { ...prefs, ...JSON.parse(await fs.readFile(prefsFile(), 'utf8')) };
  } catch {
    /* defaults */
  }
}

async function savePrefs() {
  await fs.writeFile(prefsFile(), JSON.stringify(prefs, null, 2), 'utf8').catch(() => {});
}

function asset(name: string) {
  return join(__dirname, 'assets', name);
}

async function start() {
  await loadPrefs();
  hub = new Hub(dataDir());
  await hub.load();
  hub.onChange = (source) => {
    if (source !== 'desktop-window') win?.webContents.send('pebbles:remote-change');
  };
  try {
    await hub.listen();
  } catch (e) {
    console.error(e);
  }

  // serve the app from the bundled files
  const root = join(app.getAppPath(), 'dist');
  protocol.handle(SCHEME, async (req) => {
    const url = new URL(req.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = normalize(join(root, rel));
    if (!file.startsWith(root + sep) && file !== root) return new Response('Not found', { status: 404 });
    try {
      await fs.access(file);
    } catch {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });

  registerIpc();
  createTray();
  createWindow();
  app.setLoginItemSettings({ openAtLogin: prefs.startWithWindows, args: ['--hidden'] });
}

function createWindow() {
  const b = prefs.bounds ?? { width: 1280, height: 860 };
  win = new BrowserWindow({
    ...b,
    minWidth: 380,
    minHeight: 560,
    title: 'Pebbles',
    backgroundColor: '#F3EFE6',
    icon: asset('icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win?.show();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${SCHEME}://`)) e.preventDefault();
  });
  win.on('close', (e) => {
    if (win) prefs.bounds = win.getNormalBounds();
    void savePrefs();
    if (!quitting && prefs.closeToTray) {
      e.preventDefault();
      win?.hide();
    }
  });
  win.on('closed', () => (win = null));
  void win.loadURL(`${SCHEME}://app/index.html`);
}

function showWindow() {
  if (!win) createWindow();
  win?.show();
  win?.focus();
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(asset('tray.png'));
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
    tray.setToolTip('Pebbles');
    const menu: MenuItemConstructorOptions[] = [
      { label: 'Open Pebbles', click: showWindow },
      { type: 'separator' },
      {
        label: 'Quit Pebbles',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ];
    tray.setContextMenu(Menu.buildFromTemplate(menu));
    tray.on('click', showWindow);
  } catch (e) {
    console.warn('tray unavailable', e);
  }
}

function registerIpc() {
  ipcMain.handle('pebbles:sync', (_e, req: SyncRequest) => hub.sync({ ...req, deviceId: req.deviceId }, 'desktop-window'));
  ipcMain.handle('pebbles:http', async (_e, url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('Only https requests are allowed');
    const res = await net.fetch(url, { method: init?.method ?? 'GET', headers: init?.headers, body: init?.body });
    return { status: res.status, text: await res.text() };
  });
  ipcMain.handle('pebbles:pairing-start', () => hub.startPairing());
  ipcMain.handle('pebbles:pairing-stop', () => hub.stopPairing());
  ipcMain.handle('pebbles:devices', () => hub.devices());
  ipcMain.handle('pebbles:revoke', (_e, id: string) => hub.revoke(id));
  ipcMain.handle('pebbles:info', () => ({ ...hub.info(), version: app.getVersion(), startWithWindows: prefs.startWithWindows, closeToTray: prefs.closeToTray }));
  ipcMain.handle('pebbles:set-prefs', async (_e, p: Partial<Prefs>) => {
    if (typeof p.closeToTray === 'boolean') prefs.closeToTray = p.closeToTray;
    if (typeof p.startWithWindows === 'boolean') {
      prefs.startWithWindows = p.startWithWindows;
      app.setLoginItemSettings({ openAtLogin: p.startWithWindows, args: ['--hidden'] });
    }
    await savePrefs();
  });
  ipcMain.handle('pebbles:open-data', () => shell.openPath(dataDir()));
}

app.on('before-quit', () => {
  quitting = true;
  void hub?.saveNow();
});

app.on('window-all-closed', () => {
  if (!prefs.closeToTray) app.quit();
});

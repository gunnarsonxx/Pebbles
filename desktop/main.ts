// Pebbles for Windows: the app window plus the hub your phone syncs with.
import { app, BrowserWindow, ipcMain, Menu, nativeImage, net, protocol, shell, Tray, type MenuItemConstructorOptions } from 'electron';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Hub } from './hub';
import type { SyncRequest } from '../src/core/sync';

// "Pebbles" or "Pebbles Community": each edition keeps its own data and window
const NAME = app.getName();
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
    title: NAME,
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
    tray.setToolTip(NAME);
    const menu: MenuItemConstructorOptions[] = [
      { label: `Open ${NAME}`, click: showWindow },
      { type: 'separator' },
      {
        label: `Quit ${NAME}`,
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
  ipcMain.handle('pebbles:firewall', () => firewallStatus());
  ipcMain.handle('pebbles:fix-firewall', () => fixFirewall());
  ipcMain.handle('pebbles:open-data', () => shell.openPath(dataDir()));
  ipcMain.handle('pebbles:open-external', (_e, url: string) => {
    if (typeof url === 'string' && url.startsWith('https://')) return shell.openExternal(url);
  });
  ipcMain.handle('pebbles:install-update', async (_e, url: string, sha256: string | null) => {
    if (typeof url !== 'string' || !url.startsWith('https://github.com/')) throw new Error('Unexpected update address');
    if (process.platform !== 'win32' || !app.isPackaged) {
      await shell.openExternal(url);
      return;
    }
    const res = await net.fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha256) {
      const got = createHash('sha256').update(buf).digest('hex');
      if (got.toLowerCase() !== sha256.toLowerCase()) throw new Error('The download did not match its checksum, so it was not installed.');
    }
    const file = join(app.getPath('temp'), `Pebbles-Setup-${Date.now()}.exe`);
    await fs.writeFile(file, buf);
    await hub.saveNow();
    // silent install over the current copy, then start Pebbles again
    spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    quitting = true;
    setTimeout(() => app.quit(), 300);
  });
}

app.on('before-quit', () => {
  quitting = true;
  void hub?.saveNow();
});

app.on('window-all-closed', () => {
  if (!prefs.closeToTray) app.quit();
});

// ---------------- Windows Firewall ----------------
// Phones reach Pebbles over your home Wi-Fi. Windows blocks that unless there's a rule for it
// (the "allow access" prompt is easy to miss, and networks marked Public block it anyway).

const RULE = `${NAME} (phone sync)`;

function run(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let out = '';
    p.stdout?.on('data', (d) => (out += String(d)));
    p.stderr?.on('data', (d) => (out += String(d)));
    p.on('error', () => resolve({ code: -1, out }));
    p.on('close', (code) => resolve({ code: code ?? -1, out }));
  });
}

// PowerShell takes a script as base64 UTF-16LE, which avoids quoting problems with paths
const ps = (script: string) => ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

async function firewallStatus(): Promise<{ supported: boolean; allowed: boolean; blocked?: boolean }> {
  if (process.platform !== 'win32') return { supported: false, allowed: true };
  const exe = process.execPath;
  // Windows saves a hidden *block* rule for an app if its "Allow access?" popup was closed;
  // block rules win over allow rules, so look for those first
  const r = await run(
    'powershell.exe',
    ps(`
$exe = ${q(exe)}
$rules = Get-NetFirewallApplicationFilter -Program $exe -ErrorAction SilentlyContinue | Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Direction -eq 'Inbound' -and $_.Enabled -eq 'True' }
if ($rules | Where-Object { $_.Action -eq 'Block' }) { 'BLOCKED' }
elseif (($rules | Where-Object { $_.Action -eq 'Allow' }) -or (Get-NetFirewallRule -DisplayName ${q(RULE)} -ErrorAction SilentlyContinue)) { 'ALLOWED' }
else { 'NONE' }`),
  );
  const out = r.out.trim();
  return { supported: true, allowed: /ALLOWED/.test(out), blocked: /BLOCKED/.test(out) };
}

/** Remove Windows' block rules for Pebbles and allow it on every network type (one Windows permission prompt). */
async function fixFirewall(): Promise<{ allowed: boolean }> {
  if (process.platform !== 'win32') return { allowed: true };
  const port = hub.info().port;
  const exe = process.execPath;
  const script = `
$exe = ${q(exe)}
Get-NetFirewallApplicationFilter -Program $exe -ErrorAction SilentlyContinue | Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Action -eq 'Block' } | Remove-NetFirewallRule -ErrorAction SilentlyContinue
Get-NetFirewallRule -DisplayName ${q(RULE)} -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName ${q(RULE)} -Direction Inbound -Action Allow -Program $exe -Profile Any -Enabled True | Out-Null
New-NetFirewallRule -DisplayName ${q(RULE + ' port')} -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port} -Profile Any -Enabled True | Out-Null`;
  const inner = Buffer.from(script, 'utf16le').toString('base64');
  // Start-Process -Verb RunAs shows the Windows admin prompt
  await run('powershell.exe', ps(`Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','${inner}'`));
  return { allowed: (await firewallStatus()).allowed };
}

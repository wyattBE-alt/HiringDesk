import { app, BrowserWindow, shell, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const require    = createRequire(import.meta.url);

const PORT = process.env.PORT || 3000;
let mainWindow = null;

// ── Load .env before the server starts ───────────────────────────────────────

function loadEnv() {
  try {
    const dotenv  = require('dotenv');
    const envPath = app.isPackaged
      ? path.join(process.resourcesPath, '.env')
      : path.join(__dirname, '.env');
    dotenv.config({ path: envPath });
  } catch (e) {
    console.warn('dotenv not available:', e.message);
  }
}

// ── Start the Express server ──────────────────────────────────────────────────

async function startServer() {
  loadEnv();
  await import('./server.js');  // starts Express and listens on PORT
}

// ── Create the app window ─────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    title: 'HiringDesk',
    show: false,
    backgroundColor: '#07090f',
  });

  // Show once ready (avoids white flash)
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Open all external links (job apply links, etc.) in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://localhost:${PORT}`)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Minimal app menu ─────────────────────────────────────────────────────────

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ]
    }] : []),
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ]
    },
    {
      label: 'Navigate',
      submenu: [
        { label: 'Job Seekers', click: () => mainWindow?.loadURL(`http://localhost:${PORT}/index.html`) },
        { label: 'Recruiters',  click: () => mainWindow?.loadURL(`http://localhost:${PORT}/recruiter.html`) },
      ]
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  buildMenu();

  try {
    await startServer();
  } catch (err) {
    console.error('Server start error:', err.message);
  }

  // Brief delay so Express is fully listening before we load the URL
  await new Promise(r => setTimeout(r, 1200));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Load .env before any other module reads process.env
const fs   = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m) process.env[m[1]] = m[2].trim();
    });
}

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const db     = require('./src/db');
const server = require('./src/server');
const sync   = require('./src/sync');

const PORT = 3847;

let mainWindow = null;
let tray       = null;

// Remove default File/Edit/View/... menu
Menu.setApplicationMenu(null);

function createWindow() {
    mainWindow = new BrowserWindow({
        width:  1180,
        height: 720,
        minWidth:  900,
        minHeight: 600,
        icon: path.join(__dirname, 'public/assets/img/icon.ico'),
        title: 'СеверФудс',
        show: false,                        // hidden until ready-to-show
        backgroundColor: '#17212b',         // prevents white flash
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webviewTag: true,
            preload: path.join(__dirname, 'src/preload.js'),
        },
    });

    mainWindow.loadURL(`http://localhost:${PORT}/`);

    mainWindow.once('ready-to-show', () => { mainWindow.show(); });

    mainWindow.on('close', (e) => {
        if (tray) { e.preventDefault(); mainWindow.hide(); }
    });
    mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
    const imgPath = path.join(__dirname, 'public/assets/tray.png');
    const img = fs.existsSync(imgPath)
        ? nativeImage.createFromPath(imgPath)
        : nativeImage.createEmpty();
    tray = new Tray(img);
    tray.setToolTip('SeverFoods Offline');
    tray.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Открыть', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
        { label: 'Синхронизировать', click: () => sync.runSync() },
        { type: 'separator' },
        { label: 'Выход', click: () => { tray = null; app.quit(); } },
    ]));
}

app.whenReady().then(async () => {
    await db.init();
    await server.start(PORT);
    sync.init();
    createWindow();
    createTray();
});

app.on('window-all-closed', () => {});
app.on('activate', () => { if (!mainWindow) createWindow(); });

ipcMain.handle('sync-now',    async () => { await sync.runSync(); return sync.getStatus(); });
ipcMain.handle('sync-status', ()      => sync.getStatus());

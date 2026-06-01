const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const path   = require('path');
const server = require('./src/server');
const sync   = require('./src/sync');

const PORT = 3847;

let mainWindow = null;
let tray       = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width:  1100,
        height: 700,
        minWidth:  800,
        minHeight: 560,
        icon: path.join(__dirname, 'public/assets/icon.ico'),
        title: 'SeverFoods Offline',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'src/preload.js'),
        },
    });

    mainWindow.loadURL(`http://localhost:${PORT}/`);

    mainWindow.on('close', (e) => {
        if (tray) {
            e.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
    const img = nativeImage.createFromPath(
        path.join(__dirname, 'public/assets/tray.png')
    );
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
    tray.setToolTip('SeverFoods Offline');
    tray.on('click', () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    });
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Открыть', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
        { label: 'Синхронизировать сейчас', click: () => sync.runSync() },
        { type: 'separator' },
        { label: 'Выход', click: () => { tray = null; app.quit(); } },
    ]));
}

app.whenReady().then(async () => {
    await server.start(PORT);
    sync.init();
    createWindow();
    createTray();
});

app.on('window-all-closed', () => {});

app.on('activate', () => {
    if (!mainWindow) createWindow();
});

// IPC: trigger manual sync from renderer
ipcMain.handle('sync-now', async () => {
    await sync.runSync();
    return sync.getStatus();
});

ipcMain.handle('sync-status', () => sync.getStatus());

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    syncNow:    () => ipcRenderer.invoke('sync-now'),
    syncStatus: () => ipcRenderer.invoke('sync-status'),
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    saveFile: (data) => ipcRenderer.invoke('save-file', data),
    saveData: (data) => ipcRenderer.invoke('save-data', data),
    loadData: () => ipcRenderer.invoke('load-data'),
});

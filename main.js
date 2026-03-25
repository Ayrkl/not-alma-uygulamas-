const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        backgroundColor: '#0d0d0f',
        titleBarStyle: 'hidden', // Premium look
        titleBarOverlay: {
            color: '#0d0d0f',
            symbolColor: '#ffffff'
        },
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    win.loadFile('index.html');
    
    // Optional: Open devtools
    // win.webContents.openDevTools();
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// IPC communication for saving files directly to text (as requested by user)
ipcMain.handle('save-file', async (event, data) => {
    const { filePath } = await dialog.showSaveDialog({
        title: 'Notu Kaydet',
        defaultPath: 'canvas_notlarim.txt',
        filters: [
            { name: 'Text Files', extensions: ['txt'] },
            { name: 'JSON Files', extensions: ['json'] }
        ]
    });

    if (filePath) {
        fs.writeFileSync(filePath, data);
        return true;
    }
    return false;
});

const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Simple static file server to fix YouTube embedding issues (Error 153/152)
const PORT = 3001;
const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.json': 'application/json'
};

const server = http.createServer((req, res) => {
    let url = req.url.split('?')[0]; // Remove query params
    let filePath = path.join(__dirname, url === '/' ? 'index.html' : url);
    
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('404 Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
});

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        backgroundColor: '#0d0d0f',
        icon: path.join(__dirname, 'ico.png'),
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#0d0d0f',
            symbolColor: '#ffffff'
        },
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false,
        },
    });

    // Set a custom User-Agent to avoid being blocked by YouTube
    win.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Load via localhost instead of file://
    win.loadURL(`http://localhost:${PORT}`);
    
    // win.webContents.openDevTools();
}

app.whenReady().then(() => {
    server.listen(PORT, 'localhost', () => {
        console.log(`Server running at http://localhost:${PORT}`);
        createWindow();
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

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

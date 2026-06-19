// Modules to control application life and create native browser window
const { app, BrowserWindow, dialog, ipcMain, session } = require('electron')
const path = require('path')
const { exec } = require('child_process');
const http = require('http');
const fs = require('fs');

let ollamaProcess = null; // Variable to store the Ollama process (only set if we spawn it)

// Check whether an Ollama server is already responding on the default port.
function isOllamaUp() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:11434/api/tags', (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
  });
}

// Ensure Ollama is serving. If it is already running (e.g. the Windows service),
// attach to it; otherwise spawn `ollama serve` using the platform's default shell.
async function runOllamaCommand() {
  if (await isOllamaUp()) {
    console.log('Ollama server is already running');
    return;
  }

  // shell: true lets Windows resolve ollama.exe via PATH (no hardcoded /bin/sh).
  ollamaProcess = exec('ollama serve', { env: { ...process.env }, shell: true, maxBuffer: 1024 * 500 }, (error, stdout, stderr) => {
    // "address already in use" just means another instance beat us to it — ignore.
    if (error && !/already in use|bind|EADDRINUSE/i.test(String(error))) {
      console.error(`Error executing Ollama: ${error}`);
      dialog.showErrorBox('Error', `Could not start Ollama: ${error.message}\n\nMake sure Ollama is installed and on your PATH.`);
      return;
    }
    if (stdout) console.log(`Ollama Output: ${stdout}`);
    if (stderr) console.error(`Ollama Errors: ${stderr}`);
  });
}

// Define the createWindow function
function createWindow () {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // The renderer fetches the Ollama API directly from a file:// page; disabling
      // webSecurity lets those cross-origin requests through on this local-only app.
      webSecurity: false
    }
  })

  // Load the index.html of the app (absolute path so it works regardless of cwd).
  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'))

  // Uncomment to debug the renderer:
  // mainWindow.webContents.openDevTools()
}

// This method will be called when Electron has finished initialization and is
// ready to create browser windows. Some APIs can only be used after this event.
app.whenReady().then(() => {
  // Rewrite the Origin header on requests to the Ollama API so its CORS check
  // accepts requests coming from the file:// renderer. This mirrors what the
  // Chrome-extension build does with declarativeNetRequest.
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.url.includes(':11434')) {
      details.requestHeaders['Origin'] = 'http://localhost:11434';
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  runOllamaCommand(); // Serve Ollama (attaches to a running instance if present)
  createWindow();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', function() {
  if (process.platform !== 'darwin') app.quit();
});

// Clean up the Ollama process on quit — only if we were the ones who started it.
app.on('before-quit', function () {
  if (ollamaProcess) {
    ollamaProcess.kill();
    ollamaProcess = null;
  }
});

// --- IPC handlers (renderer <-> main) ---

ipcMain.handle('check-update', () => {
  console.log('CHECK FOR UPDATES');
})

ipcMain.handle('ping', () => {
  return 'Pong';
})

ipcMain.handle('get-new-models', async () => {
  try {
    const raw = await fs.promises.readFile(path.join(__dirname, 'models.json'), 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(err);
    return 'Models not found';
  }
})

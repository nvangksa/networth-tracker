'use strict'

const { app, BrowserWindow, shell } = require('electron')

const isDev = !app.isPackaged

let mainWindow

// Returns the port the Express server actually bound to.
// Using port 0 in production lets the OS pick any free port, so the app
// never crashes because something else happens to be on 3001.
async function startServer () {
  process.env.PORTFOLIO_DATA_DIR = app.getPath('userData')
  process.env.ELECTRON_PRODUCTION = '1'
  const mod = await import('../server.js')
  return await mod.serverReady
}

function createWindow (port) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Net Worth Tracker',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Use 127.0.0.1 explicitly (not `localhost`) to match what the Express
  // server binds to. On some Windows machines `localhost` resolves to ::1
  // (IPv6) first, but the server binds 127.0.0.1 only — so the renderer's
  // fetch('/api/...') would silently fail and prices/FX would never load.
  // This was the cause of the "Yahoo Finance doesn't work on my computer"
  // complaints from users running fresh Windows installs.
  const url = isDev ? 'http://localhost:5173' : `http://127.0.0.1:${port}`
  mainWindow.loadURL(url)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(async () => {
  if (!isDev) {
    try {
      const port = await startServer()
      createWindow(port)
    } catch (err) {
      const { dialog } = require('electron')
      dialog.showErrorBox(
        'Could not start Net Worth Tracker',
        'The server failed to start.\n\nClose any other instance of the app and try again.\n\n' + err.message
      )
      app.quit()
    }
  } else {
    createWindow(5173)
  }
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

import { join } from 'node:path'
import { app, BrowserWindow, session, shell } from 'electron'
import { closeDb, getDb } from './db'
import { registerIpc } from './ipc'
import { bindPtyLifecycle } from './ipc/workspace'
import { killAll as killAllTerminals } from './services/pty'
import { startReminders, type Reminders } from './services/reminders'

let mainWindow: BrowserWindow | null = null
let reminders: Reminders | null = null

/** Bring the window forward — what clicking a notification should do. */
function focusWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/**
 * Locked down in packaged builds only — Vite's dev server needs inline scripts
 * and a websocket for HMR, and applying this in dev would break the reload loop
 * without making the shipped app any safer.
 *
 * `style-src 'unsafe-inline'` is required: Motion and React both write inline
 * style attributes. `connect-src 'self'` is what keeps this app offline; the
 * Gemini call in Phase 2 happens in the main process, not here.
 */
function applyProductionCsp(): void {
  if (process.env['ELECTRON_RENDERER_URL']) return

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'"
        ]
      }
    })
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 840,
    minWidth: 940,
    minHeight: 660,
    show: false,
    // Must track --color-canvas, or launch flashes the old near-black.
    backgroundColor: '#16161b',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 22 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Paint only once React has something to show, so launch isn't a white flash.
  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Terminals belong to the renderer that opened them. A reload or a closed
  // window has to take its shells with it, or a dev server keeps its port.
  bindPtyLifecycle(mainWindow.webContents)

  // Surface renderer errors in the terminal during development, so a blank
  // window is never a silent mystery.
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.webContents.on(
      'console-message',
      (...args: unknown[]) => {
        // Electron 36+ passes a details object; older builds pass positionals.
        const first = args[0] as { level?: string; message?: string } | undefined
        const level = first?.level ?? String(args[1] ?? 'log')
        const message = first?.message ?? String(args[2] ?? '')
        if (message) console.log(`[renderer:${level}] ${message}`)
      }
    )
  }

  // Nothing in this app should ever navigate away or spawn a window. Any link
  // that wants the outside world goes to the real browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
    void shell.openExternal(url)
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

// A second instance would open the same SQLite file behind the first one's
// back. Focus the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.amber.daydeck')
    applyProductionCsp()

    // Open the DB up front so a migration failure surfaces at launch rather
    // than on the first IPC call.
    getDb()
    registerIpc()
    createWindow()
    reminders = startReminders(getDb(), focusWindow)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    reminders?.stop()
    // Quitting must not leave a login shell — and whatever it was running —
    // alive with no window attached to it.
    killAllTerminals()
    closeDb()
  })
}

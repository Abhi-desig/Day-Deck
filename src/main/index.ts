import { join } from 'node:path'
import { app, BrowserWindow, session, shell } from 'electron'
import { WINDOW_BACKGROUND } from '@shared/types'
import { closeDb, getDb } from './db'
import { getUiPrefs } from './db/settings'
import { registerIpc } from './ipc'
import { bindPtyLifecycle } from './ipc/workspace'
import {
  registerMediaProtocol,
  registerMediaScheme
} from './services/media'
import { killAll as killAllTerminals } from './services/pty'
import { startReminders, type Reminders } from './services/reminders'

let mainWindow: BrowserWindow | null = null
let reminders: Reminders | null = null

// Before `whenReady`, deliberately: a privileged scheme registered after the app
// is ready is registered too late for the renderer to load it as a normal source.
registerMediaScheme()

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
 * A URL is handed to the OS only when it is the web (or mail).
 *
 * `shell.openExternal` with an unvetted string is the classic Electron hole:
 * `file:`, `smb:` and custom app schemes all launch things. Every navigation
 * escape in this app funnels through here, so the answer is in one place.
 */
function openExternally(url: string): void {
  if (/^(https?|mailto):/i.test(url)) {
    void shell.openExternal(url)
  }
}

/**
 * The guards every WebContents gets, current and future.
 *
 * Bound in `web-contents-created` rather than on `mainWindow` alone, so a
 * second window — should one ever exist — is born guarded rather than
 * remembered about. Nothing in this app should ever navigate away or spawn a
 * window; any link that wants the outside world goes to the real browser.
 */
function guardWebContents(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    openExternally(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
    openExternally(url)
  })
  // No frame in this app may attach a webview, whatever a compromised page asks.
  contents.on('will-attach-webview', (event) => event.preventDefault())
}

/**
 * Locked down in packaged builds only — Vite's dev server needs inline scripts
 * and a websocket for HMR, and applying this in dev would break the reload loop
 * without making the shipped app any safer. The renderer's own <meta> CSP
 * covers development; see renderer/index.html.
 *
 * `style-src 'unsafe-inline'` is required: Motion and React both write inline
 * style attributes. `connect-src 'self'` is what keeps this app offline; the
 * Gemini call in Phase 2 happens in the main process, not here.
 *
 * `deck-media:` in `img-src`/`media-src` is how linked reference media renders.
 * It is narrower than it looks and much narrower than allowing `file:`: the
 * renderer can only address an item id, and the handler will only ever serve a
 * path some list item already holds. See services/media.ts.
 */
function applyProductionCsp(): void {
  if (process.env['ELECTRON_RENDERER_URL']) return

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: deck-media:; media-src 'self' deck-media:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'"
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
    // Must track --color-canvas, or launch flashes the wrong theme. Read from
    // the database rather than hardcoded: the window is built before the
    // renderer runs, so this is the only thing on screen until React paints.
    backgroundColor: WINDOW_BACKGROUND[getUiPrefs(getDb()).theme],
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

  // Every WebContents — including any created later — is guarded at birth.
  app.on('web-contents-created', (_event, contents) => {
    guardWebContents(contents)
  })

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.amber.daydeck')
    applyProductionCsp()

    // This app asks for no browser permissions — camera, mic, geolocation,
    // notifications-via-page — so every request is denied by default rather
    // than left to whatever the platform decides.
    session.defaultSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false)
    )

    // Open the DB up front so a migration failure surfaces at launch rather
    // than on the first IPC call.
    getDb()
    registerIpc()
    // After getDb(), before the window: the handler reads rows, and the renderer
    // may request media on its first paint.
    registerMediaProtocol()
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

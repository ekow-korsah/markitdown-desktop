import { app, BrowserWindow, dialog, ipcMain, Menu, shell, clipboard } from 'electron'
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { Sidecar, type ProtocolError } from './sidecar'

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let sidecar: Sidecar | null = null

/* ------------------------------------------------------------------ settings */

interface Settings {
  revealAfterSave: boolean
  lastSaveDir: string | null
  sidebarHidden: boolean
}

const defaultSettings: Settings = {
  revealAfterSave: false,
  lastSaveDir: null,
  sidebarHidden: false,
}
let settings: Settings = { ...defaultSettings }

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json')

async function loadSettings(): Promise<void> {
  try {
    const raw = await readFile(settingsPath(), 'utf8')
    settings = { ...defaultSettings, ...JSON.parse(raw) }
  } catch {
    settings = { ...defaultSettings }
  }
}

async function saveSettings(): Promise<void> {
  try {
    await mkdir(path.dirname(settingsPath()), { recursive: true })
    await writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf8')
  } catch (error) {
    console.warn('Could not persist settings:', error)
  }
}

/* -------------------------------------------------------------------- window */

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 880,
    minHeight: 560,
    show: false,
    title: 'MarkItDown',
    titleBarStyle: 'hiddenInset',
    // Matches the renderer's canvas so there's no flash before first paint.
    backgroundColor: '#f4f1ea',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // External links belong in the user's browser, never in the app shell.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

/* ----------------------------------------------------------------------- IPC */

function toProtocolError(error: unknown): ProtocolError {
  if (error && typeof error === 'object' && 'kind' in error && 'message' in error) {
    return error as ProtocolError
  }
  return {
    kind: 'unexpected',
    message: 'Something went wrong.',
    hint: error instanceof Error ? error.message : String(error),
  }
}

/** Wrap a handler so the renderer always gets {ok} | {error}, never a throw. */
async function guard<T>(work: () => Promise<T>) {
  try {
    return { ok: true as const, value: await work() }
  } catch (error) {
    return { ok: false as const, error: toProtocolError(error) }
  }
}

function registerIpc(): void {
  ipcMain.handle('convert:file', (_event, filePath: string, id: string) =>
    guard(() => sidecar!.convertFile(filePath, id)),
  )

  ipcMain.handle('convert:url', (_event, url: string, id: string) =>
    guard(() => sidecar!.convertUrl(url, id)),
  )

  ipcMain.handle('convert:cancel', (_event, id: string) => guard(() => sidecar!.cancel(id)))

  ipcMain.handle('app:formats', () => guard(() => sidecar!.formats()))

  ipcMain.handle('app:settings', () => settings)

  ipcMain.handle('app:updateSettings', async (_event, patch: Partial<Settings>) => {
    settings = { ...settings, ...patch }
    await saveSettings()
    return settings
  })

  ipcMain.handle('dialog:openFiles', async () =>
    guard(async () => {
      let extensions: string[] = []
      try {
        extensions = (await sidecar!.formats()).all
      } catch {
        /* fall back to an unfiltered picker */
      }

      const result = await dialog.showOpenDialog(mainWindow!, {
        title: 'Choose files to convert',
        buttonLabel: 'Convert',
        properties: ['openFile', 'multiSelections'],
        filters: extensions.length
          ? [
              { name: 'Supported documents', extensions },
              { name: 'All files', extensions: ['*'] },
            ]
          : undefined,
      })
      return result.canceled ? [] : result.filePaths
    }),
  )

  ipcMain.handle('file:save', async (_event, suggestedName: string, content: string) =>
    guard(async () => {
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: 'Save Markdown',
        defaultPath: path.join(settings.lastSaveDir ?? app.getPath('downloads'), suggestedName),
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      })
      if (result.canceled || !result.filePath) return null

      await writeFile(result.filePath, content, 'utf8')
      settings.lastSaveDir = path.dirname(result.filePath)
      await saveSettings()
      if (settings.revealAfterSave) shell.showItemInFolder(result.filePath)
      return result.filePath
    }),
  )

  ipcMain.handle(
    'file:saveAll',
    async (_event, items: Array<{ name: string; content: string }>) =>
      guard(async () => {
        const result = await dialog.showOpenDialog(mainWindow!, {
          title: 'Choose a folder for the Markdown files',
          buttonLabel: 'Save Here',
          defaultPath: settings.lastSaveDir ?? app.getPath('downloads'),
          properties: ['openDirectory', 'createDirectory'],
        })
        if (result.canceled || !result.filePaths[0]) return null

        const dir = result.filePaths[0]
        const used = new Set<string>()
        let written = 0

        for (const item of items) {
          // Two sources can share a basename ("report.pdf" and "report.docx"),
          // so de-duplicate rather than silently overwriting.
          let name = item.name
          let counter = 2
          while (used.has(name.toLowerCase())) {
            name = item.name.replace(/\.md$/i, '') + `-${counter++}.md`
          }
          used.add(name.toLowerCase())
          await writeFile(path.join(dir, name), item.content, 'utf8')
          written += 1
        }

        settings.lastSaveDir = dir
        await saveSettings()
        if (settings.revealAfterSave) shell.openPath(dir)
        return { dir, written }
      }),
  )

  ipcMain.handle('clipboard:write', (_event, text: string) => {
    clipboard.writeText(text)
    return true
  })

  ipcMain.handle('shell:openExternal', (_event, url: string) => shell.openExternal(url))
}

/* ------------------------------------------------------------- dev capture */

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Dev-only: render the real window to PNGs so the UI can be reviewed without a
 * human at the screen. Never runs in a packaged build.
 * Driven by scripts/screenshot.mjs.
 */
async function runCaptureSession(outDir: string): Promise<void> {
  const win = mainWindow
  if (!win) return

  await new Promise<void>((resolve) => win.webContents.once('did-finish-load', () => resolve()))
  await mkdir(outDir, { recursive: true })

  const shoot = async (name: string) => {
    const image = await win.webContents.capturePage()
    await writeFile(path.join(outDir, name), image.toPNG())
    console.log(`[capture] ${name}`)
  }

  // Pin the sidebar open so captures don't depend on the persisted setting.
  await win.webContents.executeJavaScript(`window.__setSidebar && window.__setSidebar(false)`)
  await delay(1400)
  await shoot('01-empty.png')

  const fixtures: string[] = JSON.parse(process.env.MARKITDOWN_CAPTURE_FILES ?? '[]')
  if (fixtures.length) {
    await win.webContents.executeJavaScript(
      `window.__addFiles && window.__addFiles(${JSON.stringify(fixtures)})`,
    )
    await delay(5000)
    await shoot('02-converted.png')

    await win.webContents.executeJavaScript(`window.__showTab && window.__showTab('preview')`)
    await delay(700)
    await shoot('03-preview.png')

    await win.webContents.executeJavaScript(`window.__setSidebar && window.__setSidebar(true)`)
    await delay(600)
    await shoot('04-sidebar-hidden.png')
  }

  app.quit()
}

/* ---------------------------------------------------------------------- menu */

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Conversion',
          accelerator: 'CmdOrCtrl+N',
          click: () => send('menu:new', null),
        },
        { type: 'separator' },
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => send('menu:openFiles', null),
        },
        {
          label: 'Save Markdown…',
          accelerator: 'CmdOrCtrl+S',
          click: () => send('menu:save', null),
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    // Without a real Edit menu, Cmd+C/V stop working in a packaged app.
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+\\',
          click: () => send('menu:toggleSidebar', null),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'MarkItDown on GitHub',
          click: () => shell.openExternal('https://github.com/microsoft/markitdown'),
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/* --------------------------------------------------------------- lifecycle */

// A second instance would spawn a second sidecar and fight over the window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    await loadSettings()

    sidecar = new Sidecar((event) => send('sidecar:event', event))
    sidecar.start()

    registerIpc()
    buildMenu()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })

    if (!app.isPackaged && process.env.MARKITDOWN_CAPTURE) {
      void runCaptureSession(process.env.MARKITDOWN_CAPTURE)
    }
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  // Belt and braces: never leave an orphaned Python process behind.
  app.on('before-quit', () => sidecar?.stop())
  process.on('exit', () => sidecar?.stop())
}

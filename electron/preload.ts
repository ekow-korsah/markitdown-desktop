import { contextBridge, ipcRenderer, webUtils } from 'electron'

/**
 * The only surface the renderer gets. Node stays out of the renderer entirely
 * (contextIsolation on, nodeIntegration off).
 */
const api = {
  /**
   * Resolve a dropped File to its path on disk.
   *
   * Electron 32 removed the non-standard `File.path` property, so this is the
   * supported replacement. Without it, drag-and-drop silently yields nothing.
   */
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },

  convertFile: (path: string, id: string) => ipcRenderer.invoke('convert:file', path, id),
  convertUrl: (url: string, id: string) => ipcRenderer.invoke('convert:url', url, id),
  cancel: (id: string) => ipcRenderer.invoke('convert:cancel', id),

  formats: () => ipcRenderer.invoke('app:formats'),
  getSettings: () => ipcRenderer.invoke('app:settings'),
  updateSettings: (patch: Record<string, unknown>) =>
    ipcRenderer.invoke('app:updateSettings', patch),

  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  saveMarkdown: (suggestedName: string, content: string) =>
    ipcRenderer.invoke('file:save', suggestedName, content),
  saveAll: (items: Array<{ name: string; content: string }>) =>
    ipcRenderer.invoke('file:saveAll', items),

  copyToClipboard: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  /** Subscribe to sidecar status/progress. Returns an unsubscribe function. */
  onSidecarEvent: (handler: (event: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => handler(payload)
    ipcRenderer.on('sidecar:event', listener)
    return () => ipcRenderer.removeListener('sidecar:event', listener)
  },

  /** Menu commands (Cmd+O / Cmd+S / Cmd+\) routed into the renderer. */
  onMenuCommand: (
    command: 'openFiles' | 'save' | 'toggleSidebar' | 'new',
    handler: () => void,
  ) => {
    const channel =
      command === 'openFiles'
        ? 'menu:openFiles'
        : command === 'save'
          ? 'menu:save'
          : command === 'new'
            ? 'menu:new'
            : 'menu:toggleSidebar'
    const listener = () => handler()
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
}

contextBridge.exposeInMainWorld('markitdown', api)

export type MarkItDownApi = typeof api

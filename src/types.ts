export interface ProtocolError {
  kind: string
  message: string
  hint: string
}

export interface ConversionResult {
  markdown: string
  title: string | null
  source: string
  sourceKind: 'file' | 'url'
  durationMs: number
  chars: number
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: ProtocolError }

export type ItemStatus = 'queued' | 'converting' | 'done' | 'failed'

export interface QueueItem {
  id: string
  /** What the user sees: a filename, or a shortened URL. */
  label: string
  /** Full path or URL, shown as secondary detail. */
  source: string
  kind: 'file' | 'url'
  status: ItemStatus
  stage?: string
  markdown?: string
  /** Set only once the user edits; keeps the original recoverable. */
  edited?: string
  title?: string | null
  chars?: number
  durationMs?: number
  error?: ProtocolError
}

export interface Settings {
  revealAfterSave: boolean
  lastSaveDir: string | null
  sidebarHidden: boolean
}

export type SidecarState = 'starting' | 'ready' | 'warm' | 'crashed'

export interface MarkItDownApi {
  getPathForFile: (file: File) => string
  convertFile: (path: string, id: string) => Promise<Outcome<ConversionResult>>
  convertUrl: (url: string, id: string) => Promise<Outcome<ConversionResult>>
  cancel: (id: string) => Promise<Outcome<{ cancelled: boolean }>>
  formats: () => Promise<Outcome<{ groups: Record<string, string[]>; all: string[] }>>
  getSettings: () => Promise<Settings>
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>
  openFiles: () => Promise<Outcome<string[]>>
  saveMarkdown: (suggestedName: string, content: string) => Promise<Outcome<string | null>>
  saveAll: (
    items: Array<{ name: string; content: string }>,
  ) => Promise<Outcome<{ dir: string; written: number } | null>>
  copyToClipboard: (text: string) => Promise<boolean>
  openExternal: (url: string) => Promise<void>
  onSidecarEvent: (handler: (event: any) => void) => () => void
  onMenuCommand: (
    command: 'openFiles' | 'save' | 'toggleSidebar' | 'new',
    handler: () => void,
  ) => () => void
}

declare global {
  interface Window {
    markitdown: MarkItDownApi
  }
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { QueueItem, SidecarState } from './types'
import { basename, labelForUrl, suggestFilename } from './lib/markdown'
import TitleBar from './components/TitleBar'
import Sidebar from './components/Sidebar'
import ResultPane, { type Tab } from './components/ResultPane'
import Hero from './components/Hero'
import DropOverlay from './components/DropOverlay'
import Toast from './components/Toast'

export default function App() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sidecarState, setSidecarState] = useState<SidecarState>('starting')
  const [sidecarDetail, setSidecarDetail] = useState<string | undefined>()
  const [dragging, setDragging] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('markdown')
  const [formats, setFormats] = useState<Record<string, string[]>>({})
  const [sidebarHidden, setSidebarHidden] = useState(false)

  const nextId = useRef(1)
  const dragDepth = useRef(0)

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  )

  const patchItem = useCallback((id: string, patch: Partial<QueueItem>) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    )
  }, [])

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 2600)
  }, [])

  // Restore the sidebar's last state so the window opens the way it was left.
  useEffect(() => {
    void window.markitdown.getSettings().then((saved) => setSidebarHidden(saved.sidebarHidden))
  }, [])

  /** Back to the start screen, where both inputs live. */
  const startNew = useCallback(() => setSelectedId(null), [])

  const toggleSidebar = useCallback(() => {
    setSidebarHidden((hidden) => {
      const next = !hidden
      void window.markitdown.updateSettings({ sidebarHidden: next })
      return next
    })
  }, [])

  /* ---------------------------------------------------------- sidecar state */

  useEffect(() => {
    return window.markitdown.onSidecarEvent((event: any) => {
      if (event?.type === 'status') {
        setSidecarState(event.state)
        setSidecarDetail(event.detail)
      } else if (event?.type === 'progress') {
        patchItem(String(event.id), { status: 'converting', stage: event.stage })
      }
    })
  }, [patchItem])

  useEffect(() => {
    if (sidecarState !== 'warm' && sidecarState !== 'ready') return
    let cancelled = false
    void window.markitdown.formats().then((outcome) => {
      if (!cancelled && outcome.ok) setFormats(outcome.value.groups)
    })
    return () => {
      cancelled = true
    }
  }, [sidecarState])

  /* -------------------------------------------------------------- conversion */

  const run = useCallback(
    async (item: QueueItem) => {
      const outcome =
        item.kind === 'file'
          ? await window.markitdown.convertFile(item.source, item.id)
          : await window.markitdown.convertUrl(item.source, item.id)

      if (outcome.ok) {
        patchItem(item.id, {
          status: 'done',
          markdown: outcome.value.markdown,
          title: outcome.value.title,
          chars: outcome.value.chars,
          durationMs: outcome.value.durationMs,
          stage: undefined,
        })
      } else {
        patchItem(item.id, { status: 'failed', error: outcome.error, stage: undefined })
      }
    },
    [patchItem],
  )

  const enqueue = useCallback(
    (incoming: Array<Pick<QueueItem, 'label' | 'source' | 'kind'>>) => {
      if (!incoming.length) return

      const created: QueueItem[] = incoming.map((entry) => ({
        ...entry,
        id: String(nextId.current++),
        status: 'queued' as const,
      }))

      setItems((current) => [...current, ...created])
      setSelectedId((current) => current ?? created[0].id)
      // The sidecar converts one at a time; firing them all keeps its queue fed.
      created.forEach((item) => void run(item))
    },
    [run],
  )

  const addFiles = useCallback(
    (paths: string[]) => {
      const seen = new Set(items.filter((i) => i.kind === 'file').map((i) => i.source))
      const fresh = paths.filter((path) => path && !seen.has(path))
      if (fresh.length < paths.length) {
        notify(paths.length - fresh.length === 1 ? 'Already added' : 'Some files were already added')
      }
      enqueue(fresh.map((path) => ({ label: basename(path), source: path, kind: 'file' as const })))
    },
    [enqueue, items, notify],
  )

  const addUrl = useCallback(
    (raw: string) => {
      const url = raw.trim()
      if (!url) return
      enqueue([{ label: labelForUrl(url), source: url, kind: 'url' as const }])
    },
    [enqueue],
  )

  const browse = useCallback(async () => {
    const outcome = await window.markitdown.openFiles()
    if (outcome.ok) addFiles(outcome.value)
  }, [addFiles])

  const retry = useCallback(
    (item: QueueItem) => {
      patchItem(item.id, { status: 'queued', error: undefined })
      void run({ ...item, status: 'queued' })
    },
    [patchItem, run],
  )

  /** Stop work we no longer need; harmless if it already finished. */
  const cancelIfPending = useCallback((item: QueueItem) => {
    if (item.status === 'queued' || item.status === 'converting') {
      void window.markitdown.cancel(item.id)
    }
  }, [])

  const remove = useCallback(
    (id: string) => {
      const index = items.findIndex((item) => item.id === id)
      if (index === -1) return
      cancelIfPending(items[index])

      const next = items.filter((item) => item.id !== id)
      setItems(next)
      if (selectedId === id) {
        setSelectedId(next[index]?.id ?? next[index - 1]?.id ?? null)
      }
    },
    [items, selectedId, cancelIfPending],
  )

  const clearAll = useCallback(() => {
    items.forEach(cancelIfPending)
    setItems([])
    setSelectedId(null)
  }, [items, cancelIfPending])

  /* ------------------------------------------------------------- output */

  const contentOf = (item: QueueItem) => item.edited ?? item.markdown ?? ''

  const copySelected = useCallback(async () => {
    if (!selected?.markdown) return
    await window.markitdown.copyToClipboard(contentOf(selected))
    notify('Copied to clipboard')
  }, [selected, notify])

  const saveSelected = useCallback(async () => {
    if (!selected?.markdown) return
    const outcome = await window.markitdown.saveMarkdown(
      suggestFilename(selected.label, selected.title),
      contentOf(selected),
    )
    if (outcome.ok && outcome.value) notify(`Saved ${basename(outcome.value)}`)
    else if (!outcome.ok) notify(outcome.error.message)
  }, [selected, notify])

  const doneItems = useMemo(() => items.filter((item) => item.status === 'done'), [items])

  const saveAll = useCallback(async () => {
    if (!doneItems.length) return
    const outcome = await window.markitdown.saveAll(
      doneItems.map((item) => ({
        name: suggestFilename(item.label, item.title),
        content: contentOf(item),
      })),
    )
    if (outcome.ok && outcome.value) {
      const { written } = outcome.value
      notify(`Saved ${written} file${written === 1 ? '' : 's'}`)
    } else if (!outcome.ok) {
      notify(outcome.error.message)
    }
  }, [doneItems, notify])

  /* --------------------------------------------------------- menu + drag */

  useEffect(() => window.markitdown.onMenuCommand('openFiles', () => void browse()), [browse])
  useEffect(() => window.markitdown.onMenuCommand('save', () => void saveSelected()), [saveSelected])
  useEffect(
    () => window.markitdown.onMenuCommand('toggleSidebar', toggleSidebar),
    [toggleSidebar],
  )
  useEffect(() => window.markitdown.onMenuCommand('new', startNew), [startNew])

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      dragDepth.current += 1
      setDragging(true)
    }
    const onDragOver = (event: DragEvent) => event.preventDefault()
    const onDragLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    }
    const onDrop = (event: DragEvent) => {
      event.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const files = Array.from(event.dataTransfer?.files ?? [])
      // Electron 32+ removed File.path; the preload bridge resolves paths.
      const paths = files.map((file) => window.markitdown.getPathForFile(file)).filter(Boolean)
      if (paths.length) addFiles(paths)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [addFiles])

  // Dev-only hooks so scripts/screenshot.mjs can drive the real UI.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as any).__addFiles = addFiles
    ;(window as any).__showTab = setTab
    ;(window as any).__setSidebar = setSidebarHidden
  }, [addFiles])

  const busy = items.some((item) => item.status === 'queued' || item.status === 'converting')

  return (
    <div className="flex h-full flex-col bg-canvas">
      <TitleBar
        state={sidecarState}
        detail={sidecarDetail}
        busy={busy}
        sidebarHidden={sidebarHidden}
        onToggleSidebar={toggleSidebar}
        onNew={startNew}
      />

      <div className="flex min-h-0 flex-1">
        {!sidebarHidden && (
        <Sidebar
          items={items}
          selectedId={selectedId}
          doneCount={doneItems.length}
          onSelect={setSelectedId}
          onNew={startNew}
          onBrowse={browse}
          onRemove={remove}
          onRetry={retry}
          onSaveAll={saveAll}
          onClear={clearAll}
        />
        )}

        {/* The apricot wash lives on the canvas, not behind the sidebar. */}
        <main className="canvas-wash min-w-0 flex-1 p-3">
          {selected ? (
            <ResultPane
              item={selected}
              tab={tab}
              onTabChange={setTab}
              onCopy={copySelected}
              onSave={saveSelected}
              onRetry={() => retry(selected)}
              onEdit={(value) => patchItem(selected.id, { edited: value })}
            />
          ) : (
            <Hero
              starting={sidecarState === 'starting'}
              formats={formats}
              onAddUrl={addUrl}
              onBrowse={browse}
            />
          )}
        </main>
      </div>

      {dragging && <DropOverlay />}
      <Toast message={toast} />
    </div>
  )
}

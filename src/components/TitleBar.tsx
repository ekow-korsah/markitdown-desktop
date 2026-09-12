import type { SidecarState } from '../types'

interface Props {
  state: SidecarState
  detail?: string
  busy: boolean
  sidebarHidden: boolean
  onToggleSidebar: () => void
  onNew: () => void
}

export default function TitleBar({
  state,
  detail,
  busy,
  sidebarHidden,
  onToggleSidebar,
  onNew,
}: Props) {
  const starting = state === 'starting'
  const broken = state === 'crashed'

  return (
    <header className="drag-region flex h-[46px] shrink-0 items-center justify-between pl-[86px] pr-4">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onToggleSidebar}
          title={sidebarHidden ? 'Show sidebar (⌘\\)' : 'Hide sidebar (⌘\\)'}
          aria-label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
          aria-pressed={!sidebarHidden}
          className="no-drag rounded-[7px] p-1.5 text-ink-2 transition-colors hover:bg-surface-hover hover:text-ink"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2" y="3" width="12" height="10" rx="1.8" />
            <path d="M6.4 3v10" />
            {/* Filled rail when the sidebar is showing, hollow when it isn't. */}
            {!sidebarHidden && <path d="M4.2 3v10" strokeWidth="2.6" strokeOpacity="0.32" />}
          </svg>
        </button>
        <h1 className="text-[13px] font-bold tracking-[-0.01em] text-ink">MarkItDown</h1>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-[11.5px]">
        {broken ? (
          <span className="max-w-[420px] truncate text-danger" title={detail}>
            {detail ?? 'The converter stopped.'}
          </span>
        ) : starting ? (
          <>
            <Dot className="animate-pulse bg-accent" />
            <span className="text-ink-2">Starting the converter</span>
          </>
        ) : busy ? (
          <>
            <Dot className="animate-pulse bg-accent" />
            <span className="text-ink-2">Converting</span>
          </>
        ) : (
          <>
            <Dot className="bg-ok/70" />
            <span className="text-ink-3">Ready</span>
          </>
        )}
        </div>

        <button
          type="button"
          onClick={onNew}
          title="New conversion (⌘N)"
          className="no-drag flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-[5px] text-[12px] font-semibold text-ink transition-colors hover:bg-surface-hover"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          >
            <path d="M8 3.6v8.8M3.6 8h8.8" />
          </svg>
          New
        </button>
      </div>
    </header>
  )
}

function Dot({ className }: { className?: string }) {
  return <span className={`h-[6px] w-[6px] rounded-full ${className}`} />
}

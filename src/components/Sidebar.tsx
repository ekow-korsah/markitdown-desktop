import type { QueueItem } from '../types'
import { formatCount } from '../lib/markdown'

interface Props {
  items: QueueItem[]
  selectedId: string | null
  doneCount: number
  onSelect: (id: string) => void
  onNew: () => void
  onBrowse: () => void
  onRemove: (id: string) => void
  onRetry: (item: QueueItem) => void
  onSaveAll: () => void
  onClear: () => void
}

export default function Sidebar({
  items,
  selectedId,
  doneCount,
  onSelect,
  onNew,
  onBrowse,
  onRemove,
  onRetry,
  onSaveAll,
  onClear,
}: Props) {
  return (
    <aside className="flex w-[254px] shrink-0 flex-col border-r border-line">
      <nav className="px-2.5 pb-2 pt-1">
        <NavRow onClick={onNew} label="New conversion">
          <path d="M8 3.4v9.2M3.4 8h9.2" />
        </NavRow>
        <NavRow onClick={onBrowse} label="Choose files">
          <path d="M2.5 4.2a1.2 1.2 0 0 1 1.2-1.2h2.3l1.2 1.6h5.1a1.2 1.2 0 0 1 1.2 1.2v6a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2z" />
        </NavRow>
      </nav>

      {items.length > 0 && (
        <>
          <div className="mx-3.5 border-t border-line-soft" />
          <p className="px-4 pb-1.5 pt-3.5 text-[10.5px] font-semibold tracking-[0.09em] text-ink-3">
            RECENTS
          </p>
        </>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet px-2">
        <ul className="space-y-px pb-2">
          {items.map((item) => (
            <Row
              key={item.id}
              item={item}
              active={item.id === selectedId}
              onSelect={() => onSelect(item.id)}
              onRemove={() => onRemove(item.id)}
              onRetry={() => onRetry(item)}
            />
          ))}
        </ul>
      </div>

      {items.length > 0 && (
        <div className="flex items-center gap-2 border-t border-line-soft p-3">
          <button
            type="button"
            onClick={onSaveAll}
            disabled={doneCount === 0}
            className="no-drag flex-1 rounded-full bg-ink py-[7px] text-[12.5px] font-semibold text-canvas transition-opacity hover:opacity-90 disabled:bg-surface-sunken disabled:text-ink-3 disabled:opacity-100"
          >
            {doneCount > 1 ? `Save ${doneCount} files` : 'Save all'}
          </button>
          <button
            type="button"
            onClick={onClear}
            className="no-drag rounded-full px-3 py-[7px] text-[12.5px] text-ink-2 transition-colors hover:bg-surface-hover hover:text-ink"
          >
            Clear
          </button>
        </div>
      )}
    </aside>
  )
}

function NavRow({
  onClick,
  label,
  children,
}: {
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="no-drag flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-[7px] text-[13px] font-medium text-ink transition-colors hover:bg-surface-hover"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-ink-2"
      >
        {children}
      </svg>
      {label}
    </button>
  )
}

function Row({
  item,
  active,
  onSelect,
  onRemove,
  onRetry,
}: {
  item: QueueItem
  active: boolean
  onSelect: () => void
  onRemove: () => void
  onRetry: () => void
}) {
  const detail =
    item.status === 'done'
      ? formatCount(item.chars ?? 0)
      : item.status === 'converting'
        ? item.stage === 'fetching'
          ? 'fetching'
          : 'converting'
        : item.status === 'queued'
          ? 'waiting'
          : item.error?.message

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelect()
          }
        }}
        className={`group relative flex items-center gap-2 rounded-[8px] py-[7px] pl-2.5 pr-1.5 transition-colors ${
          active ? 'bg-accent-wash' : 'hover:bg-surface-hover'
        }`}
      >
        {active && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent" />
        )}

        <div className="min-w-0 flex-1">
          <div
            className={`truncate text-[12.5px] leading-tight ${
              active ? 'font-semibold text-ink' : 'text-ink'
            }`}
            title={item.source}
          >
            {item.label}
          </div>
          <div
            className={`mt-0.5 truncate text-[11px] leading-tight ${
              item.status === 'failed' ? 'text-danger' : 'text-ink-3'
            }`}
            title={item.status === 'failed' ? item.error?.hint : undefined}
          >
            {detail}
          </div>
        </div>

        {item.status === 'failed' && (
          <IconButton label="Try again" onClick={onRetry}>
            <path d="M3 8a5 5 0 1 1 1.6 3.7" />
            <path d="M3 12V8.4h3.6" />
          </IconButton>
        )}

        <IconButton label="Remove" onClick={onRemove}>
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
        </IconButton>
      </div>
    </li>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className="no-drag shrink-0 rounded-[6px] p-1 text-ink-3 opacity-0 transition-opacity hover:bg-surface-sunken hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  )
}

import { useEffect, useMemo, useRef } from 'react'
import type { QueueItem } from '../types'
import { formatCount, formatDuration, renderMarkdown } from '../lib/markdown'

export type Tab = 'preview' | 'markdown'

interface Props {
  item: QueueItem
  tab: Tab
  onTabChange: (tab: Tab) => void
  onCopy: () => void
  onSave: () => void
  onRetry: () => void
  onEdit: (value: string) => void
}

export default function ResultPane({
  item,
  tab,
  onTabChange,
  onCopy,
  onSave,
  onRetry,
  onEdit,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null)

  const content = item.edited ?? item.markdown ?? ''
  const html = useMemo(
    () => (tab === 'preview' && content ? renderMarkdown(content) : ''),
    [tab, content],
  )

  // Switching documents should start at the top, not mid-scroll.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [item.id, tab])

  const ready = item.status === 'done'

  return (
    <section className="card-shadow flex h-full flex-col overflow-hidden rounded-panel border border-line bg-surface">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line-soft px-3.5 py-2.5">
        <div className="flex items-center gap-0.5 rounded-full bg-surface-sunken p-[3px]">
          <TabButton active={tab === 'markdown'} onClick={() => onTabChange('markdown')}>
            Markdown
          </TabButton>
          <TabButton active={tab === 'preview'} onClick={() => onTabChange('preview')}>
            Preview
          </TabButton>
        </div>

        <div className="flex items-center gap-3">
          {ready && (
            <span className="text-[11.5px] text-ink-3">
              {formatCount(item.chars ?? 0)} in {formatDuration(item.durationMs ?? 0)}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <Action onClick={onCopy} disabled={!ready}>
              Copy
            </Action>
            <Action onClick={onSave} disabled={!ready} primary>
              Save
            </Action>
          </div>
        </div>
      </header>

      <div
        ref={scroller}
        className={`min-h-0 flex-1 overflow-auto scroll-quiet ${
          tab === 'markdown' ? '' : 'px-10 py-9'
        }`}
      >
        {item.status === 'failed' ? (
          <Failure item={item} onRetry={onRetry} />
        ) : !ready ? (
          <Working item={item} />
        ) : tab === 'preview' ? (
          content.trim() ? (
            <article
              data-selectable
              className="prose-paper"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <NoContent item={item} />
          )
        ) : (
          <textarea
            value={content}
            spellCheck={false}
            onChange={(event) => onEdit(event.target.value)}
            className="block h-full w-full resize-none border-0 bg-transparent px-10 py-9 font-mono text-[12.5px] leading-[1.7] text-ink outline-none"
          />
        )}
      </div>
    </section>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`no-drag rounded-full px-3 py-[4px] text-[12px] transition-colors ${
        active
          ? 'bg-surface font-semibold text-ink shadow-[0_1px_2px_rgba(59,47,32,0.12)]'
          : 'font-medium text-ink-2 hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function Action({
  onClick,
  disabled,
  primary,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`no-drag rounded-full px-3 py-[5px] text-[12px] font-semibold transition-colors disabled:cursor-default disabled:opacity-35 ${
        primary
          ? 'bg-ink text-canvas hover:opacity-90'
          : 'border border-line text-ink-2 hover:bg-surface-hover hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function Working({ item }: { item: QueueItem }) {
  const message =
    item.status === 'queued'
      ? 'Waiting its turn'
      : item.stage === 'fetching'
        ? 'Fetching the page'
        : 'Reading the document'

  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex items-center gap-2.5 text-[13px] text-ink-2">
        <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-accent" />
        {message}
      </div>
    </div>
  )
}

function NoContent({ item }: { item: QueueItem }) {
  return (
    <div className="max-w-[52ch]">
      <p className="text-[14px] text-ink">
        {item.label} converted, but there was no text to extract.
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
        Images only carry text if they have EXIF metadata. Scanned pages need OCR, which this
        build doesn&rsquo;t include.
      </p>
    </div>
  )
}

function Failure({ item, onRetry }: { item: QueueItem; onRetry: () => void }) {
  return (
    <div className="max-w-[54ch]">
      <p className="text-[14px] font-semibold text-ink">{item.error?.message}</p>
      {item.error?.hint && (
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{item.error.hint}</p>
      )}
      <button
        type="button"
        onClick={onRetry}
        className="no-drag mt-5 rounded-full border border-line px-3.5 py-[6px] text-[12.5px] font-semibold text-ink transition-colors hover:bg-surface-hover"
      >
        Try again
      </button>
    </div>
  )
}

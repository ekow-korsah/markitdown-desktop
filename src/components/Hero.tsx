import { useState } from 'react'

interface Props {
  starting: boolean
  formats: Record<string, string[]>
  onAddUrl: (url: string) => void
  onBrowse: () => void
}

/**
 * The empty canvas: one headline, one input, and an honest answer to "what can
 * I put in here?". The format cards carry real data from the conversion
 * service rather than a hand-kept list that can drift.
 */
export default function Hero({ starting, formats, onAddUrl, onBrowse }: Props) {
  const [url, setUrl] = useState('')

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!url.trim()) return
    onAddUrl(url)
    setUrl('')
  }

  const groups = Object.entries(formats)

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto scroll-quiet px-8 py-10">
      <div className="w-full max-w-[620px]">
        <h2 className="text-center text-[32px] font-bold leading-[1.15] tracking-[-0.03em] text-ink">
          Turn anything into Markdown
        </h2>
        <p className="mt-2.5 text-center text-[13.5px] text-ink-2">
          Drop a file anywhere in this window, or paste a link below.
        </p>

        <form
          onSubmit={submit}
          className="card-shadow mt-7 rounded-panel border border-line bg-surface p-3.5"
        >
          <input
            type="text"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="Paste a link to a page or video"
            spellCheck={false}
            autoCorrect="off"
            // Arriving here (launch, or New) should leave you ready to type.
            autoFocus
            className="no-drag w-full bg-transparent px-1 py-1 text-[14px] text-ink placeholder:text-ink-3 focus:outline-none"
          />

          <div className="mt-3.5 flex items-center justify-between">
            <button
              type="button"
              onClick={onBrowse}
              disabled={starting}
              title="Choose files"
              aria-label="Choose files"
              className="no-drag rounded-full border border-line p-[7px] text-ink-2 transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-40"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 7.3 8.1 12.2a2.9 2.9 0 0 1-4.1-4.1l5-5a1.9 1.9 0 0 1 2.7 2.7l-5 5a.9.9 0 0 1-1.3-1.3l4.5-4.5" />
              </svg>
            </button>

            <button
              type="submit"
              disabled={!url.trim() || starting}
              className="no-drag rounded-full bg-ink px-4 py-[6px] text-[12.5px] font-semibold text-canvas transition-opacity hover:opacity-90 disabled:bg-surface-sunken disabled:text-ink-3 disabled:opacity-100"
            >
              Convert
            </button>
          </div>
        </form>

        {starting ? (
          <p className="mt-6 text-center text-[12.5px] text-ink-3">
            Starting the converter. The first launch takes a few seconds.
          </p>
        ) : (
          groups.length > 0 && (
            <>
              <p className="mt-9 mb-2.5 text-[10.5px] font-semibold tracking-[0.09em] text-ink-3">
                WHAT YOU CAN DROP
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                {groups.map(([name, extensions]) => (
                  <FormatCard key={name} name={name} extensions={extensions} />
                ))}
              </div>
            </>
          )
        )}
      </div>
    </div>
  )
}

function FormatCard({ name, extensions }: { name: string; extensions: string[] }) {
  return (
    <div className="rounded-card border border-line-soft bg-surface/70 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] bg-accent-wash text-accent">
          <GroupIcon name={name} />
        </span>
        <span className="text-[12.5px] font-semibold text-ink">{name}</span>
      </div>
      <p className="mt-1.5 truncate text-[11.5px] text-ink-3" title={extensions.join(', ')}>
        {extensions.slice(0, 5).join(', ').toUpperCase()}
        {extensions.length > 5 ? '…' : ''}
      </p>
    </div>
  )
}

function GroupIcon({ name }: { name: string }) {
  const stroke = {
    width: 13,
    height: 13,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  if (name.startsWith('Web')) {
    return (
      <svg {...stroke}>
        <circle cx="8" cy="8" r="5.6" />
        <path d="M2.4 8h11.2M8 2.4c1.5 1.6 2.2 3.5 2.2 5.6s-.7 4-2.2 5.6c-1.5-1.6-2.2-3.5-2.2-5.6S6.5 4 8 2.4z" />
      </svg>
    )
  }
  if (name === 'Images') {
    return (
      <svg {...stroke}>
        <rect x="2.4" y="3.2" width="11.2" height="9.6" rx="1.4" />
        <circle cx="6" cy="6.4" r="1" />
        <path d="M3.2 11.2l3-2.8 2.4 2 2-1.6 2.2 2" />
      </svg>
    )
  }
  if (name === 'Archives') {
    return (
      <svg {...stroke}>
        <path d="M2.4 5.6h11.2v6.2a1.2 1.2 0 0 1-1.2 1.2H3.6a1.2 1.2 0 0 1-1.2-1.2z" />
        <path d="M2.4 5.6 3.6 3h8.8l1.2 2.6M8 5.6v3" />
      </svg>
    )
  }
  if (name === 'Mail') {
    return (
      <svg {...stroke}>
        <rect x="2.4" y="3.6" width="11.2" height="8.8" rx="1.3" />
        <path d="m2.8 4.6 5.2 3.6 5.2-3.6" />
      </svg>
    )
  }
  if (name.startsWith('Notes')) {
    return (
      <svg {...stroke}>
        <path d="M3.6 3.6h8.8M3.6 6.8h8.8M3.6 10h5.6" />
      </svg>
    )
  }
  // Documents
  return (
    <svg {...stroke}>
      <path d="M4 2.6h4.6L12 6v7.4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3.6a1 1 0 0 1 1-1z" />
      <path d="M8.4 2.8V6H11.8" />
    </svg>
  )
}

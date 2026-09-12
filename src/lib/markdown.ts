import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ gfm: true, breaks: false })

/**
 * Render Markdown for the preview pane.
 *
 * The input came from an arbitrary file or web page, so it is untrusted and is
 * always sanitised before it reaches the DOM.
 */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false }) as string
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] })
}

/** "report.pdf" -> "report.md"; a URL -> a readable slug. */
export function suggestFilename(label: string, title?: string | null): string {
  const base = label.replace(/\.[^./\\]+$/, '').trim() || (title ?? 'converted')
  const safe = base
    .replace(/[/\\:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim()
  return `${safe || 'converted'}.md`
}

/** Turn a URL into something short enough for the queue rail. */
export function labelForUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/$/, '')
    const tail = path.split('/').filter(Boolean).pop()
    return tail ? decodeURIComponent(tail) : parsed.hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function basename(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath
}

export function formatCount(chars: number): string {
  if (chars < 1000) return `${chars} characters`
  return `${(chars / 1000).toFixed(chars < 10000 ? 1 : 0)}k characters`
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

/**
 * Owns the Python sidecar process and speaks its NDJSON protocol.
 *
 * The sidecar is a self-contained PyInstaller bundle; the user never installs
 * Python. One process is spawned at launch and reused for every conversion.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

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

export interface FormatInfo {
  groups: Record<string, string[]>
  all: string[]
}

type SidecarEvent =
  | { type: 'status'; state: 'starting' | 'ready' | 'warm' | 'crashed'; detail?: string }
  | { type: 'progress'; id: string; stage: string }

interface Pending {
  resolve: (value: any) => void
  reject: (error: ProtocolError) => void
}

/** Restart at most this many times before giving up and telling the user. */
const MAX_RESTARTS = 3

export class Sidecar {
  private proc: ChildProcess | null = null
  private stdoutBuffer = ''
  private nextId = 1
  private pending = new Map<string, Pending>()
  private restarts = 0
  private stopping = false

  constructor(private readonly emit: (event: SidecarEvent) => void) {}

  /** Locate the service: the packaged bundle, else the dev virtualenv. */
  private resolveCommand(): { cmd: string; args: string[]; cwd: string } {
    if (app.isPackaged) {
      const bin = path.join(process.resourcesPath, 'service', 'markitdown-service')
      return { cmd: bin, args: [], cwd: path.dirname(bin) }
    }

    const root = path.resolve(__dirname, '..')
    const serviceDir = path.join(root, 'service')
    const venvPython = path.join(serviceDir, '.venv', 'bin', 'python')
    if (existsSync(venvPython)) {
      // Preferred in dev: no rebuild needed after editing Python.
      return { cmd: venvPython, args: ['main.py'], cwd: serviceDir }
    }

    const built = path.join(serviceDir, 'dist', 'markitdown-service', 'markitdown-service')
    if (existsSync(built)) {
      return { cmd: built, args: [], cwd: path.dirname(built) }
    }

    throw new Error(
      'No Python service found. Run ./scripts/build-sidecar.sh (or create service/.venv) first.',
    )
  }

  start(): void {
    if (this.proc) return
    this.stopping = false

    let command: { cmd: string; args: string[]; cwd: string }
    try {
      command = this.resolveCommand()
    } catch (error) {
      this.emit({ type: 'status', state: 'crashed', detail: (error as Error).message })
      return
    }

    this.emit({ type: 'status', state: 'starting' })

    const proc = spawn(command.cmd, command.args, {
      cwd: command.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    })
    this.proc = proc

    proc.stdout?.setEncoding('utf8')
    proc.stdout?.on('data', (chunk: string) => this.onStdout(chunk))

    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (chunk: string) => {
      // The sidecar logs to stderr by design; surface it only in dev.
      if (!app.isPackaged) process.stderr.write(chunk)
    })

    proc.on('error', (error) => {
      this.emit({ type: 'status', state: 'crashed', detail: error.message })
    })

    proc.on('exit', (code, signal) => {
      this.proc = null
      this.failAllPending({
        kind: 'service_stopped',
        message: 'The conversion engine stopped unexpectedly.',
        hint: 'It will restart automatically — try again in a moment.',
      })
      if (this.stopping) return

      if (this.restarts < MAX_RESTARTS) {
        this.restarts += 1
        setTimeout(() => this.start(), 400)
      } else {
        this.emit({
          type: 'status',
          state: 'crashed',
          detail: `The conversion engine keeps stopping (exit ${code ?? signal}). Restarting the app may help.`,
        })
      }
    })
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    let index: number
    while ((index = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, index).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1)
      if (line) this.handleMessage(line)
    }
  }

  private handleMessage(line: string): void {
    let message: any
    try {
      message = JSON.parse(line)
    } catch {
      // stdout is reserved for the protocol, but never let a bad line take
      // the app down.
      console.warn('[sidecar] non-JSON on stdout:', line.slice(0, 200))
      return
    }

    if (message.event === 'ready') {
      this.restarts = 0
      this.emit({ type: 'status', state: 'ready' })
      return
    }

    if (message.event === 'warm') {
      this.emit({
        type: 'status',
        state: message.failed ? 'crashed' : 'warm',
        detail: message.failed ? 'The conversion engine failed to load.' : undefined,
      })
      return
    }

    if (message.event === 'progress') {
      this.emit({ type: 'progress', id: String(message.id), stage: message.stage })
      return
    }

    const id = String(message.id ?? '')
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)

    if (message.error) pending.reject(message.error as ProtocolError)
    else pending.resolve(message.result)
  }

  private failAllPending(error: ProtocolError): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  /** Send a request and await its terminal result. */
  private call<T>(method: string, params: Record<string, unknown> = {}, id?: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.proc?.stdin?.writable) {
        reject({
          kind: 'service_unavailable',
          message: 'The conversion engine isn’t running.',
          hint: 'Give it a moment to start, then try again.',
        })
        return
      }

      const requestId = id ?? String(this.nextId++)
      this.pending.set(requestId, { resolve, reject })
      this.proc.stdin.write(`${JSON.stringify({ id: requestId, method, params })}\n`)
    })
  }

  convertFile(path: string, id: string): Promise<ConversionResult> {
    return this.call<ConversionResult>('convert_file', { path }, id)
  }

  convertUrl(url: string, id: string): Promise<ConversionResult> {
    return this.call<ConversionResult>('convert_url', { url }, id)
  }

  formats(): Promise<FormatInfo> {
    return this.call<FormatInfo>('formats')
  }

  cancel(target: string): Promise<{ cancelled: boolean }> {
    return this.call<{ cancelled: boolean }>('cancel', { target })
  }

  stop(): void {
    this.stopping = true
    const proc = this.proc
    if (!proc) return
    this.proc = null
    try {
      // Closing stdin is the sidecar's cue to exit cleanly.
      proc.stdin?.end()
    } catch {
      /* already gone */
    }
    // Don't let a wedged process outlive the app.
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL')
    }, 1500).unref?.()
  }
}

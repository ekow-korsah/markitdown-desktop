/**
 * Dev runner: Vite dev server + esbuild watch + Electron, restarting Electron
 * whenever the main/preload bundles change.
 */
import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import esbuild from 'esbuild'
import electronPath from 'electron'

const server = await createServer({ server: { port: 5173, strictPort: true } })
await server.listen()
server.printUrls()

const url = server.resolvedUrls?.local?.[0]
if (!url) throw new Error('Vite did not report a local URL')

let child = null
let restarting = false

function startElectron() {
  child = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url, NODE_ENV: 'development' },
  })
  child.on('exit', (code) => {
    // A restart kills the child on purpose; only a real quit should end dev.
    if (restarting) return
    server.close()
    process.exit(code ?? 0)
  })
}

function restartElectron() {
  if (!child) return startElectron()
  restarting = true
  child.once('exit', () => {
    restarting = false
    startElectron()
  })
  child.kill()
}

const context = await esbuild.context({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  external: ['electron'],
  sourcemap: 'inline',
  logLevel: 'warning',
  plugins: [
    {
      name: 'restart-electron',
      setup(build) {
        let first = true
        build.onEnd((result) => {
          if (result.errors.length) return
          if (first) {
            first = false
            startElectron()
          } else {
            console.log('[dev] electron sources changed — restarting')
            restartElectron()
          }
        })
      },
    },
  ],
})

await context.watch()

const shutdown = () => {
  restarting = true
  child?.kill()
  server.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

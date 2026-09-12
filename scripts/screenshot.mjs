/**
 * Renders the real Electron window to PNGs for design review.
 *
 * Usage: node scripts/screenshot.mjs [outDir]
 * Converts the sample fixtures so the populated states are real output, not mocks.
 */
import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import esbuild from 'esbuild'
import electronPath from 'electron'

const outDir = path.resolve(process.argv[2] ?? 'screenshots')
const fixturesDir = path.resolve('assets/fixtures')

const available = (() => {
  try {
    return readdirSync(fixturesDir)
  } catch {
    return []
  }
})()

const fixtures = ['rich.html', 'sample.pdf', 'sample.xlsx', 'sample.pptx']
  .filter((name) => available.includes(name))
  .map((name) => path.join(fixturesDir, name))

// A deliberately missing file, so the failure state shows up in review too.
fixtures.push(path.join(fixturesDir, 'missing-report.pdf'))

await esbuild.build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  external: ['electron'],
  logLevel: 'warning',
})

const server = await createServer({ server: { port: 5174, strictPort: true } })
await server.listen()
const url = server.resolvedUrls?.local?.[0]

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: url,
    MARKITDOWN_CAPTURE: outDir,
    MARKITDOWN_CAPTURE_FILES: JSON.stringify(fixtures),
  },
})

child.on('exit', async (code) => {
  await server.close()
  console.log(`\nScreenshots in ${outDir}`)
  process.exit(code ?? 0)
})

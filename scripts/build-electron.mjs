/**
 * Bundles the Electron main and preload scripts with esbuild.
 *
 * Output is CommonJS with a .cjs extension: package.json sets "type": "module",
 * so a plain .js file would be treated as ESM, and the preload script in
 * particular must be CJS for contextBridge to work reliably.
 */
import esbuild from 'esbuild'

const watch = process.argv.includes('--watch')

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  external: ['electron'],
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
}

if (watch) {
  const context = await esbuild.context(options)
  await context.watch()
  console.log('[esbuild] watching electron/')
} else {
  await esbuild.build(options)
}

/**
 * Ad-hoc signs the packaged app.
 *
 * Apple Silicon refuses to execute any binary without at least an ad-hoc
 * signature, so "we have no Developer ID" still means "must be signed". Without
 * this the app is killed on launch with SIGKILL and no useful message.
 *
 * Signing is inside-out: the nested Python sidecar first, then the bundle.
 */
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)

  const sign = (target, extraArgs = []) =>
    execFileSync('codesign', ['--force', '--sign', '-', ...extraArgs, target], {
      stdio: 'pipe',
    })

  const sidecar = path.join(
    appPath,
    'Contents',
    'Resources',
    'service',
    'markitdown-service',
  )

  try {
    sign(sidecar)
  } catch (error) {
    console.warn(`[after-pack] could not sign sidecar: ${error.message}`)
  }

  // --deep is deprecated for real distribution signing but is the pragmatic way
  // to ad-hoc sign every nested framework and helper in one pass.
  sign(appPath, ['--deep'])

  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' })
  console.log(`[after-pack] ad-hoc signed ${appName}.app`)
}

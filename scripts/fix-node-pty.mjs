import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/**
 * Restore the executable bit on node-pty's `spawn-helper`.
 *
 * On macOS node-pty does not fork the shell itself — it execs a small helper
 * binary that sets up the controlling terminal first. pnpm unpacks the
 * published prebuild through its content-addressable store, which does not
 * preserve file modes, so the helper arrives as 0644 and *every* spawn fails
 * with a bare "posix_spawnp failed" that names nothing.
 *
 * Cheap to run, and idempotent, so it stays in postinstall rather than being
 * something to remember after each `pnpm install`.
 */

const require = createRequire(import.meta.url)

let packageRoot
try {
  packageRoot = dirname(require.resolve('node-pty/package.json'))
} catch {
  // node-pty is not installed (a docs-only checkout, say). Nothing to fix.
  process.exit(0)
}

const searchDirs = [join(packageRoot, 'prebuilds'), join(packageRoot, 'build', 'Release')]
const fixed = []

for (const dir of searchDirs) {
  if (!existsSync(dir)) continue

  const children = statSync(dir).isDirectory() ? readdirSync(dir) : []
  const candidates = [
    join(dir, 'spawn-helper'),
    ...children.map((child) => join(dir, child, 'spawn-helper'))
  ]

  for (const helper of candidates) {
    if (!existsSync(helper)) continue
    if (statSync(helper).mode & 0o111) continue
    chmodSync(helper, 0o755)
    fixed.push(helper)
  }
}

if (fixed.length > 0) {
  console.log(`node-pty: made ${fixed.length} spawn-helper binary(s) executable`)
}

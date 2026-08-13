import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { KeySlot, KeyStatus } from '@shared/types'
import { KEY_SLOTS } from '@shared/types'

/**
 * The Gemini API keys live here and nowhere else.
 *
 * One encrypted file per slot, all through the OS keychain (Keychain Services
 * on macOS) and read only inside the main process. There is deliberately no
 * IPC handler that returns a key — the renderer can learn *whether* a slot is
 * filled and nothing more, so a rogue script in the renderer has nothing to
 * exfiltrate.
 *
 * Keys are deliberately NOT in SQLite: the settings table is plaintext and the
 * backup exporter dumps it verbatim. A key that rode along in a backup file
 * would outlive every promise this module makes.
 */

const isSlot = (value: string): value is KeySlot =>
  (KEY_SLOTS as readonly string[]).includes(value)

function keyFile(slot: KeySlot): string {
  if (!isSlot(slot)) throw new Error(`Not a key slot: ${String(slot)}`)
  return join(app.getPath('userData'), `${slot}.key`)
}

/** Where the single pre-slot key lived. Renamed into `default` on first use. */
const legacyFile = (): string => join(app.getPath('userData'), 'gemini.key')

let migrated = false
function ensureMigrated(): void {
  if (migrated) return
  migrated = true
  try {
    const legacy = legacyFile()
    const target = keyFile('default')
    if (existsSync(legacy) && !existsSync(target)) {
      renameSync(legacy, target)
    }
  } catch {
    // The legacy file stays put and keeps not being read. Saving a key again
    // writes the new file; nothing is lost either way.
  }
}

export function keyStatus(slot: KeySlot = 'default'): KeyStatus {
  ensureMigrated()
  return {
    present: existsSync(keyFile(slot)),
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  }
}

export function setApiKey(raw: string, slot: KeySlot = 'default'): void {
  ensureMigrated()
  const key = raw.trim()
  if (!key) throw new Error('API key cannot be empty.')

  // Refuse to fall back to plaintext. A key on disk in the clear is worse than
  // no key at all, and the user should hear about it rather than be protected
  // by a promise we are not keeping.
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'The OS keychain is unavailable, so the key cannot be stored securely. Nothing was saved.'
    )
  }

  writeFileSync(keyFile(slot), safeStorage.encryptString(key), { mode: 0o600 })
}

/** Main-process only. Never expose this over IPC. */
export function getApiKey(slot: KeySlot = 'default'): string | null {
  ensureMigrated()
  const file = keyFile(slot)
  if (!existsSync(file)) return null
  try {
    return safeStorage.decryptString(readFileSync(file))
  } catch {
    // Keychain rotated, or the file was written on another machine.
    return null
  }
}

/**
 * The key a feature actually calls with.
 *
 * An empty slot falls back to `default`, so per-feature keys are an option and
 * never a requirement — one key in the default slot runs the whole app.
 */
export function requireApiKey(slot: KeySlot = 'default'): string {
  const key = getApiKey(slot) ?? getApiKey('default')
  if (!key) {
    throw new Error(
      'No Gemini API key is saved. Add one in Settings before generating.'
    )
  }
  return key
}

export function clearApiKey(slot: KeySlot = 'default'): void {
  ensureMigrated()
  const file = keyFile(slot)
  if (existsSync(file)) unlinkSync(file)
}

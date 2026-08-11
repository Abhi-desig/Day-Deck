import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { KeyStatus } from '@shared/types'

/**
 * The Gemini API key lives here and nowhere else.
 *
 * It is encrypted with the OS keychain (Keychain Services on macOS) and read
 * only inside the main process. There is deliberately no IPC handler that
 * returns it — the renderer can learn *whether* a key exists and nothing more,
 * so a rogue script in the renderer has nothing to exfiltrate.
 */
const keyFile = (): string => join(app.getPath('userData'), 'gemini.key')

export function keyStatus(): KeyStatus {
  return {
    present: existsSync(keyFile()),
    encryptionAvailable: safeStorage.isEncryptionAvailable()
  }
}

export function setApiKey(raw: string): void {
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

  writeFileSync(keyFile(), safeStorage.encryptString(key), { mode: 0o600 })
}

/** Main-process only. Never expose this over IPC. */
export function getApiKey(): string | null {
  const file = keyFile()
  if (!existsSync(file)) return null
  try {
    return safeStorage.decryptString(readFileSync(file))
  } catch {
    // Keychain rotated, or the file was written on another machine.
    return null
  }
}

export function requireApiKey(): string {
  const key = getApiKey()
  if (!key) {
    throw new Error(
      'No Gemini API key is saved. Add one in Goals Admin before generating a plan.'
    )
  }
  return key
}

export function clearApiKey(): void {
  const file = keyFile()
  if (existsSync(file)) unlinkSync(file)
}

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * One encrypted file per slot, every slot falling back to `default`, and the
 * legacy single-key file renamed in on first touch. `vi.resetModules` between
 * tests because the migration guard is once-per-process by design.
 */

let userData: string

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '')
  }
}))

async function freshSecrets() {
  vi.resetModules()
  return import('../src/main/services/secrets')
}

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'deck-keys-'))
})

afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

describe('key slots', () => {
  it('stores each slot in its own file', async () => {
    const secrets = await freshSecrets()
    secrets.setApiKey('default-key')
    secrets.setApiKey('scenes-key', 'scenes')

    expect(existsSync(join(userData, 'default.key'))).toBe(true)
    expect(existsSync(join(userData, 'scenes.key'))).toBe(true)
    expect(secrets.getApiKey()).toBe('default-key')
    expect(secrets.getApiKey('scenes')).toBe('scenes-key')
  })

  it('falls back to the default key for an empty slot', async () => {
    const secrets = await freshSecrets()
    secrets.setApiKey('the-one-key')

    expect(secrets.requireApiKey('agent')).toBe('the-one-key')
    expect(secrets.requireApiKey('prompts')).toBe('the-one-key')
  })

  it('prefers a slot key over the default once one is saved', async () => {
    const secrets = await freshSecrets()
    secrets.setApiKey('default-key')
    secrets.setApiKey('goals-key', 'goals')

    expect(secrets.requireApiKey('goals')).toBe('goals-key')
    // Clearing the slot puts it back on the default.
    secrets.clearApiKey('goals')
    expect(secrets.requireApiKey('goals')).toBe('default-key')
  })

  it('throws with no key anywhere', async () => {
    const secrets = await freshSecrets()
    expect(() => secrets.requireApiKey('agent')).toThrow(/no gemini api key/i)
  })

  it('refuses a slot name it does not know', async () => {
    const secrets = await freshSecrets()
    expect(() => secrets.getApiKey('sneaky' as never)).toThrow(/not a key slot/i)
  })
})

describe('the legacy key file', () => {
  it('is renamed into the default slot on first touch', async () => {
    // Written the way the old secrets.ts wrote it.
    writeFileSync(join(userData, 'gemini.key'), Buffer.from('enc:legacy-key'))

    const secrets = await freshSecrets()
    expect(secrets.getApiKey()).toBe('legacy-key')
    expect(existsSync(join(userData, 'gemini.key'))).toBe(false)
    expect(existsSync(join(userData, 'default.key'))).toBe(true)
  })

  it('leaves the legacy file alone when a default key already exists', async () => {
    writeFileSync(join(userData, 'gemini.key'), Buffer.from('enc:old'))
    writeFileSync(join(userData, 'default.key'), Buffer.from('enc:new'))

    const secrets = await freshSecrets()
    expect(secrets.getApiKey()).toBe('new')
    expect(existsSync(join(userData, 'gemini.key'))).toBe(true)
  })
})

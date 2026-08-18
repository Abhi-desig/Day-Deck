import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * One encrypted file per slot, and the legacy single-key file renamed in on
 * first touch. `vi.resetModules` between tests because the migration guard is
 * once-per-process by design.
 *
 * Falling an empty slot back to the default key is deliberately *not* tested
 * here any more: it stopped being a fact about storage the moment a slot could
 * be a different vendor from the default, because whether the fallback is even
 * valid now depends on the two providers agreeing. That lives in
 * providers.test.ts, next to the provider it has to agree with.
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

  it('reads back nothing for a slot that was never filled', async () => {
    const secrets = await freshSecrets()
    secrets.setApiKey('default-key')

    // No fallback here on purpose — this module answers "what is in this slot",
    // and nothing more. Deciding what an empty slot should do is elsewhere.
    expect(secrets.getApiKey('agent')).toBe(null)
    expect(secrets.getApiKey()).toBe('default-key')
  })

  it('clearing a slot empties that slot and nothing else', async () => {
    const secrets = await freshSecrets()
    secrets.setApiKey('default-key')
    secrets.setApiKey('goals-key', 'goals')

    expect(secrets.getApiKey('goals')).toBe('goals-key')
    secrets.clearApiKey('goals')
    expect(secrets.getApiKey('goals')).toBe(null)
    expect(secrets.getApiKey()).toBe('default-key')
  })

  it('gives every slot in the manifest a file of its own', async () => {
    // The manifest-completeness pattern: a slot that exists in KEY_SLOTS but
    // has no storage behind it is a feature nobody can give a key to, and
    // nobody would notice until the first call failed.
    const { KEY_SLOTS } = await import('../src/shared/types')
    const secrets = await freshSecrets()

    for (const slot of KEY_SLOTS) {
      secrets.setApiKey(`${slot}-key`, slot)
      expect(existsSync(join(userData, `${slot}.key`))).toBe(true)
      expect(secrets.getApiKey(slot)).toBe(`${slot}-key`)
    }
    // Image is the seventh, and the newest — video and image are deliberately
    // separate slots because they are two different bills.
    expect(KEY_SLOTS).toHaveLength(7)
    expect(KEY_SLOTS).toContain('image')
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

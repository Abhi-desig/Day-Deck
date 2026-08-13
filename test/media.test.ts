import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  net: { fetch: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  app: { getPath: () => '/tmp/day-deck-test' }
}))

const { itemIdFrom } = await import('../src/main/services/media')

/**
 * The deck-media scheme is the one place this app turns renderer input into a
 * filesystem read. It is built so that the URL carries an id and never a path,
 * which means these cases are the whole attack surface.
 */
describe('deck-media URL parsing', () => {
  it('accepts an item id', () => {
    const id = '3f1a6b2c-4d5e-6f70-8192-a3b4c5d6e7f8'
    expect(itemIdFrom(`deck-media://item/${id}`)).toBe(id)
  })

  it('tolerates a trailing slash and percent-encoding', () => {
    expect(itemIdFrom('deck-media://item/abc%2Ddef')).toBe('abc-def')
  })

  it('refuses another scheme wearing the right path', () => {
    expect(itemIdFrom('file://item/abc')).toBeNull()
    expect(itemIdFrom('http://item/abc')).toBeNull()
  })

  it('refuses a host that is not `item`', () => {
    expect(itemIdFrom('deck-media://file//etc/passwd')).toBeNull()
    expect(itemIdFrom('deck-media://anything/abc')).toBeNull()
  })

  it('refuses anything shaped like a path rather than an id', () => {
    // There is no path in a legitimate URL, so a separator means someone is
    // trying to address a file rather than a row.
    expect(itemIdFrom('deck-media://item/../../etc/passwd')).toBeNull()
    expect(itemIdFrom('deck-media://item/a/b')).toBeNull()
    expect(itemIdFrom('deck-media://item/%2e%2e%2fpasswd')).toBeNull()
    expect(itemIdFrom('deck-media://item/%2Fetc%2Fpasswd')).toBeNull()
  })

  it('refuses an empty id and unparseable junk', () => {
    expect(itemIdFrom('deck-media://item/')).toBeNull()
    expect(itemIdFrom('deck-media://item')).toBeNull()
    expect(itemIdFrom('not a url at all')).toBeNull()
    expect(itemIdFrom('')).toBeNull()
  })
})

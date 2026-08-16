import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  net: { fetch: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  app: { getPath: () => '/tmp/day-deck-test' }
}))

const { itemIdFrom, mediaRefFrom } = await import('../src/main/services/media')

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

/**
 * The second host, added for generated clips.
 *
 * A take is more dangerous than an item, not less: an item's path is looked up
 * from a row the user gestured at, where a take's path is *built* out of the id
 * in the URL. So the traversal cases are re-asserted for `take` rather than
 * assumed to be covered by the shared parser — that assumption is exactly the
 * kind that survives a refactor which splits the two apart.
 */
describe('deck-media take URLs', () => {
  const id = '3f1a6b2c-4d5e-6f70-8192-a3b4c5d6e7f8'

  it('accepts a take id and reports its host', () => {
    expect(mediaRefFrom(`deck-media://take/${id}`)).toEqual({
      host: 'take',
      id
    })
  })

  it('keeps the two hosts distinct', () => {
    expect(mediaRefFrom(`deck-media://item/${id}`)?.host).toBe('item')
    // itemIdFrom must not start answering for takes just because the parser is
    // shared — a take id is not a list item id and looking one up as the other
    // would be a lookup miss at best.
    expect(itemIdFrom(`deck-media://take/${id}`)).toBeNull()
  })

  it('refuses anything shaped like a path rather than an id', () => {
    expect(mediaRefFrom('deck-media://take/../../etc/passwd')).toBeNull()
    expect(mediaRefFrom('deck-media://take/a/b')).toBeNull()
    expect(mediaRefFrom('deck-media://take/%2e%2e%2fpasswd')).toBeNull()
    expect(mediaRefFrom('deck-media://take/%2Fetc%2Fpasswd')).toBeNull()
    expect(mediaRefFrom('deck-media://take/..%5Cwindows')).toBeNull()
  })

  it('refuses an empty id, a third host, and junk', () => {
    expect(mediaRefFrom('deck-media://take/')).toBeNull()
    expect(mediaRefFrom('deck-media://take')).toBeNull()
    expect(mediaRefFrom(`deck-media://cut/${id}`)).toBeNull()
    expect(mediaRefFrom(`file://take/${id}`)).toBeNull()
    expect(mediaRefFrom('')).toBeNull()
  })
})

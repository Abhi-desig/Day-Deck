import type { DeckApi } from '@shared/ipc-contract'

/**
 * `window.deck` is installed by the preload script. If it is missing the app is
 * running outside Electron (or the preload failed to load) and every call would
 * fail with a confusing "cannot read property of undefined" much later.
 */
function resolve(): DeckApi {
  const bridge = (window as unknown as { deck?: DeckApi }).deck
  if (!bridge) {
    throw new Error(
      'window.deck is unavailable — the preload bridge did not load.'
    )
  }
  return bridge
}

export const api: DeckApi = resolve()

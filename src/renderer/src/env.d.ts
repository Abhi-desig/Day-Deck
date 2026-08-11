/// <reference types="vite/client" />

import type { DeckApi } from '@shared/ipc-contract'

declare global {
  interface Window {
    deck: DeckApi
  }
}

export {}

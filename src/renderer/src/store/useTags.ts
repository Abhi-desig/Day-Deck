import { create } from 'zustand'
import { matchTags } from '@shared/tag-match'
import type { NewTag, Tag, TagPatch } from '@shared/types'
import { api } from '../lib/api'
import { useDeck } from './useDeck'

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

interface TagState {
  tags: Tag[]
  ready: boolean
  error: string | null

  load(): Promise<void>
  add(input: NewTag): Promise<Tag | null>
  patch(id: string, patch: TagPatch): Promise<void>
  remove(id: string): Promise<void>
  /** Manual attach/detach on a slot row. Both re-read the day they touched. */
  attach(slotId: string, tagId: string, date: string): Promise<void>
  detach(slotId: string, tagId: string, date: string): Promise<void>
  dismissError(): void
}

/**
 * Tags are loaded once at the shell, not per section.
 *
 * Three surfaces read them — the quick-add bar previews what a title will
 * match, slot rows render their chips, and the Tracker legend is built from
 * them — so a section-local load would mean the Today card showing tags that
 * the Tracker had not heard of yet.
 */
export const useTags = create<TagState>((set, get) => ({
  tags: [],
  ready: false,
  error: null,

  async load() {
    try {
      set({ tags: await api.tags.list(), ready: true, error: null })
    } catch (err) {
      set({ ready: true, error: message(err) })
    }
  },

  async add(input) {
    try {
      const tag = await api.tags.create(input)
      set((s) => ({ tags: [...s.tags, tag], error: null }))
      // A brand-new tag matches work that already exists, and main re-files it
      // on write — so the deck it is sitting on is stale the moment this
      // returns.
      await useDeck.getState().reloadAll()
      return tag
    } catch (err) {
      set({ error: message(err) })
      return null
    }
  },

  async patch(id, patch) {
    try {
      const saved = await api.tags.update(id, patch)
      set((s) => ({
        tags: s.tags.map((t) => (t.id === id ? saved : t)),
        error: null
      }))
      // Same reason as `add`: editing a keyword re-files every slot in the
      // database, so every card on screen is now out of date.
      if (patch.label !== undefined || patch.keywords !== undefined) {
        await useDeck.getState().reloadAll()
      }
    } catch (err) {
      set({ error: message(err) })
    }
  },

  async remove(id) {
    const previous = get().tags
    set({ tags: previous.filter((t) => t.id !== id) })
    try {
      await api.tags.remove(id)
      await useDeck.getState().reloadAll()
    } catch (err) {
      set({ tags: previous, error: message(err) })
    }
  },

  async attach(slotId, tagId, date) {
    try {
      await api.tags.attach(slotId, tagId, 'manual')
      await useDeck.getState().refreshDay(date)
    } catch (err) {
      set({ error: message(err) })
    }
  },

  async detach(slotId, tagId, date) {
    try {
      await api.tags.detach(slotId, tagId)
      await useDeck.getState().refreshDay(date)
    } catch (err) {
      set({ error: message(err) })
    }
  },

  dismissError() {
    set({ error: null })
  }
}))

/**
 * What a half-typed title would file itself under.
 *
 * Runs the same matcher main will run on write — see shared/tag-match for why
 * that has to be one implementation rather than two.
 */
export function previewTags(title: string, tags: Tag[]): Tag[] {
  if (!title.trim()) return []
  const ids = new Set(matchTags(title, tags).map((m) => m.tagId))
  return tags.filter((t) => ids.has(t.id))
}

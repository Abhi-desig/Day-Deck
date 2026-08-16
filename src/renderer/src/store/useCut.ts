import { create } from 'zustand'
import type {
  CutProposal,
  CutSegmentInput,
  RenderProgress,
  StoryCut,
  StoryCutSegment
} from '@shared/types'
import { api } from '../lib/api'

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

/**
 * The cut for the open board.
 *
 * Editing is deliberately "replace the whole list": reorder, trim and remove
 * are all edits to one ordered thing, and modelling them as three operations
 * would give `sortIndex` three ways to disagree with what is on screen.
 *
 * The local list is authoritative *during* a gesture and the store writes when
 * the gesture ends — the same rule the canvas already follows for dragging a
 * card, and for the same reason: each write is an IPC round trip.
 */
interface CutState {
  cut: StoryCut | null
  segments: StoryCutSegment[]
  /** Take id to its real length, read off the file. Beats the stored value. */
  lengths: Record<string, number>
  render: RenderProgress | null
  exporting: boolean
  error: string | null

  load(boardId: string): Promise<void>
  /** Write a new segment list. Called on gesture end, never per frame. */
  commit(boardId: string, segments: CutSegmentInput[]): Promise<void>
  populate(boardId: string): Promise<void>
  exportCut(boardId: string): Promise<void>
  setRender(progress: RenderProgress | null): void
  dismissError(): void

  /** The AI's suggestion, if one has been asked for and not yet answered. */
  proposal: CutProposal | null
  proposing: boolean
  propose(boardId: string, takeIds: string[]): Promise<void>
  /** Approve — the only path from a proposal to a row. */
  acceptProposal(boardId: string): Promise<void>
  discardProposal(): void
}

/** The stored duration is what was asked for; the file is what arrived. */
export const takeLength = (
  lengths: Record<string, number>,
  takeId: string,
  fallback: number
): number => lengths[takeId] ?? fallback

export const useCut = create<CutState>((set, get) => ({
  cut: null,
  segments: [],
  lengths: {},
  render: null,
  exporting: false,
  error: null,

  async load(boardId) {
    try {
      const { cut, segments } = await api.cut.get(boardId)
      set({ cut, segments, error: null })
      // Probing every take is several spawns, so it is deliberately not awaited
      // with the load — the timeline draws from the stored lengths and sharpens
      // when the real ones arrive.
      const lengths = await api.cut.measure(boardId)
      set({ lengths })
    } catch (err) {
      set({ error: message(err) })
    }
  },

  async commit(boardId, segments) {
    const previous = get().segments
    try {
      set({ segments: await api.cut.setSegments(boardId, segments) })
    } catch (err) {
      set({ segments: previous, error: message(err) })
    }
  },

  async populate(boardId) {
    try {
      set({ segments: await api.cut.populate(boardId), error: null })
    } catch (err) {
      set({ error: message(err) })
    }
  },

  async exportCut(boardId) {
    if (get().exporting) return
    set({ exporting: true, error: null, render: null })
    try {
      await api.cut.export(boardId)
    } catch (err) {
      set({ error: message(err) })
    } finally {
      set({ exporting: false })
    }
  },

  setRender(progress) {
    set({ render: progress })
  },

  dismissError() {
    set({ error: null })
  },

  proposal: null,
  proposing: false,

  async propose(boardId, takeIds) {
    if (get().proposing) return
    set({ proposing: true, error: null, proposal: null })
    try {
      set({ proposal: await api.cut.propose(boardId, takeIds) })
    } catch (err) {
      set({ error: message(err) })
    } finally {
      set({ proposing: false })
    }
  },

  async acceptProposal(boardId) {
    const proposal = get().proposal
    if (!proposal) return
    // Through the same `setSegments` the manual timeline writes with. An AI cut
    // is not a second write path; it is the same one, reached differently.
    await get().commit(
      boardId,
      proposal.segments.map(({ takeId, startSec, endSec }) => ({
        takeId,
        startSec,
        endSec
      }))
    )
    set({ proposal: null })
  },

  discardProposal() {
    set({ proposal: null })
  }
}))

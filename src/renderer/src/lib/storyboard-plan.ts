import type {
  PromptApply,
  ScenePlan,
  SceneApply,
  StoryFrame
} from '@shared/types'

/**
 * Reconciling a proposed plan against the board that already exists.
 *
 * Pure, and deliberately so: this is the logic the approval window is made of,
 * and the test harness here runs in node with no DOM, so anything living inside a
 * component cannot be tested at all. The window renders this; it does not decide
 * it.
 *
 * The pairing is positional. Scene 3 of the proposal lines up with scene 3 of the
 * board, because the model is told to preserve order and because there is no
 * identity to match on — a proposal is text, not rows. That makes the diff
 * predictable, which matters more here than being clever: the user is about to
 * approve it.
 */

export type SceneChange =
  | { kind: 'unchanged'; frameId: string; label: string; index: number }
  | {
      kind: 'rewrite'
      frameId: string
      label: string
      index: number
      /** The card's prompt was written by hand and would be overwritten. */
      handEdited: boolean
      before: Pick<StoryFrame, 'title' | 'description' | 'prompt' | 'durationSec'>
      after: ScenePlan
    }
  | { kind: 'add'; label: string; index: number; after: ScenePlan }
  | {
      kind: 'remove'
      frameId: string
      label: string
      index: number
      handEdited: boolean
    }

/**
 * True when the plan would change nothing about this card.
 *
 * Duration is included: re-costing a scene from 5s to 10s is a real change even
 * when every word stays the same.
 */
function isSame(frame: StoryFrame, scene: ScenePlan): boolean {
  return (
    frame.title.trim() === scene.title.trim() &&
    frame.description.trim() === scene.description.trim() &&
    frame.prompt.trim() === scene.prompt.trim() &&
    frame.durationSec === scene.durationSec
  )
}

/**
 * A prompt somebody typed is worth protecting.
 *
 * The signal is simply that a prompt exists. The planner is the only other thing
 * that writes this column, so a non-empty prompt on a card the planner is now
 * proposing to rewrite is either the user's own words or the planner's previous
 * answer — and both are worth a deliberate second look rather than a silent
 * overwrite.
 */
const isHandEdited = (frame: StoryFrame): boolean => frame.prompt.trim() !== ''

export function diffScenePlan(
  existing: readonly StoryFrame[],
  proposed: readonly ScenePlan[]
): SceneChange[] {
  const changes: SceneChange[] = []
  const overlap = Math.min(existing.length, proposed.length)

  for (let i = 0; i < overlap; i++) {
    const frame = existing[i]
    const scene = proposed[i]
    const label = scene.title.trim() || frame.title.trim() || `Scene ${i + 1}`

    if (isSame(frame, scene)) {
      changes.push({ kind: 'unchanged', frameId: frame.id, label, index: i })
      continue
    }

    changes.push({
      kind: 'rewrite',
      frameId: frame.id,
      label,
      index: i,
      handEdited: isHandEdited(frame),
      before: {
        title: frame.title,
        description: frame.description,
        prompt: frame.prompt,
        durationSec: frame.durationSec
      },
      after: scene
    })
  }

  for (let i = overlap; i < proposed.length; i++) {
    changes.push({
      kind: 'add',
      label: proposed[i].title.trim() || `Scene ${i + 1}`,
      index: i,
      after: proposed[i]
    })
  }

  for (let i = overlap; i < existing.length; i++) {
    const frame = existing[i]
    changes.push({
      kind: 'remove',
      frameId: frame.id,
      label: frame.title.trim() || `Scene ${i + 1}`,
      index: i,
      handEdited: isHandEdited(frame)
    })
  }

  return changes
}

/**
 * Which boxes start ticked.
 *
 * Everything the plan would do, except the two destructive cases: overwriting a
 * prompt somebody wrote, and deleting a card that has one. Those are opt-in. The
 * cost of leaving them unticked is one extra click; the cost of ticking them by
 * default is losing work to a button labelled "Apply".
 */
export function defaultSelection(changes: readonly SceneChange[]): Set<number> {
  const selected = new Set<number>()
  changes.forEach((change, i) => {
    if (change.kind === 'unchanged') return
    if (change.kind === 'rewrite' && change.handEdited) return
    if (change.kind === 'remove' && change.handEdited) return
    selected.add(i)
  })
  return selected
}

/**
 * The accepted subset, as writes.
 *
 * Deletes come last so that the frame indices the updates refer to are still the
 * ones the user was looking at when they approved. Applying a delete first would
 * renumber the board underneath the remaining changes.
 */
export function toApplies(
  changes: readonly SceneChange[],
  selected: ReadonlySet<number>
): SceneApply[] {
  const writes: SceneApply[] = []
  const deletes: SceneApply[] = []

  changes.forEach((change, i) => {
    if (!selected.has(i)) return
    if (change.kind === 'rewrite') {
      writes.push({ kind: 'update', frameId: change.frameId, scene: change.after })
    }
    if (change.kind === 'add') {
      writes.push({ kind: 'create', scene: change.after })
    }
    if (change.kind === 'remove') {
      deletes.push({ kind: 'delete', frameId: change.frameId })
    }
  })

  return [...writes, ...deletes]
}

/* ------------------------------------------------------- prompt stage */

/**
 * Stage two's diff: one row per scene, matched by frame id.
 *
 * By id and not by position — the proposal was made against the board as it
 * stood, and a board reordered mid-flight must still land every prompt on the
 * card it was written for. A frame the model skipped gets no row at all.
 */
export interface PromptChange {
  frameId: string
  label: string
  before: string
  after: string
  /** The card already has a prompt — overwriting it is opt-in. */
  handEdited: boolean
  /** The proposal matches what is already on the card. Nothing to do. */
  unchanged: boolean
}

export function diffPromptPlan(
  frames: readonly StoryFrame[],
  prompts: readonly { frameId: string; prompt: string }[]
): PromptChange[] {
  const proposed = new Map(prompts.map((p) => [p.frameId, p.prompt]))

  return frames.flatMap((frame, i) => {
    const after = proposed.get(frame.id)
    if (after === undefined) return []
    const before = frame.prompt
    return [
      {
        frameId: frame.id,
        label: frame.title.trim() || `Scene ${i + 1}`,
        before,
        after,
        handEdited: before.trim() !== '',
        unchanged: before.trim() === after.trim()
      }
    ]
  })
}

/**
 * Same rule as the scene stage: everything ticked except the destructive case.
 * A card that already has a prompt keeps it unless the user opts in.
 */
export function defaultPromptSelection(
  changes: readonly PromptChange[]
): Set<number> {
  const selected = new Set<number>()
  changes.forEach((change, i) => {
    if (change.unchanged) return
    if (change.handEdited) return
    selected.add(i)
  })
  return selected
}

export function toPromptApplies(
  changes: readonly PromptChange[],
  selected: ReadonlySet<number>
): PromptApply[] {
  return changes.flatMap((change, i) =>
    selected.has(i) && !change.unchanged
      ? [{ frameId: change.frameId, prompt: change.after }]
      : []
  )
}

export function summarisePrompts(
  changes: readonly PromptChange[],
  selected: ReadonlySet<number>
): string {
  let written = 0
  let overwritten = 0

  changes.forEach((change, i) => {
    if (!selected.has(i) || change.unchanged) return
    if (change.handEdited) overwritten += 1
    else written += 1
  })

  const parts: string[] = []
  if (written > 0) parts.push(`${written} written`)
  if (overwritten > 0) parts.push(`${overwritten} overwritten`)

  return parts.length === 0 ? 'Nothing selected' : parts.join(', ')
}

/** One line for the approval window's header. */
export function summariseChanges(
  changes: readonly SceneChange[],
  selected: ReadonlySet<number>
): string {
  let rewrites = 0
  let adds = 0
  let removes = 0

  changes.forEach((change, i) => {
    if (!selected.has(i)) return
    if (change.kind === 'rewrite') rewrites += 1
    if (change.kind === 'add') adds += 1
    if (change.kind === 'remove') removes += 1
  })

  const parts: string[] = []
  if (adds > 0) parts.push(`${adds} new`)
  if (rewrites > 0) parts.push(`${rewrites} rewritten`)
  if (removes > 0) parts.push(`${removes} removed`)

  return parts.length === 0 ? 'Nothing selected' : parts.join(', ')
}

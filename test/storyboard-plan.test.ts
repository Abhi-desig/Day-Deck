import { describe, expect, it } from 'vitest'
import type { ScenePlan, StoryFrame } from '../src/shared/types'
import {
  defaultPromptSelection,
  defaultSelection,
  diffPromptPlan,
  diffScenePlan,
  summariseChanges,
  summarisePrompts,
  toApplies,
  toPromptApplies
} from '../src/renderer/src/lib/storyboard-plan'

/**
 * The approval window is untestable here — node environment, no DOM — which is
 * exactly why the decision it renders lives in a pure module. These are the tests
 * that stand in for clicking through it.
 */

function frame(over: Partial<StoryFrame> = {}): StoryFrame {
  return {
    id: 'f1',
    boardId: 'b1',
    title: '',
    description: '',
    prompt: '',
    x: 0,
    y: 0,
    w: 300,
    h: 240,
    durationSec: null,
    color: 'amber',
    sortIndex: 0,
    createdAt: '2026-08-01T00:00:00Z',
    ...over
  }
}

function scene(over: Partial<ScenePlan> = {}): ScenePlan {
  return {
    title: 'Cold open',
    description: 'She steps off the train.',
    prompt: 'wide shot, 35mm, teal grade',
    durationSec: 6,
    ...over
  }
}

describe('diffing a plan against an empty board', () => {
  it('is all additions', () => {
    const changes = diffScenePlan([], [scene(), scene({ title: 'Second' })])

    expect(changes.map((c) => c.kind)).toEqual(['add', 'add'])
    expect(changes[1]).toMatchObject({ label: 'Second', index: 1 })
  })

  it('selects every addition by default', () => {
    const changes = diffScenePlan([], [scene(), scene()])
    expect(defaultSelection(changes).size).toBe(2)
  })
})

describe('diffing against a board that already has scenes', () => {
  it('leaves an identical scene alone', () => {
    const existing = [
      frame({
        id: 'f1',
        title: 'Cold open',
        description: 'She steps off the train.',
        prompt: 'wide shot, 35mm, teal grade',
        durationSec: 6
      })
    ]

    const changes = diffScenePlan(existing, [scene()])
    expect(changes).toEqual([
      { kind: 'unchanged', frameId: 'f1', label: 'Cold open', index: 0 }
    ])
    // Nothing to do means nothing ticked.
    expect(defaultSelection(changes).size).toBe(0)
  })

  it('counts a duration change alone as a rewrite', () => {
    const existing = [
      frame({
        title: 'Cold open',
        description: 'She steps off the train.',
        prompt: 'wide shot, 35mm, teal grade',
        durationSec: 6
      })
    ]

    // Re-costing a shot is a real change even when every word is the same.
    const changes = diffScenePlan(existing, [scene({ durationSec: 10 })])
    expect(changes[0].kind).toBe('rewrite')
  })

  it('ignores whitespace-only differences', () => {
    const existing = [
      frame({
        title: ' Cold open ',
        description: 'She steps off the train.',
        prompt: 'wide shot, 35mm, teal grade\n',
        durationSec: 6
      })
    ]

    expect(diffScenePlan(existing, [scene()])[0].kind).toBe('unchanged')
  })

  it('proposes removals when the plan is shorter than the board', () => {
    const existing = [
      frame({ id: 'f1', description: 'one' }),
      frame({ id: 'f2', title: 'Doomed', description: 'two' })
    ]

    const changes = diffScenePlan(existing, [scene()])
    expect(changes.map((c) => c.kind)).toEqual(['rewrite', 'remove'])
    expect(changes[1]).toMatchObject({ frameId: 'f2', label: 'Doomed' })
  })

  it('pairs positionally, then adds the surplus', () => {
    const existing = [frame({ id: 'f1' }), frame({ id: 'f2' })]
    const proposed = [scene(), scene(), scene(), scene()]

    const changes = diffScenePlan(existing, proposed)
    expect(changes.map((c) => c.kind)).toEqual([
      'rewrite',
      'rewrite',
      'add',
      'add'
    ])
  })

  it('falls back to the existing title when the plan does not name a scene', () => {
    const existing = [frame({ id: 'f1', title: 'Kept name' })]
    const changes = diffScenePlan(existing, [scene({ title: '' })])

    expect(changes[0].label).toBe('Kept name')
  })

  it('numbers an unnamed scene from one', () => {
    const changes = diffScenePlan([], [scene({ title: '' })])
    expect(changes[0].label).toBe('Scene 1')
  })
})

describe('protecting hand-written prompts', () => {
  it('flags a rewrite over an existing prompt', () => {
    const existing = [frame({ id: 'f1', prompt: 'my own careful wording' })]
    const changes = diffScenePlan(existing, [scene()])

    expect(changes[0]).toMatchObject({ kind: 'rewrite', handEdited: true })
  })

  it('does not tick a hand-edited rewrite by default', () => {
    const existing = [frame({ id: 'f1', prompt: 'my own careful wording' })]
    const changes = diffScenePlan(existing, [scene()])

    // One extra click, versus losing work to a button labelled "Apply".
    expect(defaultSelection(changes).has(0)).toBe(false)
  })

  it('does not tick the deletion of a card with a prompt', () => {
    const existing = [
      frame({ id: 'f1', description: 'one' }),
      frame({ id: 'f2', prompt: 'written by hand' })
    ]
    const changes = diffScenePlan(existing, [scene()])
    const selected = defaultSelection(changes)

    expect(changes[1]).toMatchObject({ kind: 'remove', handEdited: true })
    expect(selected.has(1)).toBe(false)
  })

  it('does tick a rewrite over an empty prompt', () => {
    const existing = [frame({ id: 'f1', prompt: '   ' })]
    const changes = diffScenePlan(existing, [scene()])

    expect(defaultSelection(changes).has(0)).toBe(true)
  })
})

describe('turning the selection into writes', () => {
  it('emits only what was ticked', () => {
    const changes = diffScenePlan([frame({ id: 'f1' })], [scene(), scene()])
    const applies = toApplies(changes, new Set([1]))

    expect(applies).toEqual([{ kind: 'create', scene: scene() }])
  })

  it('orders deletes after updates', () => {
    const existing = [
      frame({ id: 'f1', description: 'one' }),
      frame({ id: 'f2', description: 'two' }),
      frame({ id: 'f3', description: 'three' })
    ]
    const changes = diffScenePlan(existing, [scene()])
    const applies = toApplies(changes, new Set([0, 1, 2]))

    // A delete applied first would renumber the board under the updates that
    // were approved against the order the user was looking at.
    expect(applies.map((a) => a.kind)).toEqual(['update', 'delete', 'delete'])
    expect(applies[0]).toMatchObject({ frameId: 'f1' })
  })

  it('emits nothing for an empty selection', () => {
    const changes = diffScenePlan([], [scene()])
    expect(toApplies(changes, new Set())).toEqual([])
  })

  it('never emits a write for an unchanged scene', () => {
    const existing = [
      frame({
        id: 'f1',
        title: 'Cold open',
        description: 'She steps off the train.',
        prompt: 'wide shot, 35mm, teal grade',
        durationSec: 6
      })
    ]
    const changes = diffScenePlan(existing, [scene()])

    // Even if the caller ticks it, there is nothing to write.
    expect(toApplies(changes, new Set([0]))).toEqual([])
  })
})

describe('summarising for the header', () => {
  it('counts each kind of change', () => {
    const existing = [
      frame({ id: 'f1', description: 'one' }),
      frame({ id: 'f2', description: 'two' })
    ]
    const changes = diffScenePlan(existing, [scene(), scene(), scene()])
    const selected = defaultSelection(changes)

    expect(summariseChanges(changes, selected)).toBe('1 new, 2 rewritten')
  })

  it('says so when nothing is selected', () => {
    const changes = diffScenePlan([], [scene()])
    expect(summariseChanges(changes, new Set())).toBe('Nothing selected')
  })

  it('mentions removals', () => {
    const existing = [frame({ id: 'f1' }), frame({ id: 'f2' })]
    const changes = diffScenePlan(existing, [])

    expect(summariseChanges(changes, defaultSelection(changes))).toBe('2 removed')
  })
})

/* ------------------------------------------------------- prompt stage */

const promptFrames = [
  frame({ id: 'f1', title: 'Arrival', prompt: '' }),
  frame({ id: 'f2', title: '', prompt: 'my own words' }),
  frame({ id: 'f3', title: 'The key', prompt: '' })
]

describe('diffing a prompt plan', () => {
  it('matches by frame id, not by position', () => {
    // Deliberately out of board order.
    const changes = diffPromptPlan(promptFrames, [
      { frameId: 'f3', prompt: 'macro insert' },
      { frameId: 'f1', prompt: 'wide shot' }
    ])

    // Rows come out in board order regardless of proposal order.
    expect(changes.map((c) => c.frameId)).toEqual(['f1', 'f3'])
    expect(changes[0].after).toBe('wide shot')
    expect(changes[1].label).toBe('The key')
  })

  it('numbers an untitled scene by board position', () => {
    const changes = diffPromptPlan(promptFrames, [
      { frameId: 'f2', prompt: 'rewrite attempt' }
    ])
    expect(changes[0].label).toBe('Scene 2')
    expect(changes[0].handEdited).toBe(true)
  })

  it('drops a prompt for a frame that no longer exists', () => {
    const changes = diffPromptPlan(promptFrames, [
      { frameId: 'ghost', prompt: 'orphan' }
    ])
    expect(changes).toEqual([])
  })

  it('marks a proposal that changes nothing as unchanged', () => {
    const changes = diffPromptPlan(promptFrames, [
      { frameId: 'f2', prompt: 'my own words' }
    ])
    expect(changes[0].unchanged).toBe(true)
  })
})

describe('prompt default selection and writes', () => {
  it('ticks empty cards, leaves cards with a prompt unticked', () => {
    const changes = diffPromptPlan(promptFrames, [
      { frameId: 'f1', prompt: 'wide shot' },
      { frameId: 'f2', prompt: 'rewrite attempt' },
      { frameId: 'f3', prompt: 'macro insert' }
    ])
    const selected = defaultPromptSelection(changes)

    // f2 has a prompt someone wrote; losing it must be opt-in.
    expect(selected).toEqual(new Set([0, 2]))
    expect(toPromptApplies(changes, selected)).toEqual([
      { frameId: 'f1', prompt: 'wide shot' },
      { frameId: 'f3', prompt: 'macro insert' }
    ])
  })

  it('never writes an unchanged row, even if ticked', () => {
    const changes = diffPromptPlan(promptFrames, [
      { frameId: 'f2', prompt: 'my own words' }
    ])
    expect(toPromptApplies(changes, new Set([0]))).toEqual([])
  })

  it('summarises writes and overwrites separately', () => {
    const changes = diffPromptPlan(promptFrames, [
      { frameId: 'f1', prompt: 'wide shot' },
      { frameId: 'f2', prompt: 'rewrite attempt' }
    ])
    expect(summarisePrompts(changes, new Set([0, 1]))).toBe(
      '1 written, 1 overwritten'
    )
    expect(summarisePrompts(changes, new Set())).toBe('Nothing selected')
  })
})

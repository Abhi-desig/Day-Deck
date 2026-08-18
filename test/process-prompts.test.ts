import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeDb, type TestDb } from './helpers'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/day-deck-test' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

const {
  LIMIT_BOUNDS,
  MAX_RULES,
  PROCESS_DEFAULTS,
  PROCESS_GROUPS,
  PROCESS_IDS,
  fillVars,
  renderRules
} = await import('../src/shared/processes')
const { resolveProcess, setProcess, resetProcess, isModified, listProcesses } =
  await import('../src/main/services/processes')
const { OMNI_DURATIONS } = await import('../src/shared/types')

let db: TestDb

beforeEach(() => {
  db = makeDb()
})

/**
 * The manifest-completeness pattern, from `backup.test.ts`, for the same
 * reason: a process missing from the table is a process nobody can configure
 * and nobody will notice is missing.
 */
describe('the process table', () => {
  it('has defaults for every id, keyed by that id', () => {
    for (const id of PROCESS_IDS) {
      expect(PROCESS_DEFAULTS[id]).toBeDefined()
      expect(PROCESS_DEFAULTS[id].id).toBe(id)
    }
    expect(Object.keys(PROCESS_DEFAULTS).sort()).toEqual([...PROCESS_IDS].sort())
  })

  it('files every process into exactly one group', () => {
    const grouped = PROCESS_GROUPS.flatMap((g) => g.ids)
    expect([...grouped].sort()).toEqual([...PROCESS_IDS].sort())
    expect(new Set(grouped).size).toBe(grouped.length)
  })

  it('gives every process a role, at least one rule, and a slot', () => {
    for (const id of PROCESS_IDS) {
      const spec = PROCESS_DEFAULTS[id]
      expect(spec.role.trim()).not.toBe('')
      expect(spec.rules.length).toBeGreaterThan(0)
      expect(spec.slot).toBeTruthy()
      expect(spec.where.trim()).not.toBe('')
    }
  })

  it('names every renderable length in the scene planner’s rules', () => {
    // The one piece of stored prose with a constant behind it. OMNI_DURATIONS
    // decides what can actually be rendered; these rules have to name the same
    // set, or a length is offered with no guidance or guidance is given for a
    // length nothing can render. Caught here rather than by a board full of
    // scenes nobody can generate.
    const rules = PROCESS_DEFAULTS['board.scenes'].rules
      .map((r) => r.text)
      .join('\n')
    for (const seconds of OMNI_DURATIONS) {
      expect(rules).toContain(`${seconds}s:`)
      expect(rules).toContain(String(seconds))
    }
  })
})

/**
 * "No behaviour change on first run" is not a claim this file can make on its
 * own — the prompt-builder suites are what prove it, because they assert the
 * built text and they still pass with that text coming from here. What this
 * block proves is the other half: the defaults are what those builders read.
 */
describe('resolving with nothing saved', () => {
  it('returns the defaults untouched', () => {
    for (const id of PROCESS_IDS) {
      expect(resolveProcess(db, id)).toEqual(PROCESS_DEFAULTS[id])
      expect(isModified(db, id)).toBe(false)
    }
  })

  it('renders the rules with the heading each prompt actually uses', () => {
    // Two spellings in the app today, kept rather than unified — unifying them
    // would be a behaviour change nobody asked for.
    expect(renderRules(PROCESS_DEFAULTS['day.agent'])[0]).toBe('Rules:')
    expect(renderRules(PROCESS_DEFAULTS['board.prompts'])[0]).toBe('RULES:')
  })

  it('keeps an indented rule as a continuation instead of bulleting it', () => {
    const lines = renderRules(PROCESS_DEFAULTS['board.scenes'])
    expect(lines).toContain(
      '  - 4s: a single beat — a look, a cut-in, a reveal, one gesture'
    )
    expect(lines).not.toContain(
      '-   - 4s: a single beat — a look, a cut-in, a reveal, one gesture'
    )
  })
})

describe('placeholders', () => {
  it('substitutes the ones a process declares', () => {
    expect(fillVars('about {minutesPerDay} minutes', { minutesPerDay: 90 })).toBe(
      'about 90 minutes'
    )
  })

  it('leaves an unknown name alone rather than throwing', () => {
    // A rule with a typo in it should read oddly. It must not be able to fail a
    // call from Settings.
    expect(fillVars('about {nonsense} minutes', { minutesPerDay: 90 })).toBe(
      'about {nonsense} minutes'
    )
  })

  it('declares every placeholder its own rules use', () => {
    for (const id of PROCESS_IDS) {
      const spec = PROCESS_DEFAULTS[id]
      const used = new Set<string>()
      for (const rule of spec.rules) {
        for (const m of rule.text.matchAll(/\{(\w+)\}/g)) used.add(m[1])
      }
      for (const name of used) {
        expect(spec.vars ?? []).toContain(name)
      }
    }
  })
})

describe('an override', () => {
  it('lands in the resolved spec and marks the process modified', () => {
    setProcess(db, 'board.prompts', { role: 'You are a haiku poet.' })

    expect(resolveProcess(db, 'board.prompts').role).toBe('You are a haiku poet.')
    expect(isModified(db, 'board.prompts')).toBe(true)
    // And nothing else moves.
    expect(resolveProcess(db, 'board.scenes')).toEqual(
      PROCESS_DEFAULTS['board.scenes']
    )
  })

  it('falls back to the default role when the override is blank', () => {
    // An empty instruction is not a customisation, it is a broken call.
    setProcess(db, 'board.prompts', { role: '   ' })
    expect(resolveProcess(db, 'board.prompts').role).toBe(
      PROCESS_DEFAULTS['board.prompts'].role
    )
  })

  it('replaces the rules and drops blank lines', () => {
    setProcess(db, 'board.cut', { rules: ['Only one rule', '', '   '] })
    const rules = resolveProcess(db, 'board.cut').rules.map((r) => r.text)
    expect(rules).toContain('Only one rule')
    expect(rules).not.toContain('')
  })

  it('caps how many rules and how long each one may be', () => {
    setProcess(db, 'board.cut', {
      rules: Array.from({ length: MAX_RULES + 20 }, (_, i) => `rule ${i} ${'x'.repeat(900)}`)
    })
    const rules = resolveProcess(db, 'board.cut').rules
    // The pinned defaults are added back on top of the cap, so the ceiling is
    // on what the *user* supplied, not on the result.
    expect(rules.length).toBeLessThanOrEqual(MAX_RULES + 4)
    for (const rule of rules) expect(rule.text.length).toBeLessThanOrEqual(600)
  })

  it('resets back to the default and stops being modified', () => {
    setProcess(db, 'style.sort', { role: 'nonsense' })
    expect(resetProcess(db, 'style.sort')).toEqual(PROCESS_DEFAULTS['style.sort'])
    expect(resolveProcess(db, 'style.sort')).toEqual(PROCESS_DEFAULTS['style.sort'])
    expect(isModified(db, 'style.sort')).toBe(false)
  })

  it('degrades to the default when the stored JSON is unreadable', () => {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('process.board.cut', '{not json')`
    ).run()
    expect(resolveProcess(db, 'board.cut')).toEqual(PROCESS_DEFAULTS['board.cut'])
  })
})

/**
 * The pin is what stops a feature breaking the app from Settings. Editing
 * *"Return each prompt with its scene number"* out of the rules while
 * `parsePrompts` still keys on the scene number is exactly that.
 */
describe('pinned rules', () => {
  it('survives an override that tries to drop it', () => {
    setProcess(db, 'board.prompts', { rules: ['Just write something nice.'] })
    const rules = resolveProcess(db, 'board.prompts').rules

    const pinnedDefaults = PROCESS_DEFAULTS['board.prompts'].rules.filter(
      (r) => r.pinned
    )
    expect(pinnedDefaults.length).toBeGreaterThan(0)
    for (const rule of pinnedDefaults) {
      expect(rules.some((r) => r.text === rule.text)).toBe(true)
    }
  })

  it('can still be reworded in place', () => {
    const defaults = PROCESS_DEFAULTS['board.prompts'].rules
    const reworded = defaults.map((r, i) =>
      i === defaults.length - 1 ? 'Give me the scene number with each prompt.' : r.text
    )
    setProcess(db, 'board.prompts', { rules: reworded })

    const rules = resolveProcess(db, 'board.prompts').rules.map((r) => r.text)
    expect(rules).toContain('Give me the scene number with each prompt.')
    // Reworded, not duplicated — the original does not come back beside it.
    expect(rules).not.toContain('Return each prompt with its scene number.')
  })
})

/**
 * The clamps matter more than they look. These numbers carry reasoning that
 * cost real debugging, and their failure modes point somewhere else entirely:
 * `output: 100` buys truncated JSON and a parse error with no clue why.
 */
describe('limit clamps', () => {
  it('pulls an absurd output back inside the range', () => {
    setProcess(db, 'board.prompts', { limits: { output: 12 } })
    const limits = resolveProcess(db, 'board.prompts').limits
    expect(limits.output).toBe(LIMIT_BOUNDS.output.min)
  })

  it('never lets minOutput exceed output', () => {
    setProcess(db, 'board.prompts', { limits: { output: 1_024, minOutput: 60_000 } })
    const limits = resolveProcess(db, 'board.prompts').limits
    expect(limits.minOutput).toBeLessThanOrEqual(limits.output)
  })

  it('never lets thinking eat the whole ceiling', () => {
    // `output` caps thinking and answer together, so a thinking budget at or
    // above it leaves the answer nowhere to go.
    setProcess(db, 'board.prompts', { limits: { output: 1_024, thinking: 30_000 } })
    const limits = resolveProcess(db, 'board.prompts').limits
    expect(limits.thinking).toBeLessThan(limits.output)
  })

  it('keeps the batch inside a range a balance can carry', () => {
    setProcess(db, 'board.prompts', { limits: { batch: 500 } })
    expect(resolveProcess(db, 'board.prompts').limits.batch).toBe(
      LIMIT_BOUNDS.batch.max
    )
    setProcess(db, 'board.prompts', { limits: { batch: 0 } })
    expect(resolveProcess(db, 'board.prompts').limits.batch).toBe(
      LIMIT_BOUNDS.batch.min
    )
  })

  it('does not invent a batch for a process that has none', () => {
    setProcess(db, 'style.sort', { limits: { batch: 9 } })
    expect(resolveProcess(db, 'style.sort').limits.batch).toBeUndefined()
  })

  it('ignores a limit that is not a number', () => {
    setProcess(db, 'board.cut', {
      limits: { output: 'lots' as unknown as number }
    })
    expect(resolveProcess(db, 'board.cut').limits.output).toBe(
      PROCESS_DEFAULTS['board.cut'].limits.output
    )
  })

  it('leaves an image process’s zero token budget at zero', () => {
    // An image call has no token budget. Clamping 0 up to the minimum would
    // invent a ceiling for a request that has none.
    expect(resolveProcess(db, 'cast.portrait').limits.output).toBe(0)
    setProcess(db, 'cast.portrait', { limits: { timeoutMs: 90_000 } })
    const limits = resolveProcess(db, 'cast.portrait').limits
    expect(limits.output).toBe(0)
    expect(limits.timeoutMs).toBe(90_000)
  })
})

describe('the panel’s listing', () => {
  it('returns every process with its modified flag', () => {
    setProcess(db, 'day.agent', { role: 'changed' })
    const listed = listProcesses(db)

    expect(listed).toHaveLength(PROCESS_IDS.length)
    expect(listed.find((p) => p.spec.id === 'day.agent')?.modified).toBe(true)
    expect(listed.find((p) => p.spec.id === 'board.cut')?.modified).toBe(false)
  })
})

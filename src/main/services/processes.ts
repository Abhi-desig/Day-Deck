import {
  LIMIT_BOUNDS,
  MAX_ROLE_CHARS,
  MAX_RULES,
  MAX_RULE_CHARS,
  PROCESS_DEFAULTS,
  PROCESS_IDS,
  type ProcessId,
  type ProcessLimits,
  type ProcessRule,
  type ProcessSpec
} from '@shared/processes'
import type { Db } from '../db'
import { getSetting, setSetting } from '../db/settings'

/**
 * Reading a process's prompt back, with the user's edits merged in.
 *
 * The merge is the easy half. The half that matters is the **validation**, and
 * it is not defensive tidiness: these numbers carry reasoning that cost real
 * debugging, and a Settings panel that can set them freely is a Settings panel
 * that can break generation in ways whose error messages point somewhere else
 * entirely.
 *
 * - An empty role falls back to the default. An empty instruction is not a
 *   customisation, it is a broken call.
 * - Rules are trimmed and capped, and a **pinned** rule cannot be removed —
 *   only reworded. Editing *"Return each prompt with its scene number"* out of
 *   the list while `parsePrompts` still keys on the scene number is a feature
 *   that breaks the app from Settings.
 * - Limits are clamped. `output: 100` otherwise buys truncated JSON and a parse
 *   error with no clue why, and a `batch` of fifteen reproduces exactly the
 *   credit refusal that `PROMPT_BATCH = 4` exists to have fixed.
 */

export const SETTING_PROCESS = (id: ProcessId): string => `process.${id}`

/** What an override may say. Everything else about a spec is not the user's. */
interface ProcessOverride {
  role?: string
  rules?: string[]
  limits?: Partial<ProcessLimits>
}

const clamp = (value: number, min: number, max: number): number =>
  Math.round(Math.min(max, Math.max(min, value)))

function readOverride(db: Db, id: ProcessId): ProcessOverride | null {
  const raw = getSetting(db, SETTING_PROCESS(id))
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as ProcessOverride) : null
  } catch {
    // A hand-edited or corrupt row degrades to the default rather than taking
    // the whole panel — and the whole feature — down with it.
    return null
  }
}

/**
 * Merge the user's rules over the defaults, keeping every pinned rule.
 *
 * Matched by position, which is the only identity a rule has: the user edits a
 * list, and a reworded pinned rule at index 6 is still the rule the parser
 * depends on. Any pinned default the override dropped is appended back, so
 * removing one is impossible however the JSON is written.
 */
function mergeRules(
  defaults: readonly ProcessRule[],
  edited: string[] | undefined
): ProcessRule[] {
  if (!Array.isArray(edited)) return defaults.map((rule) => ({ ...rule }))

  const kept = edited
    .filter((text): text is string => typeof text === 'string')
    .map((text) => text.slice(0, MAX_RULE_CHARS).trimEnd())
    // A blank line is a rule the user deleted by clearing it, which is the
    // gesture a textarea makes available whether or not there is a button.
    .filter((text) => text.trim() !== '')
    .slice(0, MAX_RULES)
    .map((text, i) => ({ text, pinned: defaults[i]?.pinned }))

  const missing = defaults.filter(
    (rule, i) => rule.pinned && !kept[i]?.pinned
  )
  // Only the pinned ones that genuinely lost their slot come back, and they go
  // at the end rather than being spliced into a list the user has reordered.
  const present = new Set(kept.map((rule) => rule.text))
  return [
    ...kept.map((rule) => (rule.pinned ? { text: rule.text, pinned: true } : { text: rule.text })),
    ...missing
      .filter((rule) => !present.has(rule.text))
      .map((rule) => ({ ...rule }))
  ]
}

function mergeLimits(
  defaults: ProcessLimits,
  edited: Partial<ProcessLimits> | undefined
): ProcessLimits {
  const pick = (key: keyof ProcessLimits): number => {
    const value = edited?.[key]
    const fallback = defaults[key] ?? 0
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
    const bounds = LIMIT_BOUNDS[key]
    return clamp(value, bounds.min, bounds.max)
  }

  const limits: ProcessLimits = {
    timeoutMs: pick('timeoutMs'),
    output: defaults.output === 0 ? 0 : pick('output'),
    minOutput: defaults.minOutput === 0 ? 0 : pick('minOutput'),
    thinking: pick('thinking'),
    ...(defaults.batch === undefined ? {} : { batch: pick('batch') })
  }

  // The three-way relationship, enforced after the individual clamps because it
  // is a fact about the request rather than about any one field. `output` caps
  // thinking and answer *together*, so a thinking budget above it means the
  // answer has nowhere to go, and a floor above the ceiling means every retreat
  // to fit a thin balance is refused before it is tried.
  if (limits.output > 0) {
    limits.thinking = Math.min(limits.thinking, Math.floor(limits.output / 2))
    limits.minOutput = Math.min(limits.minOutput, limits.output)
  }

  return limits
}

/** One process, defaults merged with whatever the user saved and validated. */
export function resolveProcess(db: Db, id: ProcessId): ProcessSpec {
  const defaults = PROCESS_DEFAULTS[id]
  const override = readOverride(db, id)
  if (!override) return defaults

  const role =
    typeof override.role === 'string' && override.role.trim()
      ? override.role.slice(0, MAX_ROLE_CHARS).trim()
      : defaults.role

  return {
    ...defaults,
    role,
    rules: mergeRules(defaults.rules, override.rules),
    limits: mergeLimits(defaults.limits, override.limits)
  }
}

export const isModified = (db: Db, id: ProcessId): boolean =>
  readOverride(db, id) !== null

/** Every process, resolved, for the Settings panel. */
export function listProcesses(db: Db): {
  spec: ProcessSpec
  modified: boolean
}[] {
  return PROCESS_IDS.map((id) => ({
    spec: resolveProcess(db, id),
    modified: isModified(db, id)
  }))
}

/**
 * Save an override, then read it straight back through the resolver.
 *
 * Returning the *resolved* spec rather than what was sent is deliberate: the
 * clamps are the point, and a panel that showed the number the user typed while
 * the app used a different one would be the worst of both.
 */
export function setProcess(
  db: Db,
  id: ProcessId,
  override: ProcessOverride
): ProcessSpec {
  setSetting(
    db,
    SETTING_PROCESS(id),
    JSON.stringify({
      role: typeof override.role === 'string' ? override.role : undefined,
      rules: Array.isArray(override.rules) ? override.rules : undefined,
      limits:
        override.limits && typeof override.limits === 'object'
          ? override.limits
          : undefined
    })
  )
  return resolveProcess(db, id)
}

export function resetProcess(db: Db, id: ProcessId): ProcessSpec {
  db.prepare(`DELETE FROM settings WHERE key = ?`).run(SETTING_PROCESS(id))
  return PROCESS_DEFAULTS[id]
}

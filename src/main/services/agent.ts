import type { DateKey } from '@shared/date'
import { formatMinutes, labelFor } from '@shared/date'
import type {
  AgentMessage,
  AgentReply,
  Curriculum,
  GoalNote,
  Slot
} from '@shared/types'
import type { Db } from '../db'
import * as repo from '../db/curriculum'
import * as slotsRepo from '../db/slots'
import { askAgent } from './gemini'
import { requireApiKey } from './secrets'

/**
 * The day-card assistant.
 *
 * Its whole design is the context it is handed. The model is never asked to
 * plan, schedule or recommend — Goals Admin owns all three — only to explain
 * what is already on a day. So this file's real job is assembling an exact,
 * closed description of one day, and refusing to call out at all when there is
 * nothing goal-backed on it to explain.
 */

/** Curriculum text per goal. Enough to ground an answer, not the whole paste. */
const EXCERPT_CHARS = 1_500

/** Turns kept from the conversation. Older ones fall off the front. */
const HISTORY_TURNS = 8

/** Answer length is capped by the prompt; this is the guard on the question. */
const MAX_QUESTION = 600

interface DayFacts {
  date: DateKey
  slots: Slot[]
  notes: GoalNote[]
  /** Only the goals with work on this day, in the order their work appears. */
  goals: Curriculum[]
}

/**
 * Read the day once.
 *
 * Only the goals with work on *this* day are collected. A card that pulled in
 * every active goal would let the assistant answer Tuesday's question with
 * Thursday's material, which is the subtler version of the failure this whole
 * feature is meant to avoid.
 */
function readDay(db: Db, date: DateKey): DayFacts {
  const [card] = slotsRepo.listRange(db, date, date)
  const slots = card?.slots ?? []

  const goals: Curriculum[] = []
  const seen = new Set<string>()

  for (const slot of slots) {
    if (slot.source !== 'curriculum' || !slot.sourceRef) continue
    const topic = repo.getTopic(db, slot.sourceRef)
    if (!topic || seen.has(topic.curriculumId)) continue
    seen.add(topic.curriculumId)
    const goal = repo.getById(db, topic.curriculumId)
    if (goal) goals.push(goal)
  }

  return { date, slots, notes: card?.notes ?? [], goals }
}

function describeSlot(slot: Slot, index: number): string {
  const when =
    slot.startMin === null ? 'anytime' : `at ${formatMinutes(slot.startMin)}`
  const status =
    slot.status === 'done'
      ? 'already done'
      : slot.status === 'rolled'
        ? 'moved to another day'
        : slot.status === 'skipped'
          ? 'skipped'
          : 'still open'

  const lines = [
    `${index}. "${slot.title}" — ${when}, ${slot.durationMin} minutes, ${status}`
  ]

  if (slot.sourceLabel) lines.push(`   part of the goal: ${slot.sourceLabel}`)
  if (slot.note) lines.push(`   done when: ${slot.note}`)

  if (slot.sourcePoints.length > 0) {
    lines.push('   learning points:')
    for (const point of slot.sourcePoints) lines.push(`     - ${point}`)
  } else if (slot.source === 'curriculum') {
    lines.push('   learning points: not broken down yet')
  }

  return lines.join('\n')
}

function describeNote(note: GoalNote): string {
  const learned = note.learnedDate
    ? (() => {
        const l = labelFor(note.learnedDate)
        return ` (first learned ${l.weekday}, ${l.month} ${l.dayNum})`
      })()
    : ''
  const goal = note.goalTitle ? `[${note.goalTitle}] ` : ''
  return `- ${goal}${note.body}${learned}`
}

/** Everything the model may draw on, and nothing else. */
function renderContext(facts: DayFacts): string {
  const label = labelFor(facts.date)
  const lines = [
    `DATE: ${label.weekday}, ${label.month} ${label.dayNum} ${label.year} (${label.relative.toLowerCase()})`
  ]

  if (facts.goals.length > 0) {
    lines.push('', 'GOALS IN PLAY TODAY:')
    for (const goal of facts.goals) {
      const deadline = labelFor(goal.deadline)
      lines.push(
        `- "${goal.title}" — ${goal.minutesPerDay} minutes a day, deadline ${deadline.month} ${deadline.dayNum} ${deadline.year}`,
        '  the curriculum this goal was built from:',
        '  """',
        `  ${goal.rawText.slice(0, EXCERPT_CHARS).replace(/\n/g, '\n  ')}`,
        '  """'
      )
    }
  }

  lines.push('', "THIS DAY'S TASKS:")
  if (facts.slots.length === 0) {
    lines.push('(nothing planned)')
  } else {
    facts.slots.forEach((slot, i) => lines.push(describeSlot(slot, i + 1)))
  }

  if (facts.notes.length > 0) {
    lines.push(
      '',
      'REMINDERS ON THIS DAY (context to be aware of, not tasks to complete):'
    )
    for (const note of facts.notes) lines.push(describeNote(note))
  }

  return lines.join('\n')
}

/** Exported for tests — the context is the feature, so it is worth asserting on. */
export function buildDayContext(db: Db, date: DateKey): string {
  return renderContext(readDay(db, date))
}

/**
 * Which model answers.
 *
 * Reusing a goal's own configured model rather than adding a setting, because
 * the goal the question is about is the goal whose model the user already
 * chose. Falls back to the most recent goal on a day with no curriculum work.
 */
function modelFor(db: Db, facts: DayFacts): string | null {
  return facts.goals[0]?.model ?? repo.getActive(db)?.model ?? null
}

/**
 * Answer a question about one day.
 *
 * The ungrounded path is deliberate rather than a fallback. With no goal
 * configured there is nothing to keep an answer aligned to, and a study
 * assistant improvising a curriculum of its own is precisely the behaviour this
 * feature exists to prevent — so it says so instead of calling out at all.
 */
export async function ask(
  db: Db,
  date: DateKey,
  question: string,
  history: AgentMessage[]
): Promise<AgentReply> {
  const facts = readDay(db, date)
  const model = modelFor(db, facts)

  if (!model) {
    return {
      text: 'There is no goal set up yet, so I have nothing to answer from. Add a goal in Goals Admin and I can explain any day it plans.',
      grounded: false
    }
  }

  const text = await askAgent({
    apiKey: requireApiKey('agent'),
    model,
    context: renderContext(facts),
    // Trailing turns, and only well-formed ones — the renderer owns this array
    // and a malformed entry should not reach the API as a role it rejects.
    history: history
      .filter(
        (m) =>
          (m.role === 'user' || m.role === 'model') &&
          typeof m.text === 'string' &&
          m.text.trim().length > 0
      )
      .slice(-HISTORY_TURNS),
    question: question.trim().slice(0, MAX_QUESTION)
  })

  return { text, grounded: true }
}

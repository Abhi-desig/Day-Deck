# Four changes: a locked cast, filed styles, an editable prompt desk, and the lag

## Context

Four asks, in the order they should be built:

1. **A character system in Cast** — describe a character, approve one generated
   portrait, get a reference pack built behind it, then drag the character onto the
   canvas so every scene uses the same person. "Like a LoRA."
2. **A categorised Style section** — the flat wrap of chips becomes families.
3. **Process prompt settings** — every AI process in the app gets an editable
   prompt and its knobs, in Settings, behind a compact toggle box.
4. **Performance** — the split-second delay on switching panels and clicking.

Two of these are additive features on existing rails. One (the character system)
adds a whole new provider capability the app has never had — image generation —
and one (the prompt desk) turns hardcoded prose into stored, validated data.
The fourth is a measurement job that must not begin as a guess.

Everything is built on the existing rules and must not break them: **propose reads
and asks but never writes; apply writes in one transaction; `http.ts` is the only
place the app touches the network; the store is authoritative and a gesture writes
when it ends; migrations are forward-only and a shipped entry is never edited.**

---

## Phase 1 — The character system

### What "like a LoRA" can honestly mean here

There is no fine-tuning in this plan and there should not be: nothing in this app
trains a model, and pretending otherwise would set an expectation the code cannot
meet. What produces a fixed character across shots is three mechanisms stacked,
and the app already has the weakest of them:

1. **The description, restated word for word in every prompt.** This exists —
   `renderCast` in `services/ai.ts:466`, and the rule line at `ai.ts:761` that
   forbids "the same woman as before". It is necessary and it is not sufficient;
   two generations from identical words are two different faces.
2. **Reference-image conditioning at generation time.** The approved portrait's
   bytes go into the video request. This is the new mechanical lock, and it is
   the thing that makes the character *fixed* rather than merely *described*.
3. **A pack generated *from* the approved portrait, not from the prompt again.**
   This is the load-bearing design decision of the whole phase. Re-prompting the
   description produces a second person who matches the description; passing the
   approved image in as an input reference produces the *same* person from another
   angle. Every pack image must be generated with the portrait attached.

That third point is what the "multipack" is for, and stating it here because it is
the one part of this feature that is easy to build wrongly and impossible to spot
afterwards — a pack of five plausible faces looks exactly like a pack of five
shots of one face until you put two of them side by side.

### The scope question worth deciding before any code

The ask says the character is "fixed for the project". Sheets today are
**board-scoped**, and `CastPanel.tsx:17` says why in as many words: a look is a
house style worth reusing across films, a cast belongs to one film — "there is
nothing to drag onto the canvas and nothing shared with another board."

A board *is* one film, and a project can hold several boards. So there are two
readings:

- **Board-scoped (recommended).** The character belongs to this film. The drag is
  not "share it with another board", it is "attach this person to the brief so
  every prompt and every generation on this board is locked to them". That is
  exactly the shape `storyboard_style_nodes` already has, and it is a purely
  additive change — no existing row moves.
- **Project-scoped or library.** Sheets grow a `project_id`, or become a global
  library like `video_styles`, and the Cast panel lists across boards. This is a
  bigger change: a migration that has to decide what the existing board-scoped
  sheets become, a panel that has to show which board a character came from, and
  a delete rule that has to answer "what happens to the other board's film".

Everything below assumes **board-scoped**. If the intent was cross-board reuse,
say so before Phase 1 starts — it changes the schema, not just the panel.

### Provider layer — a third registry

Image generation is genuinely a third protocol, and the codebase has already
drawn this line once. `VideoAdapter` exists as a parallel surface to
`WireAdapter` rather than four extra methods on it (`providers/video-wire.ts:24`),
for exactly the reason that applies again: a text call is request in, JSON out; a
video call is submit → poll → download; an **image call is request in, bytes
out** — no operation to follow, but a body and a response neither of the other
two can express.

- **`shared/types.ts`** — `IMAGE_WIRES = ['gemini-image', 'openai-image']`,
  `AiProviderInfo.imageWire: ImageWire | null`, `defaultImageModel: string`, and
  an `imageProviders()` helper beside `videoProviders()`. `null` is the honest
  answer for most of the table again, and the refusal that names the providers
  that *can* is what stops a Groq key failing as a 404 about a missing model.
- **`providers/image-wire.ts`** *(new)* — `ImageAdapter`:

  ```ts
  export interface ImageAdapter {
    /** How many images one request can return. Stated, never assumed —
        the same lesson `maxSamples` paid for. */
    readonly maxImages: number
    /** How many input references this provider accepts, 0 if none. */
    readonly maxReferences: number
    listModels(ctx: CallContext): Promise<AiModel[]>
    generate(ctx: CallContext, req: ImageRequest): Promise<ImageResult[]>
  }

  export interface ImageRequest {
    model: string
    prompt: string
    /** Input images. The identity anchor for a pack shot. */
    references: ImageInput[]
    aspectRatio: string
    count: number
  }
  ```

- **`providers/gemini-image.ts`** *(new, first)* — `:generateContent` against an
  image model, references in as `inline_data` parts, output read back out of the
  `inlineData` parts. It fits the existing JSON `request()` unchanged, which is
  why it ships first.
- **`providers/openai-image.ts`** *(second)* — `/images/generations` has no
  reference support; references need `/images/edits`, which is **multipart**, and
  `http.ts:request()` `JSON.stringify`s every body. So this adapter needs a
  `requestMultipart()` sibling in `http.ts`, built the way `requestBinary()` was:
  sharing `classifyNetworkError`, `isAuthFailure` and the retry/overload
  counters, not editing `request()`. Until it exists, `openaiImage.maxReferences
  = 0` and the refusal says the reason.
- **New key slot `image`** in `KEY_SLOTS`, `SLOT_SETTING`, `KEY_SLOT_LABEL`.
  Settings gets a seventh `<KeyRow>` for free.
- **`providers/index.ts:197`** — `modelFor` currently branches
  `slot === 'video' ? defaultVideoModel : defaultModel`. Two special cases is a
  lookup, not a ternary: replace with `SLOT_DEFAULT_MODEL: Partial<Record<KeySlot,
  keyof AiProviderInfo>>`. This is not tidying — `defaultVideoModel` exists
  because a slot nobody configured sent `gemini-3.5-flash` to a video endpoint
  and 404'd, and an image slot with no default of its own reproduces that bug
  exactly, on a button that looks like it should just work.

**Tests:** `test/providers.test.ts` gains the new slot, the image registry, and
the "this provider makes no images" refusal. `test/secrets-slots.test.ts` gains
the seventh slot.

### Data — migration v15

The next `user_version` is 15; v14 is the style pack. Two notes carried forward
from what this repo has already paid for:

- **No `CHECK` on new enum columns.** `projects.kind` in v9 says why: SQLite
  cannot alter a CHECK, so a third value later means rebuilding the table. The
  IPC layer validates every other enum in this app and validates these too.
- **`storyboard_jobs.kind` already has a CHECK** (`generate`, `render`), which
  means the pack **cannot** reuse that table without a rebuild. It does not need
  to — see "the pack has no job row" below.

```sql
-- The cast gains an identity. `status` is 'described' | 'proposed' | 'locked';
-- no CHECK, per the projects.kind lesson.
ALTER TABLE storyboard_sheets ADD COLUMN status        TEXT NOT NULL DEFAULT 'described';
ALTER TABLE storyboard_sheets ADD COLUMN source_prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE storyboard_sheets ADD COLUMN portrait_id   TEXT;
ALTER TABLE storyboard_sheets ADD COLUMN locked_at     TEXT;

-- Every image generated for a character. Candidates are kept the way takes are:
-- a generation that cost money is not thrown away by the next click.
--
-- file_name is a basename and the id IS the name, so no row here carries a
-- path — there is nothing to sanitise because there is nothing to traverse.
CREATE TABLE storyboard_sheet_shots (
  id         TEXT PRIMARY KEY,
  sheet_id   TEXT NOT NULL REFERENCES storyboard_sheets(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'candidate',   -- 'candidate' | 'pack'
  view       TEXT NOT NULL DEFAULT '',            -- one of PACK_VIEWS, '' for a candidate
  file_name  TEXT NOT NULL,
  model      TEXT NOT NULL DEFAULT '',
  prompt     TEXT NOT NULL DEFAULT '',
  poster     TEXT,                                -- data: URI, same 96KB cap as thumbs
  sort_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sb_sheet_shots_sheet ON storyboard_sheet_shots(sheet_id);
-- One pack image per view per character. A second 'profile' is not a second
-- statement, it is a duplicate, and it would make "is the pack finished?"
-- unanswerable by counting.
CREATE UNIQUE INDEX idx_sb_sheet_shots_view
  ON storyboard_sheet_shots(sheet_id, view) WHERE kind = 'pack';

-- A character placed on one board's canvas. Mirrors storyboard_style_nodes
-- exactly, including the one-per-board UNIQUE: dropping the same character
-- twice is the same statement made twice, so the second drop moves the node.
CREATE TABLE storyboard_cast_nodes (
  id         TEXT PRIMARY KEY,
  board_id   TEXT NOT NULL REFERENCES storyboards(id)       ON DELETE CASCADE,
  sheet_id   TEXT NOT NULL REFERENCES storyboard_sheets(id) ON DELETE CASCADE,
  x          REAL NOT NULL DEFAULT 0,
  y          REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_sb_cast_once ON storyboard_cast_nodes(board_id, sheet_id);
CREATE INDEX idx_sb_cast_board ON storyboard_cast_nodes(board_id);
```

**`services/backup.ts` `TABLES` must gain `storyboard_sheet_shots` (after
`storyboard_sheets`) and `storyboard_cast_nodes` (after `storyboard_style_nodes`,
since it references a board and a sheet).** A table missing from that manifest is
not merely un-backed-up — it is **never deleted and never restored**, which means
a restore leaves it holding rows from the wrong database. `test/backup.test.ts`
already asserts the manifest covers every table created by migrations, so this
fails loudly rather than silently; do not "fix" that test by relaxing it.

Approval writes the *pointer*, not the rows: `portrait_id` and `status` in one
transaction. Same shape as `StoryFrame.isFinal` versus `StoryTake.chosen` — the
scene is settled, and *which* take is used is a separate question. A candidate on
disk is durable state that cost money, the way a job row is (`video.ts:22`); the
character's identity is what the user approves.

### Asset store — the second class of files the app owns

`services/portraits.ts` *(new)*, a deliberate sibling of `services/takes.ts`
rather than a generalisation of it, following the same three rules that make
`takes.ts` safe:

- `portraitsDir()` = `app.getPath('userData')/shots/`, created on demand.
- `shotFileName(id)` = `<id>.png`, `shotPath(id)` derived **from the id, never
  from the stored `file_name`**, so a row cannot influence where a read points.
- `sweepOrphanedShots(db)` at startup. `ON DELETE CASCADE` removes shot rows when
  a sheet or board goes, and SQLite cannot delete files. Without the sweep,
  deleting a board leaks every portrait it generated. `takes.ts:66` documents
  this trap already; it recurs here identically.

**`services/media.ts`** — `mediaRefFrom` hardcodes `'item' | 'take'`. Widen to
include `'shot'` and add a `serveShot(id)` that stats and `net.fetch`es exactly
like `serveTake`. No CSP change: `deck-media:` is already in `img-src`.
`test/media.test.ts` must gain the traversal-rejection cases for the new host —
it already has them for `take`, and the whole security boundary of the scheme is
that function.

### Service — `services/cast.ts` *(new)*

| Function | Contract |
|---|---|
| `proposePortrait(db, sheetId, extra)` | Reads the sheet, its board and the placed style; generates **one** image; writes the file and a `kind='candidate'` row. Does not touch the sheet. |
| `approvePortrait(db, sheetId, shotId)` | One transaction: `portrait_id`, `status='locked'`, `locked_at`. The only call that makes a character real. |
| `buildPack(db, sheetId, send)` | The reference pack. **Every image is generated with the approved portrait attached as an input reference.** Sequential. |
| `packProgress(db, sheetId)` | Which views exist, which are missing. |
| `resumePacks(db, send)` | At startup, finish any locked sheet whose pack is short. |
| `unlock(db, sheetId)` | Back to `described`; keeps the images, clears the pointer. |

**The pack has no job row.** Resumability for video needed one because the
provider's operation name is the only handle on work already paid for and not yet
delivered. An image call is request/response: it either returned bytes or it did
not. So "what is left to do" is `PACK_VIEWS` minus the `pack` rows that exist —
the rows *are* the progress, and `resumePacks` is a query rather than a table.
That is strictly better than a job row that could disagree with the files.

**`PACK_VIEWS` in `shared/types.ts`**, so the renderer can show progress against
the same list the service walks:

```ts
export const PACK_VIEWS = [
  'front', 'three-quarter', 'profile', 'full-body', 'expression'
] as const
```

Five, because five is what a shot can be conditioned from, and because each one
is a metered image call.

**Guardrails, following the money rule the video work established** — the count
is stated before anything is submitted:

- One image call in flight at a time, app-wide.
- The pack **waits on** `hasJobInFlight(db)` before each image, and never blocks
  a video generation. Video is the expensive one and the user is watching it.
- "Without showing this process" is not the same as "without saying what it
  costs". The Approve button says what it is about to do: *"Approve — then build
  5 reference angles in the background."* Silent is fine; unpriced is not.
- A pack that fails degrades to **locked with a portrait and an incomplete pack**,
  never to a half-locked character, and the failure is reported once rather than
  per view.

**Push channel `cast:packProgress`** — its own small union rather than widening
`VideoJobProgress`. The README's "one channel because there is one long-running-
work indicator" reasoning does not extend here: an invisible background pack is
deliberately *not* that indicator, and putting it on the same channel would light
up the generation UI.

```ts
export type PackProgress =
  | { phase: 'building'; sheetId: string; done: number; total: number }
  | { phase: 'ready'; sheetId: string; shots: SheetShot[] }
  | { phase: 'error'; sheetId: string; message: string }
```

Wired exactly like `IPC.boardsJobProgress`: the handler closes over
`event.sender`, guards on `isDestroyed()`, passes `send` into the service.

### Wiring the character into the flow

1. **Drag payload** — `CAST_DRAG_TYPE = 'application/x-day-deck-character'`
   beside `STYLE_DRAG_TYPE` in `nodes/types.ts`, carrying only the sheet id. A
   custom MIME type for the same reason styles use one: a stray text drag cannot
   be mistaken for a character, and the canvas looks the sheet up rather than
   trusting what it was handed.
2. **Draggable only when locked.** A described-only character dragged onto the
   canvas would place a lock with no image behind it — the chip is not draggable
   until `status === 'locked'`, and the tooltip says why.
3. **The node** — `nodes/CastNode.tsx`, `nodeId.cast(placementId)`, registered in
   `Canvas.tsx`'s module-scope `NODE_TYPES` (identity matters — the object must
   not be rebuilt per render). Drawn like `StyleNode` with the portrait thumb and
   the name. Position stored in `storyboard_cast_nodes`, written on
   `onNodeDragStop` like every other positioned node.
4. **The edge** — derived, not stored, exactly like the style attachment: there
   is one brief per board, so the attachment is implied by the placement and a
   row could only ever agree with it or be wrong. `cast:<placementId>` from the
   cast node to a **new** `HANDLE.briefCastIn`. New handle rather than reusing
   `briefStyleIn`: `nodes/types.ts:99` already says a brief takes two kinds of
   inbound wire and they must not land on one point — a third is the same
   argument. `buildBoardNodes`/`buildBoardEdges` change and
   `test/board-graph.test.ts` extends; `isValidConnection` keeps refusing it as a
   hand-drawn connection, and `onNodesDelete` unplaces the character while the
   sheet survives (the style rule, and for the same reason).
5. **Prompt text** — `castOf` in `services/storyboard.ts:88` keeps sending every
   named-and-described sheet, **placed or not**. Placement adds the image lock;
   it does not gate the words. That keeps this change additive, so no board
   regresses the day the feature lands. `renderCast`'s rule line gains one
   sentence for locked characters: their description is also supplied to the
   generator as a reference image and must not be reworded.
6. **Generation — the actual lock.** `services/video.ts:87` `generate()` resolves
   the board's placed, locked characters and attaches their reference bytes:
   - `VideoRequest` gains `references?: ImageInput[]`.
   - **`VideoAdapter` gains `maxReferenceImages: number`**, and the caller clamps
     to it exactly the way it already clamps `sampleCount` to `maxSamples`. This
     is not defensive tidiness: Veo 3 image-to-video takes one starting frame,
     Veo 3.1's `referenceImages` takes up to three, and OpenAI's `/videos`
     `input_reference` takes one and arrives as multipart. A second reference sent
     where one is accepted is **silently ignored** — the run succeeds and returns
     a clip with the wrong second person in it, which is the worst possible way
     for this to fail because nothing anywhere reports an error.
   - Where the clamp bites, the row **says so** before submitting: *"Two
     characters are locked to this board and Veo takes one reference — only Maya
     will be locked by image; Dev is described in the prompt only."* That sentence
     is the whole difference between this feature working and this feature looking
     like it works.
   - Phase 1 always sends the portrait. Phase 2 lets the prompt writer name a
     `view` per scene from `PACK_VIEWS` (it already knows whether the shot is a
     profile), and generation picks that pack shot — which is the point at which
     the pack becomes load-bearing rather than insurance.

### UI

- **`CastPanel.tsx`** — the Chip gains the portrait thumb and a three-state dot:
  hollow (described), amber ring (a candidate awaiting approval), filled with
  thumb (locked). The existing hollow-dot idea already communicates "not sent to
  prompts"; this extends the same vocabulary rather than inventing a second one.
- **The create flow** — the description doubles as the portrait prompt
  (`source_prompt` defaults to it, so the user types once), plus one optional line
  for portrait-only direction: background, light, framing. Then **Generate
  portrait** → one image, rendered large enough to judge a face → **Approve** /
  **Try again** / **Discard**. Rejected candidates are kept and collapsed behind
  a small *"3 other candidates"* disclosure, because a paid generation is not
  thrown away by the next click — but they are not on screen by default, because
  a second face beside the approved one is the drift this feature exists to stop.
- **After approve** — the chip goes locked, becomes draggable, and a quiet line
  reports the pack: *"Building reference angles — 2 of 5."* No modal, no blocking.
- **New IPC** — `sheets:proposePortrait`, `sheets:approvePortrait`,
  `sheets:shots`, `sheets:discardShot`, `sheets:unlock`, `sheets:place`,
  `sheets:unplace`, `sheets:placed`, `sheets:moveNode`; push
  `cast:packProgress`. Validated in `ipc-contract.ts` like every other channel.
- **A new `useCast` store**, not more state in `useStoryboards`. Sheets currently
  ride in the store that holds the whole board graph, so a pack tick every few
  seconds would re-render the canvas. That is a correctness-adjacent perf
  decision, and it is the same problem Phase 4 addresses generally.

**Checkpoint:** describe a character, generate a portrait, approve it, watch the
pack fill in without being interrupted, drag the chip onto the canvas, see it
wire to the brief, generate a scene, and find the same face in the clip.

**Tests:** `test/cast.test.ts` (propose writes a candidate and not the sheet;
approve is one transaction; the pack always passes the portrait as a reference;
`resumePacks` finishes a short pack and is a no-op on a complete one),
`test/board-graph.test.ts` (cast node, derived edge, new handle),
`test/media.test.ts` (`deck-media://shot/<id>` and its rejections),
`test/backup.test.ts` (the manifest assertion catches the two new tables),
`test/migrations.test.ts` (v15 against a v14 database with rows in it).

---

## Phase 2 — Categorising the styles

Eighteen seeded looks plus whatever the user has written is one flat wrap of
chips in `StylePanel.tsx:68`. The looks already fall into obvious families —
anamorphic cinema, documentary handheld, lo-fi analog, night and neon, macro and
product, non-photoreal, landscape and atmosphere.

**A category is a column on the style, not a table.** There is one category per
style and nothing else hangs off a category, so a table would be a join for a
string.

- **Migration v15** (same batch as Phase 1):
  `ALTER TABLE video_styles ADD COLUMN category TEXT NOT NULL DEFAULT ''`. No
  CHECK — the v9 lesson again.
- **`STYLE_CATEGORIES` in `shared/types.ts`** — id, label, and a one-line "what
  this family is for", the same shape `STYLE_FIELDS` already has. The panel groups
  by this list, so group *order* is a code decision rather than whatever strings
  happen to be in rows.
- **`''` is uncategorised and gets its own trailing group.** Not hidden, and not
  silently filed under the first category. Every style the user has hand-written
  lands there and nothing moves without them saying so.
- **The seeded eighteen get filed in the migration, by name.** A new
  `styleCategoryMigration()` beside `stylePackMigration()`, generated from a new
  `category` field on `StyleSeed` so the seed data stays readable as data. Each
  `UPDATE` is guarded on `category = ''` and matched on `lower(trim(name))`, for
  exactly the reason the pack seeds by name: a library that already holds
  MIDNIGHT LEXINGTON holds the user's version of it, and their filing wins.
  **`stylePackMigration()` itself is v14 and shipped — it is not edited.** Adding
  a field to `StyleSeed` is safe only because v14's generated SQL does not
  reference it; keep it that way.
- **`db/styles.ts`** — `category` joins `STYLE_PATCH_COLUMNS` and `toStyle` reads
  it defensively, the way `isGoalColor` already does: a value that is not a known
  category reads back as `''` rather than crashing a board load.
- **`ORDER BY`** stays `sort_index, created_at` *within* a group.
- **`lib/style-groups.ts`** *(new)* — `groupStyles(styles)` is pure and lives
  outside the component, so `test/styles.test.ts` can assert the grouping without
  a DOM. That is the `board-graph.ts` precedent, and it exists because this kind
  of regression is invisible to a node-only suite when the logic sits in JSX.
- **The panel** — one collapsible section per category with a count, plus a
  **filter field**. Categories alone still leave a wall of chips, and Settings'
  `ModelPicker` already learned this lesson at a larger scale: a list you cannot
  type at is a scroll bar. Collapse state is local component state, not a pref —
  a collapsed group is a reading position, not a setting.
- **The editor** gains a category `<select>` with an "Uncategorised" option.

**Checkpoint:** open Styles, see seven or so named families with the pack filed
into them, own styles under Uncategorised, type three letters and find one.

---

## Phase 3 — The process prompt desk

### The problem to solve first

Every prompt in this app is **assembled**, not stored: `buildPromptWriterPrompt`
(`ai.ts:738`) interleaves a fixed opening instruction, live data (the brief, the
whole board, the cast, the style, the batch), and a fixed RULES list. You cannot
hand the user "the prompt" as one editable string without either losing the data
interleaving or inventing a template language, and a template language in
Settings is a way to break the app from Settings.

**So: the parts that are prose become data; the parts that are assembly stay
code.** Each process declares a spec, and only the prose halves of it are
overridable.

```ts
// shared/types.ts
export interface ProcessSpec {
  id: ProcessId            // 'board.prompts'
  label: string            // 'Write prompts'
  where: string            // 'Storyboards → Write prompts'
  slot: KeySlot
  /** The opening instruction — who the model is and what it is doing. */
  role: string
  /** The RULES list. The half of a prompt that is policy. */
  rules: ProcessRule[]
  /** The knobs that decide what a call costs and how it batches. */
  limits: { timeoutMs: number; output: number; minOutput: number
            thinking: number; batch?: number }
}

export interface ProcessRule {
  text: string
  /** A rule the parser depends on. Editable in wording, not removable. */
  pinned?: boolean
}
```

### The processes

Nine, with the tenth and eleventh arriving from Phase 1:

| `ProcessId` | Where | Slot | Today |
|---|---|---|---|
| `curriculum.decompose` | Goals Admin → plan | `goals` | `buildPrompt` |
| `curriculum.subdivide` | Goals Admin → learning points | `goals` | `buildSubdividePrompt` |
| `day.agent` | Today → the day assistant | `agent` | `AGENT_SYSTEM` |
| `board.scenes` | Storyboards → Plan scenes | `scenes` | `buildScenePrompt` |
| `board.prompts` | Storyboards → Write prompts | `prompts` | `buildPromptWriterPrompt` |
| `board.revision` | A scene row → Revise | `prompts` | `buildRevisionPrompt` |
| `board.cut` | Timeline → AI cut | `prompts` | `buildCutPrompt` |
| `style.sort` | Styles → Sort into fields | `scenes` | `buildStyleSortPrompt` |
| `cast.portrait` / `cast.pack` | Cast | `image` | Phase 1 |

### How it works

- **`PROCESS_DEFAULTS: Record<ProcessId, ProcessSpec>`** in `shared/`, holding
  **the exact text the builders use today**, moved out of `ai.ts` verbatim. Two
  consequences worth having: there is no behaviour change on first run, and the
  defaults are visible and resettable in Settings from day one.
- **Overrides in `settings`** as JSON per process, `SETTING.process(id)`, read
  through **`resolveProcess(db, id)`** which merges and then **validates**:
  - An empty `role` falls back to the default. An empty instruction is not a
    customisation, it is a broken call.
  - Rules are trimmed, capped in count and length, and pinned rules cannot be
    removed — only reworded.
  - Limits are **clamped**: `minOutput ≤ output`, `thinking ≤ output`, timeout
    inside a range, batch inside a range. This matters more than it looks. Those
    numbers carry hard-won reasoning — `PROMPT_BATCH = 4` exists because fifteen
    scenes reserved 12k output tokens up front and were refused outright on a
    balance covering 4.4k (`storyboard.ts:236`), and `minOutput` exists so a thin
    balance shortens an answer instead of failing it. A user who sets `output:
    100` otherwise gets truncated JSON and a parse error with no clue why.
- **`ai.ts` builders take the resolved spec** instead of hardcoding their opening
  line and RULES. Three of them are already exported "because the prompt is the
  feature" (`ai.ts:1322`) — those tests take a spec and gain two cases: an
  override lands in the built prompt, and a blank override does not.
- **What is not editable, and the panel says so per process:** the JSON schema,
  the data blocks, and the parse/clamp code. Those are the contract between the
  prompt and the app. Editing *"Return each prompt with its scene number"* out of
  the rules while `parsePrompts` still keys on the scene number is a feature that
  breaks the app from Settings — hence `pinned`, and hence the schema rendered
  read-only under a disclosure so it is visible without being editable.
- **Reset per process, and a "modified" badge on the toggle box.** A customised
  prompt that quietly underperforms is otherwise indistinguishable from a model
  getting worse, and that is a debugging session nobody should have to have.

### UI and IPC

- **`sections/Settings/` gets split**: `index.tsx` is already 912 lines and this
  roughly doubles it. `index.tsx` + `Keys.tsx` (the existing `KeyRow`,
  `ModelPicker`, `BaseUrlRow`) + `Processes.tsx` + `ProcessBox.tsx`. Worth doing
  as part of this change rather than after it.
- **The boxes** are grouped by area — Goals, Today, Storyboards, Cast — so eleven
  boxes read as four groups. Collapsed: label, where it runs, slot chip, modified
  badge, chevron. Expanded: role textarea, rules list (add / remove / reorder,
  pinned ones locked), limits row with each default shown beside its field,
  schema disclosure, Reset.
- **IPC** — `settings:processes` (every resolved spec plus which are modified),
  `settings:setProcess`, `settings:resetProcess`.
- `settings` is already in `backup.ts` `TABLES`, so overrides travel with a
  backup. That is right, and worth confirming rather than assuming.

**Tests** — `test/process-prompts.test.ts`: defaults resolve to today's text
(assert against the builders' current output, so this test is what proves "no
behaviour change on first run"); an override merges; a blank or oversized
override is refused; clamps hold; a pinned rule survives an override that tries
to drop it; and **`PROCESS_DEFAULTS` covers every `ProcessId`** — the
manifest-completeness pattern from `backup.test.ts`, for the same reason: a
process missing from the table is a process nobody can configure and nobody will
notice is missing.

**Checkpoint:** open Settings → Processes, expand "Write prompts", change one
rule, run a prompt pass, and see the change in the output. Reset it and see the
original behaviour return.

---

## Phase 4 — The lag

### Measure before changing anything

The ask describes a split-second delay on switching panels and clicking. There
are at least six plausible causes in this codebase and they want different fixes,
so the first work item is measurement, not optimisation:

1. React DevTools Profiler across one section switch — commit count, and which
   components dominate.
2. `performance.mark` around `go(section)` → first paint of the new panel.
3. Chrome DevTools Performance with paint flashing on, to separate JS time from
   compositor/paint time.
4. **And one five-minute check that could reframe the whole item:**
   `main.tsx:18` renders inside `<StrictMode>`, so **every effect runs twice in
   dev** — which means every section mount fires its IPC loads twice. Reproduce
   the lag in a `pnpm build` / packaged run before optimising for a dev-only
   double fetch.

### What the code already tells us, in priority order

**1. Every section unmounts and remounts on every switch, and re-fetches on
mount.** This is the strongest candidate. `App.tsx:108` renders only
`children[activeIndex]` inside `AnimatePresence`, so the outgoing tree is
destroyed and the incoming one is built from nothing. `Storyboards/index.tsx:88`
then runs `load()`, `loadProjects()` and `loadStyles()` on mount, plus
`loadPlaced` and `loadCut` for the active board, and `Canvas` is keyed by board so
React Flow mounts and `fitView`s from scratch. None of those store loads cache:
`useStyles.load` refetches all eighteen styles every single time, and
`useStoryboards.load` has no guard at all. `useProjects.load` dedupes concurrent
calls but still refetches on every mount. So a switch to Storyboards is four-plus
IPC round trips plus a full React Flow mount before the first useful frame.

- **Fix A — guard the loads.** `if (get().ready) return` in `useStyles.load` and
  `useStoryboards.load`, with an explicit `refresh()` for the paths that genuinely
  need a re-read. The stores are already the cache; they simply do not act like
  one. Smallest change, biggest fraction of the win.
- **Fix B — keep visited panels mounted.** Mount a section on first visit and
  keep it, hiding inactive ones rather than unmounting. This is what makes a
  second visit free. Mount-on-first-visit rather than mount-all-at-boot, because
  React Flow, Monaco and xterm are the heavy three and nobody should pay for them
  at launch. **Careful:** `TransitionPanel` uses `mode="popLayout"`, which
  measures the outgoing panel and pins it absolutely, and its own doc comment
  (`TransitionPanel.tsx:56`) records what happens when that measurement is
  skipped — a vertical judder that reads as a stuck swipe. Keeping panels alive
  changes that contract, so either the transition becomes a crossfade between two
  always-present layers, or Fix B is skipped and only the refetching is fixed.

**2. Store selectors that hand back fresh objects.** `Canvas.tsx:151` selects
`useTakes((s) => s.byFrame)` and flat-maps over it; every progress tick replaces
that object, which rebuilds the entire board graph, which rebuilds every node's
`data`, which React Flow reads as changed. `useStoryboards` holding the whole
graph in one store has the same shape: a sheet edit re-renders the canvas. Fix:
narrow the selectors (`useShallow`), and split the stores — which the Cast work
in Phase 1 needs to do anyway.

**3. Click latency specifically.** Two candidates, and they want different fixes.
Some mutations already patch optimistically and reconcile (`useStyles.patch`,
`patchSheet`), while others re-read a whole collection afterwards — applying
prompts calls `open(activeId)`, which refetches the entire board
(`Storyboards/index.tsx:243`). And `Dock.tsx` runs a `useSpring` +
`useTransform` per icon on pointer move for the magnification. Measure before
touching the dock; the store round-trips are the likelier culprit and the safer
fix.

**4. Paint cost.** `.app-ambient` is four large radial gradients across the whole
window, and `.glass` is `backdrop-filter: blur(26px) saturate(180%)` with
`backdrop-blur-xl` on the Dock and the deck. A `backdrop-filter` re-samples every
frame of the 280ms section slide, over the full window. This codebase already
knows the shape of this problem — `TransitionPanel` refuses to animate `filter`
at all, and the deck's own history is that blur was the swipe cost. Candidate
fixes, in order of bluntness: `will-change: transform, opacity` on the panel
wrapper for the duration of the transition only; drop `saturate(180%)` (the
expensive half) during transitions; reduce the blur radius. All of them are
visual trade-offs and none should be made before the profiler says paint is
actually the bottleneck.

**5. Do not shorten the transition to hide the problem.** 280ms of intentional
motion is not the lag; work happening during those 280ms is. Fixing the duration
would make it feel faster and be exactly as slow.

**Checkpoint:** a measured before/after on the same gesture — switch to
Storyboards on a board with a dozen scenes and takes, twice, and report both
numbers. If the second switch is not dramatically cheaper than the first, Fix A
did not land.

---

## Files touched, at a glance

| Area | Paths |
|---|---|
| Shared | `src/shared/types.ts` (image registry, `image` slot, `PACK_VIEWS`, `STYLE_CATEGORIES`, `ProcessSpec`, `PackProgress`), `src/shared/ipc-contract.ts` |
| DB | `migrations.ts` (v15), `db/cast.ts` *(new)*, `db/style-pack.ts` (`category` on `StyleSeed`, `styleCategoryMigration`), `db/styles.ts`, `db/storyboards.ts`, `db/settings.ts` |
| Services | `cast.ts` *(new)*, `portraits.ts` *(new)*, `ai.ts` (spec-driven builders, portrait/pack prompts), `video.ts` (references + clamp), `storyboard.ts`, `media.ts`, `backup.ts`, `bootstrap.ts` (sweep + `resumePacks`), `providers/{image-wire.ts,gemini-image.ts,openai-image.ts}` *(new)*, `providers/{index.ts,http.ts,video-wire.ts,veo.ts,sora.ts}` |
| IPC | `src/main/ipc/index.ts`, `src/preload/index.ts` |
| Renderer | `sections/Storyboards/{CastPanel,StylePanel,Canvas}.tsx`, `nodes/{CastNode.tsx (new),types.ts}`, `lib/{board-graph.ts,style-groups.ts (new)}`, `store/useCast.ts` *(new)*, `store/{useStyles,useStoryboards,useTakes}.ts`, `sections/Settings/{index,Keys,Processes,ProcessBox}.tsx`, `App.tsx`, `components/motion-primitives/TransitionPanel.tsx` |

## Verification

Per phase, in order:

1. `pnpm typecheck && pnpm test` after every phase — the suite is node-only and
   fast, so there is no excuse for running it late.
2. **New tests:** `cast.test.ts`, `process-prompts.test.ts`, and additions to
   `board-graph.test.ts`, `media.test.ts`, `styles.test.ts`, `migrations.test.ts`,
   `providers.test.ts`, `secrets-slots.test.ts`. `backup.test.ts` needs no new
   case — its manifest assertion is what catches the two new tables, and it must
   be allowed to fail rather than be relaxed.
3. **Existing tests to expect churn in:** `storyboard-ai.test.ts`,
   `storyboard-two-stage.test.ts`, `storyboard-plan.test.ts`, `style-parse.test.ts`
   (all four read the built prompts, which Phase 3 makes spec-driven).
4. **In-app, per phase.** Phase 1: an image key in the new slot, a character
   described, a portrait approved, a pack built, the chip dragged onto the canvas,
   a scene generated, the same face in the clip. Phase 2: the families render and
   the filter finds a look. Phase 3: an edited rule changes the output and Reset
   restores it. Phase 4: the before/after numbers.
5. **Migration against a real database.** Copy the live
   `~/Library/Application Support/day-deck/daydeck.db` **with its `-wal` and
   `-shm` files**, or with the app quit — a snapshot of the main file alone is a
   stale database, which is a trap this repo has already hit — then run v14 → v15
   against the copy and check that hand-written styles stayed uncategorised and
   pack styles got filed.
6. **Packaged check after Phase 1.** `pnpm dist:mac`, then generate a portrait
   and a clip from the built `.app`. The portrait directory, the `deck-media://
   shot/` host and the startup sweep are all main-process paths that behave
   differently once packaged, and the executable-bit and asar traps in this repo
   have only ever shown up there.

## Open questions

1. **Board-scoped or project-scoped cast?** Everything above assumes
   board-scoped, matching `storyboard_sheets` today. Cross-board reuse is a
   different schema and a different panel — decide before Phase 1 starts.
2. **Which image provider first?** Gemini fits the existing JSON `request()` and
   takes references inline, so it ships first. OpenAI needs `requestMultipart()`
   in `http.ts` before it can take a reference at all.
3. **Do rejected portrait candidates stay?** Recommended yes, collapsed — a paid
   generation is not thrown away by the next click. The counter-argument is that
   a second face anywhere in the Cast panel is the drift this feature exists to
   prevent.

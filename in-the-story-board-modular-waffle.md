# Storyboard: from prompts to a cut film

## Context

The Storyboards section today stops at text. `boards:planPrompts` writes a string into
`storyboard_frames.prompt`, the scene card shows it with a Copy button, and the user pastes
it into some other tool by hand. The pipeline is deliberately open-ended — `ai.ts:730`
records the reasoning ("leaving is the entire purpose of a prompt") — and
`providers/wire.ts:173` actively filters `veo|imagen|sora|video` out of every model list.

The ask is to close that loop inside the app: generate the clips, iterate on them with the
AI, mark a scene done, and cut the finals together. Four features, sequenced so each one
is usable before the next is started:

1. Scenes stop being loose cards and live inside one auto-connected container node.
2. Each scene generates video (Google Veo, via the existing Gemini key architecture),
   keeps every take, and can be revised by describing a change in words.
3. A per-scene **Final** toggle gates which scenes flow into the cut.
4. A timeline node with a bundled ffmpeg trims and exports — manually, or by asking the AI
   to pick the cut points.

Everything is built on the existing rules and must not break them: **propose reads and asks
but never writes; apply writes in one transaction; `http.ts` is the only place the app
touches the network; the store is authoritative and a gesture writes when it ends.**

---

## Phase 1 — The container node

**Goal:** after prompts generate, one box on the canvas holds every scene, wired to the
brief automatically.

The container replaces scene nodes in the graph — they become scrolling rows inside it, not
separately-positioned cards. Two consequences must be handled deliberately:

- **Reference wires need somewhere to land.** Today `ref:<frameId>:<itemId>` targets
  `scene:<frameId>`. Reuse the pattern `ListNode` already uses: the container exposes one
  target handle per scene row, **handle id = frame id**. Edges then target
  `group:<boardId>` with `targetHandle: frame.id`. `buildBoardEdges` and
  `Canvas.tsx:isValidConnection` / `onEdgesDelete` change accordingly.
- **The spine collapses.** N `spine:<frameId>` edges become one `spine:<boardId>` edge from
  `brief-out` to the container. Still derived, still not stored.

`storyboard_frames.x/y/w/h` are left in place and simply unused — no data is destroyed, and
a `usePrefs` toggle (`sceneLayout: 'stack' | 'canvas'`, following `sceneNumbers` exactly,
`settings:setSceneNumbers` is the pattern) flips back to the old free canvas.

**Files**
- `src/renderer/src/sections/Storyboards/nodes/SceneGroupNode.tsx` — new. Header
  (scene count, Plan/Write buttons), then a `nowheel` scroll body of rows. Each row reuses
  the existing pieces from `SceneNode.tsx`: `Field` title, `DurationPicker`, `RefThumb`
  strip, `PromptBlock`. Extract those three into `nodes/SceneRow.tsx` so `SceneNode` and the
  row share one implementation rather than diverging.
- `nodes/types.ts` — add `nodeId.group`, `HANDLE.groupBriefIn`, `GroupData`,
  `SceneGroupNodeType`, add to the `BoardNode` union.
- `lib/board-graph.ts` — `buildBoardNodes` emits one group node instead of the scene array
  when stacked; `buildBoardEdges` emits the collapsed spine and retargets ref wires. This
  file is pure and already has `test/board-graph.test.ts` — extend it.
- `Canvas.tsx` — register `group` in `NODE_TYPES` (module scope, identity matters).
- `src/main/db/settings.ts` + `shared/types.ts` `UiPrefs` — the layout pref.

**Checkpoint:** board opens, one box, all scenes readable and editable inside it, reference
wires still connect, FocusMode still opens from a row.

---

## Phase 2 — Veo generation, takes, and the revision loop

### Provider layer

Veo does not fit `WireAdapter` — it is submit → long-running operation → poll → download
bytes, not request/response JSON. Do **not** widen `WireAdapter`; add a parallel surface.

- `src/main/services/providers/veo.ts` — new. `submit(...)`, `poll(operation)`,
  `fetchBytes(uri)`. All three call helpers in `http.ts`; no `fetch` outside that file.
- `providers/http.ts` — `request()` is JSON at both ends (it `JSON.stringify`s every body and
  always returns `response.json()`), so this is a **sibling** function, not an edit to it:
  `requestBinary()` sharing `classifyNetworkError`, `isAuthFailure` and the two-counter
  retry/overload backoff, which polling a long-running operation needs anyway.
- `providers/wire.ts` — `NON_TEXT` stays exactly as it is for text pickers. Add a separate
  `VIDEO_MODELS` allowlist so the new video model picker shows Veo and only Veo.
- New key slot `video` in `KEY_SLOTS` / `SLOT_SETTING`, inheriting from `default` like the
  others. Settings gets a sixth `<KeyRow>` for free.

### Data

Migration **v12** in `src/main/db/migrations.ts`:

```sql
ALTER TABLE storyboard_frames ADD COLUMN is_final INTEGER NOT NULL DEFAULT 0;
ALTER TABLE storyboard_frames ADD COLUMN revision_note TEXT NOT NULL DEFAULT '';

CREATE TABLE storyboard_jobs (            -- survives a quit mid-generation
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES storyboards(id) ON DELETE CASCADE,
  frame_id TEXT REFERENCES storyboard_frames(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('generate','render')),
  operation TEXT NOT NULL DEFAULT '',     -- the provider's operation name, for resume
  model TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','error')),
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE storyboard_takes (
  id TEXT PRIMARY KEY,
  frame_id TEXT NOT NULL REFERENCES storyboard_frames(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES storyboard_jobs(id) ON DELETE SET NULL,
  take_index INTEGER NOT NULL DEFAULT 0,  -- 0,1,2 within one generation
  file_name TEXT NOT NULL,                -- basename only; the dir is ours
  duration_sec REAL NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',        -- the exact prompt that made it
  poster TEXT,                            -- data: URI, same 96KB cap as thumbs
  chosen INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sb_takes_frame ON storyboard_takes(frame_id);
```

**`src/main/services/backup.ts` — add `'storyboard_jobs'`, `'storyboard_takes'` to `TABLES`,
after `storyboard_frames`.** A table missing from that manifest is not merely un-backed-up:
it is **wiped on every restore**. There is currently *no test asserting the manifest covers
every table* — add one (`test/backup.test.ts`: diff `TABLES` against
`sqlite_master` after migrating a fresh db). This is the single highest-risk line in the
whole plan.

### Asset store

Generated clips are the first files the app owns. `src/main/services/takes.ts`:

- Directory `app.getPath('userData')/takes/`, files named `<takeId>.mp4` — the id is the
  name, so there is no path in any row to sanitise.
- Served by extending `src/main/services/media.ts`: generalise `itemIdFrom` into
  `mediaRefFrom(url) → { host: 'item' | 'take', id } | null`, keeping the same
  reject-on-`/ \ ..` rule. `deck-media://take/<id>` streams via `net.fetch` exactly like
  items do, which gives `<video>` seeking for free. No CSP change — `deck-media:` is
  already in `media-src`.
- Deleting a take unlinks its file. A startup sweep deletes any file in `takes/` with no
  row (cascade deletes rows but cannot delete files).

### Generation service

`src/main/services/video.ts`:

| Function | Contract |
|---|---|
| `generate(db, frameId, opts, send)` | Writes a job row, submits, polls, downloads, writes take rows. The one place that both reads and writes — justified because a job *is* durable state, and each write is its own transaction. |
| `resumeJobs(db, send)` | On app start, re-polls any `running` job by its stored `operation`. |
| `listTakes(db, frameId)` / `chooseTake` / `deleteTake` | Plain reads/writes. |

**Guardrails, following the `PROMPT_BATCH = 4` lesson** (a metered provider reserves the
whole ceiling up front, so batch size — not answer size — is what an account must afford):

- One Veo job in flight at a time, ever. No fan-out.
- "Generate all" walks unfinalised scenes **sequentially** and confirms up front with the
  exact count and takes-per-scene, because unlike a token budget this one is denominated in
  money the user can see.
- Takes-per-generation is a per-board setting defaulting to **1**, raisable to 3.

### Revision loop

Add to `src/main/services/storyboard.ts`, obeying its read-or-write-never-both rule:

- `proposeRevision(db, frameId, note): Promise<PromptPlanProposal>` — reads the frame, its
  board, style, cast, refs and the prompt that produced the current take, plus the user's
  note, and asks for a rewritten prompt. **Writes nothing.**
- Apply reuses the existing `boards:applyPromptPlan` channel and `applyPrompts` — no new
  write path, and the existing `PromptWindow` diff UI renders it unchanged.

New AI job in `ai.ts` with a `JsonBudget` sized like `planPrompts`
(`output: 4096, minOutput: 2048, thinking: 512`) — one scene per call, so it is a quarter of
a `PROMPT_BATCH` batch and cannot be the thing that fails on a thin balance.

### IPC

Invoke: `takes:list`, `takes:generate`, `takes:choose`, `takes:delete`,
`boards:proposeRevision`, `frames:setFinal`.
**Push:** `boards:jobProgress`, carrying a discriminated union `VideoJobProgress`
(`submitting | polling | downloading | done | error`) — modelled on `CurriculumProgress`
and wired exactly like `IPC.curriculumProgress` at `src/main/ipc/index.ts:216-240`: the
handler closes over `event.sender`, guards on `isDestroyed()`, passes `send` into the
service. This is the first push channel Storyboards has.

### UI

In `SceneRow`: a take strip (`<video>` posters, click to play inline), a **Generate**
button, a note field + **Revise** button, and a **Final** toggle. Revise opens the existing
`PromptWindow` with a single row.

**Checkpoint:** generate a clip, watch it in the box, type "make it slower and colder",
approve the rewritten prompt, regenerate, mark final.

---

## Phase 3 — The trimmer

### ffmpeg

`ffmpeg-static` + `ffprobe-static` go in **`dependencies`** (electron-vite's
`externalizeDepsPlugin` keeps them unbundled) with `asarUnpack` entries in
`electron-builder.yml` beside the existing `node-pty` one. Two traps this repo has already
paid for:

- An executable **cannot run from inside an asar** — resolve the path and rewrite
  `app.asar` → `app.asar.unpacked`.
- pnpm's content-addressable store **does not preserve the executable bit**.
  `scripts/fix-node-pty.mjs` already exists for exactly this; extend it (or add a sibling)
  to chmod the ffmpeg binaries, and keep it idempotent.

`src/main/services/ffmpeg.ts` — `binaryPath()`, `probe(path)`, `renderCut(...)`. Spawns with
`-progress pipe:1` and parses `out_time_ms` for a real percentage. **The argument builders
are pure and exported** (`buildTrimArgs`, `buildConcatArgs`) so `test/ffmpeg-args.test.ts`
can assert them without ever spawning a process — same shape as the existing pure-logic
tests.

### The cut

Migration **v13**:

```sql
CREATE TABLE storyboard_cuts (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL UNIQUE REFERENCES storyboards(id) ON DELETE CASCADE,
  x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE storyboard_cut_segments (
  id TEXT PRIMARY KEY,
  cut_id TEXT NOT NULL REFERENCES storyboard_cuts(id) ON DELETE CASCADE,
  take_id TEXT NOT NULL REFERENCES storyboard_takes(id) ON DELETE CASCADE,
  start_sec REAL NOT NULL DEFAULT 0,
  end_sec REAL NOT NULL,
  sort_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sb_cut_segments_cut ON storyboard_cut_segments(cut_id);
```

A segment is `(take, start, end)`, so **one scene can contribute several segments** — two of
its three takes back to back, or the same take twice. Both new tables go into `TABLES`,
after `storyboard_takes`.

`src/renderer/src/sections/Storyboards/nodes/TimelineNode.tsx` — a node on the canvas
(`timeline:<boardId>`), auto-wired from the container node. Clip strip, scrubber, drag
handles for in/out, reorder, remove. **Every interactive area carries `nodrag nowheel`** —
that is the established mitigation in this codebase (`SceneNode.tsx:134`) and is what keeps
a scrub gesture from panning the canvas. `Populate from finals` fills the timeline with one
segment per final scene's chosen take, full length. `Export` opens
`dialog.showSaveDialog` and renders, streaming progress on `boards:jobProgress`.

Clips are re-encoded rather than stream-copied — trims land on arbitrary frames and the
concat demuxer on cut boundaries produces frozen frames. Veo output carries audio; keep it.

**Checkpoint:** finals populate a timeline, trim by hand, export an mp4 that plays.

---

## Phase 4 — AI trim

Gemini accepts video natively, but the app has no upload path. Add one to `http.ts`
(Gemini Files API resumable upload), then a `generateJson` call whose parts include
`file_data` references plus the scene text and target duration, returning
`{ takeId, startSec, endSec, reason }[]`.

`src/main/services/storyboard.ts` gains `proposeCut(db, boardId, takeIds)` — reads, uploads,
asks, **writes nothing** — and a matching `applyCut` that replaces the segment list in one
transaction. The timeline node gets a Manual / AI switch; AI mode shows the proposed
segments with reasons and only writes on approve, consistent with every other AI surface in
this app.

Budget: `{ timeoutMs: 180_000, output: 4096, minOutput: 2048, thinking: 1024 }`, and uploads
are capped at the selected clips only — never the whole board.

---

## Files touched, at a glance

| Area | Paths |
|---|---|
| Shared | `src/shared/types.ts`, `src/shared/ipc-contract.ts` |
| DB | `src/main/db/migrations.ts` (v12, v13), `src/main/db/takes.ts` *(new)*, `src/main/db/cut.ts` *(new)*, `src/main/db/storyboards.ts`, `src/main/db/settings.ts` |
| Services | `storyboard.ts`, `ai.ts`, `media.ts`, `backup.ts`, `video.ts` *(new)*, `takes.ts` *(new)*, `ffmpeg.ts` *(new)*, `providers/{veo.ts (new),http.ts,wire.ts,index.ts}` |
| IPC | `src/main/ipc/index.ts`, `src/preload/index.ts` |
| Renderer | `sections/Storyboards/{index.tsx,Canvas.tsx}`, `nodes/{SceneGroupNode,SceneRow,TimelineNode,TakeStrip}.tsx` *(new)*, `nodes/types.ts`, `lib/board-graph.ts`, `store/useStoryboards.ts`, `store/usePrefs.ts`, `sections/Settings/index.tsx` |
| Build | `package.json`, `electron-builder.yml`, `scripts/fix-node-pty.mjs` |

## Verification

Per phase, in order:

1. `npm run typecheck && npm run test` after every phase — the suite is node-only and fast.
2. **New tests:** `test/backup.test.ts` gains the manifest-completeness assertion (highest
   value in the plan); `test/board-graph.test.ts` gains group-node and retargeted-wire
   cases; new `test/takes.test.ts`, `test/cut.test.ts`, `test/ffmpeg-args.test.ts`,
   and `test/media.test.ts` gains `deck-media://take/<id>` parsing including the traversal
   rejections. `test/migrations.test.ts` covers v12/v13 applying to an existing db.
3. **Existing tests to expect churn in:** `storyboard-two-stage.test.ts`,
   `storyboard-plan.test.ts`, `providers.test.ts` (new slot + video allowlist),
   `board-graph.test.ts`, `secrets-slots.test.ts` (sixth slot).
4. **In-app, per phase:** `npm run dev`, open a board with scenes — Phase 1: the box renders
   and wires survive. Phase 2: set the video key in Settings, generate one scene, revise it,
   mark final. Phase 3: populate, trim, export, open the mp4. Phase 4: select takes, ask for
   a cut, compare against a manual one.
5. **Packaged check after Phase 3 only:** `npm run dist:mac`, then generate and export from
   the built `.app`. ffmpeg-from-asar and the executable bit are failures that *only* appear
   in a packaged build — the same class of bug as the node-pty `spawn-helper` trap.

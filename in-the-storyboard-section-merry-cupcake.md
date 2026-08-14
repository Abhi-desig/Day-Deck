# Day Deck — next milestone: Slack inbox, sheets, export, bin undo, README

## Context

v0.1 shipped (PR #2 merged, packaged app updated). The next milestone, chosen by
the user: the **Slack mention reroute** designed in `docs/slack-integration.md`
(design-only doc, no code yet), plus four companions — **character & location
sheets**, **export all prompts**, **bin undo**, and the **README + case study**
for the 2027 creative-technologist interview goal.

Decisions confirmed by the user:
- **User token** (`xoxp-`): mentions anywhere incl. DMs; enables the
  `search.messages` poller. The app holds a workspace-read credential — Keychain
  only, main-process only, no IPC getter, same discipline as Gemini keys.
- **Flow confirmed:** mention → review inbox → "Add to today" creates a slot
  (`source='manual'`, permalink in `source_ref` — never a new `slots.source`
  CHECK value, per the doc). Tracker picks it up when the slot is done.

Deltas from the design doc (it predates today's work):
- Migration is **v11** now, not v10 (v10 = brief refs, taken).
- `secrets.ts` is already generalized — but KEY_SLOTS carry *default-fallback*
  semantics that must NOT apply to Slack (a Slack call must never receive the
  Gemini key). Slack gets a parallel **named secret**, not a slot.
- The rate limiter exists; Slack polling paces itself (interval + Retry-After)
  and does not share the Gemini buckets.
- `openExternally()` (https/mailto allowlist) already exists in `main/index.ts`
  for the permalink action.
- Main→renderer channels now number three (`curriculumProgress`, pty pair,
  `binChanged`); `slack:mentions` is the fourth, via preload's `subscribe()`.

---

## Part 1 — Slack mention inbox

### 1.1 Migration v11 (`db/migrations.ts`, append-only)

`slack_mentions` exactly as specced in `docs/slack-integration.md:136-162`
(unique `(channel_id, message_ts)` claim index, `status` CHECK
new/filed/dismissed, `slot_id REFERENCES slots ON DELETE SET NULL`), plus the
`storyboard_sheets` table from Part 2 in the same migration.
**Add both tables to `TABLES` in `services/backup.ts`** — the doc's explicit
trap: a table missing from the manifest is never backed up *and wiped on every
restore*. Extend `test/migrations.test.ts` (populated-upgrade pattern) and
`test/backup.test.ts` (round-trip includes both tables).

### 1.2 Named secret (`services/secrets.ts`)

Add `setSecret/getSecret/clearSecret/secretStatus(name: 'slack')` reusing the
existing keyFile + safeStorage machinery (file `slack.key`, mode 0600, refuses
plaintext fallback). Deliberately separate from `KEY_SLOTS`: no default
fallback, no way for a Slack path to receive a Gemini key. No IPC getter.
Tests in `test/secrets-slots.test.ts`.

### 1.3 Slack client (`services/slack.ts`, new)

Follow `request()` in `services/gemini.ts` (3 attempts, retry 429/5xx only,
`AbortSignal.timeout`, typed error kinds) with the two Slack-specific
additions the doc calls out:
- **Honour `Retry-After`** on 429 instead of the fixed backoff.
- **Check `{"ok": false}`** in 200 responses or every failure looks like an
  empty poll.

Calls: `auth.test` (token test + own `user_id`), `search.messages` with query
`<@USER_ID>` sorted by timestamp (matches carry channel name, author id, text,
`permalink`), `users.info` for author display names (cached in-memory per
poll). Scopes: `search:read channels:history groups:history im:history
mpim:history users:read`.

### 1.4 Mentions repo (`db/slackMentions.ts`, new)

`claimMention` = `INSERT OR IGNORE` + `changes === 1` (the notify.ts `claim()`
pattern — survives restarts, no in-memory seen-set). `listMentions(status)`,
`fileMention(id, slotId)`, `dismissMention(id)`, `unreadCount`. Cursor (latest
`posted_at` polled) and poll interval live in `settings` keys `slack.cursor`,
`slack.poll_minutes` (default 3, clamp 2–15) — add to `SETTING` in
`db/settings.ts`.

### 1.5 Poller (`services/slackPoller.ts`, new)

Copy `services/reminders.ts` shape verbatim: 60s `setInterval` + `unref()` +
immediate first pass, acting only when `now - lastPollMs >= interval` — the
doc's own reasoning (macOS suspends timers; a wall-clock tick can't drift).
Skips silently when no token. On new claims: push unread count to all windows
on `IPC.slackMentions`. Start after `createWindow()` in `main/index.ts`, stop
in `will-quit` (the reminders precedent).

### 1.6 IPC + preload (`ipc-contract.ts`, `ipc/index.ts`, `preload/index.ts`)

Channels: `slackStatus` (`{tokenPresent, encryptionAvailable, pollMinutes}`),
`slackSetToken` / `slackClearToken` / `slackTestToken` (auth.test → team/user
name), `slackSetPollMinutes`, `slackList(status)`, `slackFile(id, title, date)`
— validates title ≤60 chars, calls `createSlot` (`source:'manual'`,
`sourceRef: permalink`, keyword auto-tagging comes free), marks filed;
`slackDismiss(id)`; `slackOpen(id)` — main looks the permalink up from the row
and calls `openExternally()` (the renderer never supplies a URL). Event:
`slackMentions` via preload `subscribe()`.

### 1.7 UI

- **Inbox panel** — app-level slide-over modelled on
  `components/shell/DataPanel.tsx` (not a seventh section; empty most of the
  time). **Apply `no-drag`** to the container — the title-bar drag-strip trap
  documented in the doc and `globals.css:135`. Rows newest-first: channel,
  author, text, relative time; actions **Add to today** (title pre-truncated,
  editable inline before filing), **Dismiss**, **Open in Slack**. Filed and
  dismissed drop out of the default view.
- **Dock button** with unread badge, under the divider next to the data-panel
  button (`Dock.tsx` — mind `centreOf`/`DIVIDER_OFFSET` for magnification).
- **Settings block** "Slack" in `sections/Settings/index.tsx`: token
  entry/Test/Clear (reuse the KeyRow pattern), poll-interval input.
- **Store** `store/useSlack.ts`: mentions, unread, status; subscribe on mount.

### 1.8 Tests

Client (`vi.stubGlobal('fetch')`): ok:false surfaces as error, Retry-After
honoured, auth fail no-retry. Repo: claim idempotency, cursor advance, filing
creates the slot with permalink `source_ref` and flips status, dismissed rows
stay claimed (never re-polled into view).

---

## Part 2 — Character & location sheets (storyboards)

The board locks the *look*; sheets lock the *subjects* — the standard failure
of AI shot consistency.

- **Table** (in migration v11): `storyboard_sheets(id, board_id → CASCADE,
  kind CHECK ('character','location'), name, description, sort_index,
  created_at)`. Board-scoped (unlike styles): a cast belongs to one film.
- **CRUD**: `db/storyboards.ts` + channels `sheets:list/create/update/delete`
  following the lists/items pattern, preload + `useStoryboards` additions.
- **Prompt injection**: `services/storyboard.ts` passes sheets into both
  stages; `buildScenePrompt` gets a "CAST & PLACES" context block;
  `buildPromptWriterPrompt` gets the hard rule — *when a shot shows a named
  character or location, restate that sheet's description in full, identical
  wording every time* (same mechanism as the style block).
- **UI**: "Cast & places" collapsible panel beside `StylePanel` (same
  chip+editor shape): name, kind toggle, description `Field`.
- **Tests**: prompt-builder blocks in `test/storyboard-ai.test.ts`; CRUD +
  cascade in `test/storyboards.test.ts`.

## Part 3 — Export all prompts

- **Pure lib** `renderer/src/lib/storyboard-export.ts`:
  `exportBoard(board, frames, style, sheets) → markdown` — title, brief, look
  block (`renderStyle` is main-side; duplicate the tiny formatter or move it
  to shared), then per scene: number/title/duration/description/prompt.
  Unit-tested (`test/storyboard-export.test.ts`).
- **Save path**: channel `boards:exportPrompts` → main `dialog.showSaveDialog`
  (default `<board>-prompts.md`) + `writeFileSync`; also a **Copy all** button
  (reuses `lib/clipboard.ts`). Button in the Storyboards header next to
  *Write prompts*.

## Part 4 — Bin undo window

- `services/projectAssets.ts`: `fileInto` already computes exact
  `source → destination` pairs; record them per operation in an in-memory
  journal (`services/bin-undo.ts`, new): `{id, pairs, mode, atMs}`, capped,
  entries expire after **5 minutes**. Return the journal id on `AssetsMoved`.
- `undoFiling(id)`: reverse each pair destination→source (`renameSync`, EXDEV
  → copy-verify-trash, skip if source name now taken — same survivability
  rules as the forward move), report what came back.
- IPC `bin:undo`, store + UI: the BinPanel notice gains an **Undo** button
  while the entry is live.
- Tests: reverse round-trip in `test/bin.test.ts` with tmp dirs; expiry.

## Part 5 — README + case study (repo, no app code)

- **`README.md`**: what Day Deck is (the six rooms, one paragraph each), the
  design philosophy ("AI proposes, you approve"), architecture mermaid diagram
  (renderer ⇄ typed IPC ⇄ main services ⇄ SQLite/Keychain/Gemini), security
  posture bullets, stack, `pnpm dev` / `dist:mac` instructions, screenshot
  placeholders for the user to fill.
- **`docs/case-study.md`**: the CT-interview narrative — problem, the
  storyboard pipeline (brief → look → scenes → prompts with approval gates),
  the React Flow pointer-events debugging story, the decompose-vs-schedule
  decision, honest limitations. Written to be lifted into a portfolio page.

---

## Suggested commit split (user commits themselves)

1. `feat(slack): mention inbox with review-and-file flow` (Parts 1)
2. `feat(storyboards): character/location sheets and prompt export` (2+3)
3. `feat(bin): five-minute undo window` (4)
4. `docs: README and case study` (5)

## Verification

- `pnpm typecheck` + `pnpm test` green after each part; new suites:
  slack client/repo, sheets prompts, export lib, bin undo.
- Manual: save a Slack user token in Settings → Test shows workspace name →
  mention yourself in Slack → within the poll interval the dock badge
  increments → open inbox → edit title → Add to today → slot appears on the
  day card with a working "Open in Slack" permalink; dismiss another mention
  and confirm it never reappears. Add a character sheet, run *Write prompts*,
  confirm every prompt showing that character restates the sheet. Export a
  board to `.md`. Move a bin file, press Undo, confirm it returns to Desktop.
- Rebuild the installed app afterwards (`pnpm dist:mac` + swap) so the
  packaged copy matches — the lesson from today.

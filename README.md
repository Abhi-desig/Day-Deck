# Day Deck

Your life as a deck of day cards. Local-first, offline, macOS.

Seven sections: **Today** (the deck), **Projects**, **Goals Admin**, **Tracker**,
**Stickers**, **Storyboards**, **Settings**.

Everything lives in SQLite on your own machine, and every feature except
generation works with the network off. Outbound calls go to whichever AI
providers you have configured, and they are made **only from the main process**
— `services/providers/http.ts` is the single place this app opens a socket, so
timeouts, retries, rate-limit handling and "what a refusal means" are decided
once rather than per feature.

---

## Running it

```bash
pnpm install && pnpm dev
```

If the first `pnpm dev` fails with `Error: Electron uninstall`, pnpm skipped
Electron's binary download. Run this once:

```bash
node node_modules/electron/install.js
```

Other commands:

```bash
pnpm test        # vitest, node-only and fast — no DOM, no network, no spawning
pnpm typecheck   # tsc over main/preload and renderer separately
pnpm build       # typecheck + bundle to out/
pnpm dist:mac    # unsigned arm64 .dmg
```

The database lives at `~/Library/Application Support/day-deck/daydeck.db` and
is a plain SQLite file — open it with `sqlite3` any time. Generated video clips
sit beside it in `takes/`, one `<takeId>.mp4` per take.

**`ffmpeg-static` downloads its binary in a postinstall script**, so that script
is not optional here: skip it and the package is a path helper pointing at a
file that was never fetched, which fails at export time rather than at install
time. It is approved in `pnpm-workspace.yaml`.

Only one Day Deck may run at a time — there is a single-instance lock. If
`pnpm dev` starts and exits immediately with no error, a packaged copy is
already running; quit it first.

---

## Shape of the code

```
src/
├── main/       Node, privileged. SQLite, IPC handlers, bootstrap services.
├── preload/    The only bridge. contextBridge → window.deck, nothing else.
├── shared/     Types, date helpers, IPC contract. Imported by BOTH sides.
└── renderer/   React. No fs, no db, no Node — every call is an IPC round-trip.
```

`contextIsolation` is on, `nodeIntegration` is off, and the renderer cannot
navigate anywhere. Packaged builds get a strict CSP with `connect-src 'self'`,
which is what keeps the renderer offline — every provider call goes through the
main process, so nothing in the page can reach the network even if it wanted to.
`deck-media:` is allowed in `img-src`/`media-src` so linked references and
generated clips render; it serves ids, never paths, and rejects anything with a
separator in it.

Six ideas hold the data model together:

- **`slots` is the spine.** Everything on a day card — a manual task, a
  curriculum topic, a weekly amber task — is a row in `slots`, distinguished by
  `source`. One table, one timeline, one ordering rule.
- **Rollover tombstones, it does not move.** An unfinished slot on a past day is
  marked `rolled` and a *new* slot is created on today pointing back at it. The
  miss stays visible in history instead of being quietly rewritten, and
  re-running is a no-op because only `open` rows are eligible.
- **The Tracker has no table.** It is a query over completed slots grouped by
  day and category. That is what "automatically logged" means.
- **The model decomposes, local code schedules.** The model is asked only for an
  ordered list of topics with effort estimates — never for dates. A pure
  function in `services/scheduler.ts` maps them onto real days. Models are
  unreliable at "land exactly on the deadline"; arithmetic is not. It also
  makes reflow instant, free, and fully offline.
- **Propose reads and asks; apply writes, in one transaction.** Every AI surface
  in the app is split in two, and the split lives in the *service*, not the
  dialog — so "nothing changes until you approve it" is a property of the API
  rather than a promise the UI is making on its own. A plan you reject costs
  nothing but the wait, and one you partly accept is applied exactly as partly
  as you said. `services/video.ts` is the single deliberate exception, and says
  why in its own header: a job *is* durable state.
- **Migrations are forward-only and append-only.** `MIGRATIONS` is indexed by
  SQLite's `user_version`; a shipped entry is never edited or reordered. A
  backup written by a newer build is refused outright rather than restored with
  columns silently dropped.

## Goals Admin

Paste a curriculum, set a deadline, and every topic gets a date. Topics become
`source='curriculum'` slots on the deck, and ticking one off on a day card
marks the topic done.

Topics are the source of truth; curriculum slots are a projection of them.
Reconciling drops open slots whose topic has moved and creates whatever is
missing, with two hard rules: a completed slot is never deleted, and a pending
topic never gets a second live slot.

**Reflow** repacks everything still pending across the days you have left. It
costs nothing and works offline, so it always previews the exact date changes
and waits for confirmation before rewriting a month of plans. When the
remaining work no longer fits, it says how many minutes a day it would actually
take rather than quietly dropping topics.

## AI providers and key slots

Any provider, per feature. `PROVIDER_INFO` in `shared/types.ts` is the whole
registry — Gemini, OpenAI, Anthropic, xAI, Groq, DeepSeek, Mistral, OpenRouter,
and `custom` for anything OpenAI-compatible (Ollama, LM Studio, a company
gateway). Adding a vendor that speaks an existing dialect is an entry in that
table and nothing else, because the adapters are keyed by **wire**, not by brand.

Keys live in **slots**, one per feature: `default`, `goals`, `agent`, `scenes`,
`prompts`, `video`. A slot with no key of its own falls back to `default`, so one
key runs the whole app — but the fallback is **refused across vendors**, because
a key is only meaningful to the provider it came from. Borrowing one produces an
authentication failure whose message blames the key rather than the mismatch,
which is the single most confusing way this can fail.

Keys are encrypted with the OS keychain, never leave the main process, and are
deliberately excluded from backups. There is no IPC handler that returns one.

Three failure modes get their own sentences rather than a generic error, because
each has a different fix and none of them is obvious from a status code:

- **A rejected key.** Gemini answers a bad key with a **400** saying "API key not
  valid", so status alone would file the most common failure here as a malformed
  request.
- **A thin balance.** A request reserves its *whole* output ceiling up front, so
  an account with a little credit refuses a call whose answer would have used a
  fraction of it. When the provider names an affordable figure, the adapter
  re-asks for exactly that instead of failing.
- **An overloaded model.** 503/529 is not breakage — the request and the key were
  both fine. It gets its own longer, jittered retry budget rather than eating one
  sized for failures that do not heal.

### Video is a separate registry

Video generation is not a flavour of text generation: every video API is
submit → poll a long-running operation → download bytes, where a text call is
request in, JSON out. So `VideoAdapter` is its own interface, and
`PROVIDER_INFO.videoWire` says which dialect a provider speaks, or `null`.

`null` is the honest answer for most of the table. OpenRouter, Groq, DeepSeek and
the rest route *language* models — there is no video endpoint behind them, so a
key that works perfectly for prompts cannot generate a clip however it is
configured. The app says that, and names the providers that can, instead of
letting the call 404 about a missing model.

Today: **Google Veo**, via the Gemini API, and it needs a key with billing
enabled. Adding another is one adapter file beside `providers/veo.ts` plus a name
in `VIDEO_WIRES`.

## Storyboards

A canvas per film. The brief is pinned at the origin; scenes, reference lists and
a placed style hang off it. Reference media is **linked, never copied**, and the
renderer never learns a path — it asks for `deck-media://item/<id>` and the main
process does the lookup, so there is no path in the URL to traverse.

The pipeline runs prompts → clips → cut, in four stages:

1. **Scenes in one container.** A board of twelve scenes is a list you read top
   to bottom, not twelve rectangles to arrange, so they stack into one box wired
   to the brief and the spine collapses from N edges to one. Each row carries its
   own target handle whose id is the frame id, so a reference wire still lands on
   the scene it belongs to rather than on the box. The `sceneLayout` pref flips
   back to the free canvas, and nothing is rewritten by the switch — every frame
   keeps its `x/y/w/h` either way.
2. **Generation, takes, and revision.** Generate a clip from a scene's prompt.
   **Every take is kept** — "regenerate" must never be the same gesture as "throw
   the last one away", because the previous take is often the better one and
   there is no undo for something that has to be paid for twice. Type what you
   want changed in words and the prompt is rewritten for approval; it applies
   through the same channel the prompt pass uses, so a revision has no write path
   of its own.
3. **The cut.** A timeline node whose segments are `(take, start, end)` — which
   is what lets one scene contribute twice, or two of its takes back to back.
   Populate from the scenes marked Final, trim by hand, export to mp4.
4. **AI trim.** The model watches the selected clips and proposes cut points with
   a reason for each. Nothing is written until you accept it.

Three guardrails, because this is the one part of the app that spends real money:

- **One video job in flight, ever.** Checked against the database rather than a
  variable in memory, so a job left running by a previous launch still counts.
- **The count is stated before anything is submitted.** Unlike a token budget,
  this one is denominated in money you will see on a bill.
- **Jobs survive a quit.** The provider's operation name is written down *before*
  the wait begins, and re-polled at the next launch — otherwise quitting
  mid-generation loses a clip the provider has already been paid to produce.

### ffmpeg

`ffmpeg-static` only. There is deliberately **no ffprobe**: `ffprobe-static@3.1.0`
ships an x86_64 binary inside its `darwin/arm64` directory, so on Apple Silicon
without Rosetta it cannot run at all — and it fails as `bad CPU type in
executable`, which reads like a corrupt download rather than a package shipping
the wrong file. Durations come from `ffmpeg -i` instead: one binary, and one that
is by construction the same architecture as the one doing the encoding.

Clips are **re-encoded rather than stream-copied**. A trim lands on an arbitrary
timestamp and `-c copy` can only cut on a keyframe, so a stream copy either moves
the cut or leaves undecodable frames at the head of every segment — which plays
back as a freeze. Joining uses the concat *filter*, not the demuxer, for the same
class of reason: the demuxer is cheaper and produces frozen frames at boundaries
unless every input shares a codec and timebase, which separately generated clips
do not.

The argument builders are **pure and exported**, so `test/ffmpeg-args.test.ts`
asserts the whole decision surface without ever starting a process. A wrong flag
here is not a crash — it is an export that succeeds and produces a film with
frozen frames at every cut, discovered by watching the file.

An executable **cannot run from inside an asar**, so `ffmpeg` is in `asarUnpack`
and `services/ffmpeg.ts` rewrites `app.asar` → `app.asar.unpacked` on the path
the package reports. Same trap `node-pty`'s `spawn-helper` already cost this
repo; both are covered by `scripts/fix-node-pty.mjs`, which also restores the
executable bit pnpm's content-addressable store does not preserve.

## Animation

`motion` (MIT, formerly Framer Motion) is the engine. Components are vendored
from Motion-Primitives and Magic UI, both MIT, and reimplemented against our own
tokens so nothing drifts.

Every spring and easing lives in `src/renderer/src/lib/motion.ts`. If a
component hardcodes a duration, the reduced-motion pass and the feel of the app
come apart — so it does not.

The deck derives its whole peek treatment (scale, lift, blur, tilt, z-order)
from one continuous number: each card's distance from centre in card widths.
That keeps the stack glued to your finger instead of stepping between states.
Advancing by keyboard, flick or trackpad all route through the same `commit()`,
which pre-offsets `dragX` by exactly one card width before the focus changes —
so all three produce identical motion.

`MotionConfig reducedMotion="user"` respects the OS setting globally.

---

## Status

- **Phase 1 — done.** Shell, nav, SQLite, IPC, the swipeable deck, slot CRUD,
  rollover, weekly amber seeding.
- **Phase 2 — done.** Goals Admin, encrypted key vault, curriculum decomposition,
  the deterministic scheduler, curriculum slots on day cards, offline reflow.
  Not built: the optional "re-scope" path for when the remaining work genuinely
  cannot fit — reflow reports the shortfall instead.
- **Phase 3 — done.** Projects, embedded Monaco editor, real terminal.
- **Phase 4 — done.** Tracker, Stickers, tags, the bin, light theme, packaging.
- **Providers — done.** Any vendor per slot, live model lists, and refusals that
  name the actual mistake.
- **Storyboards — done.** Boards, scenes, reference lists, cast sheets, styles,
  two-stage planning, the scene container, video generation with takes, the
  revision loop, the ffmpeg timeline and export, and AI-proposed cut points.

Verified end to end: the full test suite, both typechecks, a packaged
`dist:mac` build, the v11 → v13 migration against a real database, and the
render pipeline against real media through the packaged app's own bundled
binary. **Not verified:** live Veo generation and AI trim, which need a
billing-enabled Google key in the `video` slot.

Keyboard: `←` `→` swipe days, `⌘T` jump to today, `Esc` closes panels.
Quick-add parses what you type: `09:30 Ship the deck 45m`.

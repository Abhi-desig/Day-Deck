# Day Deck

Your life as a deck of day cards. Local-first, offline, macOS.

Five sections: **Today** (the deck), **Projects**, **Goals Admin**, **Tracker**, **Stickers**.
Everything lives in SQLite on your own machine. The only outbound call the app
will ever make is to the Gemini API, from the main process, in Goals Admin.

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
pnpm test        # vitest — rollover, weekly seeding, date arithmetic
pnpm typecheck   # tsc over main/preload and renderer separately
pnpm build       # typecheck + bundle to out/
pnpm dist:mac    # unsigned arm64 .dmg
```

The database lives at `~/Library/Application Support/day-deck/daydeck.db` and
is a plain SQLite file — open it with `sqlite3` any time.

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
navigate anywhere. Packaged builds get a strict CSP with `connect-src 'self'`.

Four ideas hold the data model together:

- **`slots` is the spine.** Everything on a day card — a manual task, a
  curriculum topic, a weekly amber task — is a row in `slots`, distinguished by
  `source`. One table, one timeline, one ordering rule.
- **Rollover tombstones, it does not move.** An unfinished slot on a past day is
  marked `rolled` and a *new* slot is created on today pointing back at it. The
  miss stays visible in history instead of being quietly rewritten, and
  re-running is a no-op because only `open` rows are eligible.
- **The Tracker has no table.** It is a query over completed slots grouped by
  day and category. That is what "automatically logged" means.
- **Gemini decomposes, local code schedules.** Gemini is asked only for an
  ordered list of topics with effort estimates — never for dates. A pure
  function in `services/scheduler.ts` maps them onto real days. Models are
  unreliable at "land exactly on the deadline"; arithmetic is not. It also
  makes reflow instant, free, and fully offline.

## Goals Admin

Paste a curriculum, set a deadline, and every topic gets a date. Topics become
`source='curriculum'` slots on the deck, and ticking one off on a day card
marks the topic done.

The API key is encrypted with the OS keychain and read only inside the main
process. There is deliberately no IPC handler that returns it — the renderer
can learn *whether* a key exists and nothing else.

Topics are the source of truth; curriculum slots are a projection of them.
Reconciling drops open slots whose topic has moved and creates whatever is
missing, with two hard rules: a completed slot is never deleted, and a pending
topic never gets a second live slot.

**Reflow** repacks everything still pending across the days you have left. It
costs nothing and works offline, so it always previews the exact date changes
and waits for confirmation before rewriting a month of plans. When the
remaining work no longer fits, it says how many minutes a day it would actually
take rather than quietly dropping topics.

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
- **Phase 2 — done.** Goals Admin, encrypted key vault, Gemini decomposition,
  the deterministic scheduler, curriculum slots on day cards, offline reflow.
  Not built: the optional "Gemini re-scope" path for when the remaining work
  genuinely cannot fit — reflow reports the shortfall instead.
- **Phase 3** — Projects, embedded Monaco editor, real terminal.
- **Phase 4** — Tracker, Stickers, polish, packaging.

Keyboard: `←` `→` swipe days, `⌘T` jump to today, `Esc` closes panels.
Quick-add parses what you type: `09:30 Ship the deck 45m`.

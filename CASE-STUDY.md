# Day Deck — a case study in vibe-coding a product

*A local-first macOS app that turns big goals into a swipeable deck of day cards — and grew a film studio on the side.*

| | |
|---|---|
| **Role** | Solo creative technologist — product, design and engineering direction, pair-built with an AI coding agent |
| **Method** | Vibe-coding, but disciplined: written plans → decision gates → agent implementation → human review, tests and git control |
| **Timeline** | ~10 days from first plan document to the current feature branch |
| **Stack** | Electron · React · TypeScript · SQLite (better-sqlite3) · Monaco · node-pty · ffmpeg · motion |
| **Scale** | 42 commits · ~70,000 lines added, ~3,600 removed · 7 app sections · 14 schema migrations · ~50 test files |

---

## Overview

Day Deck is a desktop planner where life runs as a deck of day cards you shuffle with a flick. Each card holds the day's real work: tasks decomposed from long-running goals, reminder notes, and quick-added items. Around that spine grew six more rooms — an embedded coding workspace with a real terminal, a time tracker derived from what actually got done, a sticker wall, a full storyboard-to-video studio, and a settings vault that can point every AI feature at a different provider.

The interesting part isn't any single feature. It's that one person, working conversationally with an AI agent, shipped a packaged, test-guarded, multi-surface native app in about ten days — without giving up architectural judgment along the way.

<!-- screenshot: the deck, today's card centered with the amber border beam -->

## The challenge

Curriculum-style self-teaching dies the same death every time: someone converts an ambitious goal into a syllabus, and nobody converts the syllabus into *what do I do today*. Missed days silently wreck the schedule, and the guilt compounds faster than the learning.

Day Deck's founding bet was to make **the day the atomic unit** — and to keep an honest diary of where time actually went, instead of a wishful one.

Constraints, chosen deliberately:

- **Local-first and offline.** One SQLite file, no accounts, no sync service. AI calls are the only thing that touches the network, and they live behind one HTTP module in the main process.
- **Privacy as architecture.** API keys sit in OS-keychain-encrypted files, never in the database, never exposed over IPC, never included in backups.
- **Showcase-tier motion.** Not subtle fades — the deck should feel like shuffling physical cards, and opening a project should be a single continuous shared-element expansion into a workspace.

## Process — what vibe-coding actually looked like

"Vibe-coding" here didn't mean prompting and praying. It settled into a repeatable loop:

**Plans before prompts.** Every milestone started as a written plan document with an auto-generated codename — the master plan was *iridescent-cookie*, the storyboard milestones were *merry-cupcake* and *modular-waffle*, the next version is *frosted-doughnut*. Plans named phases, risks, invariants, and explicit "highest-risk item" callouts before any code existed.

**Decisions with receipts.** Forks in the road were resolved as explicit either/or choices, and the *rejected* option was recorded alongside the chosen one: per-goal daily budgets beat a priority-weighted global scheduler; a watch-and-approve desktop bin beat both fully-automatic file rules and a manual panel; display-only AI subtopics beat per-point checkboxes. Months of "wait, why did we do it this way?" pre-answered.

**One principle for both the product and the workflow: AI proposes, you approve.** In the app, nothing AI-generated writes to the database without an explicit apply step — plan previews, prompt rewrites, cut proposals all wait for a click. In the build process, the same rule: the agent drafted, the human reviewed and ran every commit and push by hand.

**A hard split between model and math.** The load-bearing design call of the whole app: **the model decomposes, local code schedules.** The LLM returns only an ordered topic list with effort estimates; a pure, unit-tested scheduler assigns dates deterministically. Deadline arithmetic stays exact, replanning is instant and free, and the app works on a plane.

**Tests as the contract between sessions.** With an agent doing much of the typing, invariants moved into the test suite so they'd survive any future conversation: a completed slot is never deleted by reconciliation; a pending topic never gets two live slots; a day with no goal answers without calling the API at all; every backup table is asserted against the live schema so a forgotten manifest entry can't silently wipe data on restore.

**Measure, don't vibe.** When section-switching "felt laggy," the fix started with instrumentation, not guesses — driving the packaged app over the DevTools protocol and counting. The transition had **zero milliseconds** of long tasks; the real waste was 28 IPC round trips per visit, hidden by stores that survived unmount. Guarding the loads took repeat visits to zero calls. The intentional 280 ms transition was left alone, because shortening it would only make the app *feel* faster while being exactly as slow.

## Solution — the seven rooms

**The deck.** Every card's scale, lift, blur, tilt and z-order derive from one continuous number — distance from center in card widths — so keyboard, flick and trackpad all route through the same commit function. Today's card wears the app's one persistent "you are here": an animated amber border.

**Goals.** Describe a goal and a deadline; the model breaks it into an ordered curriculum, the local packer lays it across the calendar against a per-goal daily budget, and an overnight rollover carries misses forward visibly — the old slot is tombstoned, not moved, so the tracker stays honest.

**Projects.** Each project opens from a card into an embedded workspace — Monaco editor, a real pty-backed terminal, git status — with an "Open in VS Code" escape hatch rather than a pretense of being an IDE.

**Tracker.** Deliberately has no table. It's a query over completed slots, which is what "automatically logged" should mean.

**Stickers.** A free-form board for the stuff that isn't a task, with drag physics and optional folders.

**Storyboards.** The room that turned a planner into a studio. A pan/zoom canvas per film: a pinned brief, two-stage AI planning (scenes first, then per-scene cinematographer-grade prompts), character and location sheets whose descriptions are restated verbatim in every prompt to fight AI shot drift, reference images wired film-wide or per-scene, and 18 seeded visual styles. From there: video generation with a takes-and-revision loop ("make it slower and colder" rewrites the prompt for approval), a timeline trimmer, and an ffmpeg export to a finished mp4. Money has its own guardrails — one video job in flight ever, and every batch states its exact count before submitting, because this budget is denominated in currency the user can see.

**Settings.** Eight named AI providers plus any OpenAI-compatible endpoint, adapters keyed by wire rather than brand, and six per-feature key slots so the goals planner, the day agent and the video pipeline can each use a different vendor — with cross-vendor key borrowing explicitly refused instead of failing cryptically.

<!-- screenshot: storyboard canvas — brief, scene container, wired references -->

## Six bugs worth telling

1. **Every terminal spawn failed with a bare `posix_spawnp failed`.** The package manager's content-addressable store doesn't preserve file modes, so node-pty's `spawn-helper` arrived non-executable. The fix is a postinstall script and an unpack rule — and a new reflex: packaged builds fail in ways dev builds never show.
2. **A pinned card whose textareas were all dead.** React Flow stamps `pointer-events: none` on nodes that are neither selectable nor draggable — and a double-click handler doesn't count as interactive. One style override, found the hard way, now pinned by a test.
3. **The deck swipe felt slow — the spring was innocent.** Blur was re-enabled the instant a drag ended, so the entire settle animated four blurred layers. A `moving` flag held until the settle completes fixed it; trackpad momentum needed a falling-edge latch so one flick doesn't advance two days.
4. **The light theme that half-shipped.** Tailwind v4 swaps color tokens at runtime but bakes shadow literals in at build time — an elevation ramp in `@theme` silently never switches. Verified by grepping the built CSS, which is now the house rule for claims like this.
5. **A bad API key that reports as a malformed request.** One provider answers an invalid key with 400, not 401 — and a credit-metered gateway reserves your entire output ceiling before running anything, refusing jobs your balance could actually cover. Lesson worth framing: **an output budget is a bill quoted up front, not a safety cap.**
6. **The database that lied when copied.** A live SQLite file in WAL mode, copied plainly, yields the last checkpoint — silently missing recent writes. `.backup` or nothing.

## Impact

- **Shipped:** a packaged arm64 macOS app (DMG), from empty folder to installable in ten days.
- **Scale honestly earned:** 42 commits, ~70,000 lines added and ~3,600 deleted across 2 merged PRs, with conventional-commit hygiene throughout.
- **Performance receipts, not vibes:** 60 fps deck interaction; section mounts at 89 ms cold / 32 ms warm; redundant per-visit IPC reduced 28 → 0.
- **Resilience by construction:** 14 forward-only schema migrations; backups asserted complete against the schema; AI failure modes (bad key, thin balance, overloaded model) each classified and handled distinctly.
- **What I'd change:** the video path is verified against a local stub of the provider protocol, not yet against every live vendor; the build is unsigned; and the app is single-machine by design — sync is a philosophical fight for another version.

## What's next

The next version is already planned as four changes: a **locked cast** system that anchors every character to one approved portrait and derives a five-view reference pack from it, so the same face survives every generation; **style families** that organize the seeded looks into browsable categories; an **editable prompt desk** exposing every AI process's role and rules as user-editable text with sensible pinned guardrails; and finishing the **lag work** — measurement-first, with a standing rule against hiding latency by shortening animations.

## Reflection

Vibe-coding at this scale worked because the vibes were fenced. The agent supplied speed and breadth; the human supplied taste, priorities, and veto power — and the artifacts that made the collaboration durable were boring ones: plan documents, recorded decisions, invariant tests, and a habit of measuring before optimizing. The most transferable insight became the product's own design language: **AI proposes, you approve** — a rule that turns generative systems from slot machines into instruments.

*Built solo, conversationally, in public view of its own git history.*

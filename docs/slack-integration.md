# Slack integration — design

**Status:** design only. No code has been written for this.

The ask: when you are mentioned in Slack, the message is pulled into Day Deck, you
review it there, and if it turns out to be work you file it into the Tracker in one
click.

This document exists because two things about the request collide with how this app
is built, and both need a decision from you before any of it is worth writing.

---

## 1. The Tracker has no table

This is the first thing to understand, because it changes what "add it to the
Tracker" means.

There is no `tracker` table and no tracker write path. From
[services/tracker.ts:24](../src/main/services/tracker.ts):

> The Tracker is a read, not a record. Nothing writes tracker data: every number
> here is derived from slots that are already `done`.

The Tracker is a view over `slots WHERE status = 'done'`, bucketed by
`completed_at`. So "add this Slack message to the Tracker" means **create a slot** —
a piece of planned work on a day. It appears in the Tracker later, when you finish
it. That is almost certainly what you want anyway; it just means the button should
probably read *"Add to today"* rather than *"Add to Tracker"*, because that is what
it does.

The call is [`createSlot(db, input)`](../src/main/db/slots.ts) — it already handles
ids, defaults, `sort_index` and keyword auto-tagging, so a Slack item picks up your
existing tag rules for free.

**One constraint worth knowing now:** `slots.source` has a
`CHECK (source IN ('manual','curriculum','amber_weekly','project'))` constraint, and
SQLite cannot alter a CHECK. Adding `'slack'` as a source value would mean rebuilding
the whole `slots` table — the most valuable table in the database — for a label.

Use `source = 'manual'` with the Slack permalink in `source_ref` instead. Nothing
reads `source_ref` for manual slots today, and it gives the row a link back to the
thread it came from.

## 2. This app has no network, on purpose

Day Deck makes exactly one outbound request in the entire codebase — the Gemini call
in [services/gemini.ts:73](../src/main/services/gemini.ts). The renderer cannot reach
the network at all: production CSP is `connect-src 'self'`, and the comment above it
in [main/index.ts](../src/main/index.ts) says plainly that this is *what keeps this
app offline*.

So every Slack call lives in the main process, and the renderer only ever sees rows
that main has already fetched. That is not a new pattern — it is exactly how Gemini
already works.

---

## Transport: three options, one recommendation

### Recommended — poll `search.messages`

**Why:** it needs no new dependency and no new architectural concept. The app has
two runtime dependencies (`better-sqlite3`, `node-pty`) and no HTTP client, no
WebSocket code, and no OAuth. A poller is a `setInterval` and a `fetch`, both of
which already exist here.

More to the point, the polling pattern is already written down as house style. From
[services/reminders.ts:6](../src/main/services/reminders.ts):

> This polls once a minute rather than computing the next fire time and sleeping
> until then. A long `setTimeout` is the obvious design and the wrong one here:
> macOS suspends timers across sleep… A minute tick re-reads the wall clock every
> time and cannot drift.

That reasoning applies verbatim. A laptop that was closed for four hours should come
back and find its mentions, not discover that its timer never fired.

**Cost:** mentions arrive up to one poll interval late. For a review-it-later inbox
that is irrelevant — a 2–5 minute interval is plenty and is gentler on the rate limit
than a minute.

### Alternative — Socket Mode

Real-time, and it needs no public URL, which is what makes it viable for a desktop
app at all. The cost is a `ws` dependency (or Node's still-experimental global
`WebSocket`), plus reconnect/backoff logic, plus a second long-lived connection to
supervise on sleep and wake. That is a lot of new machinery for "I want to read this
in ten minutes rather than now."

Worth revisiting only if you find yourself wanting Slack to feel live.

### Ruled out — Events API

Needs a public HTTPS endpoint Slack can POST to. A desktop app does not have one, and
adding a tunnel or a relay server would end the local-first property outright.

---

## The open question — which token

**This is the decision that shapes everything else, and it is yours to make.**

| | Bot token (`xoxb-`) | User token (`xoxp-`) |
|---|---|---|
| Sees | only channels the bot is invited to | everything you can see |
| DMs | no | yes |
| Group DMs | no | yes |
| Private channels | only if invited | yes, the ones you are in |
| `search.messages` | **not available** | yes |
| Feels like | a bot in your workspace | your own account |
| Workspace admin | usually fine | may need approval |

"When I am mentioned" most naturally means *anywhere*, including DMs — and a bot
token cannot do that. It also cannot use `search.messages` at all, which is the whole
recommended transport.

So the honest reading is that this needs a **user token**, and you should know what
that means: the app would hold a credential that can read everything you can read in
that workspace. It stays in the macOS Keychain and never leaves the main process, but
it is a different class of secret from a Gemini API key.

If that is not acceptable, the fallback is a bot token, invited to specific channels,
polling `conversations.history` on each — no DMs, and no search. Narrower, and
possibly enough.

**Scopes, user token:** `search:read`, `channels:history`, `groups:history`,
`im:history`, `mpim:history`, `users:read`.

---

## Data model

One new table, one claim table. Migration v10.

```sql
-- A mention pulled in for review. Not a task: it becomes one only if you say so.
CREATE TABLE slack_mentions (
  id          TEXT PRIMARY KEY,
  -- Slack's own identifiers, so a permalink can be rebuilt and a duplicate spotted.
  channel_id  TEXT NOT NULL,
  message_ts  TEXT NOT NULL,
  thread_ts   TEXT,
  permalink   TEXT NOT NULL,
  channel_name TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT '',
  text        TEXT NOT NULL DEFAULT '',
  -- Slack's ts, converted. The inbox sorts on this, not on when we noticed.
  posted_at   TEXT NOT NULL,
  -- 'new' -> you have not looked; 'filed' -> became a slot; 'dismissed' -> not work.
  status      TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new','filed','dismissed')),
  -- The slot it became, if it became one. SET NULL: deleting the task should not
  -- shred the record of where it came from.
  slot_id     TEXT REFERENCES slots(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
-- The pair is Slack's own identity for a message. This is what makes the poller
-- idempotent — see below.
CREATE UNIQUE INDEX idx_slack_once ON slack_mentions(channel_id, message_ts);
CREATE INDEX idx_slack_status ON slack_mentions(status, posted_at);
```

Note the CHECK on `status` is fine here because it is in a `CREATE TABLE` — the
problem with `slots.source` is only that altering an *existing* CHECK is impossible.

### Idempotency: a claim, not a memory

The poller must never show you the same mention twice, and must survive a restart
mid-poll. The pattern already exists in this codebase twice —
[`claim()` in services/notify.ts:72](../src/main/services/notify.ts) and
`weekly_seed_log` — and it is `INSERT OR IGNORE` against a unique index:

```ts
const claimed = db.prepare(
  `INSERT OR IGNORE INTO slack_mentions (...) VALUES (...)`
).run(...).changes === 1
```

`changes === 1` means this process just claimed the message; `0` means it was already
there. No in-memory `seen` set, because that is a set that empties every time the app
restarts and forgets every mention it had already dealt with.

Keep a cursor too — the latest `posted_at` successfully polled — so a poll asks for
messages since then rather than re-searching the whole history every few minutes. The
`settings` key/value table ([db/settings.ts](../src/main/db/settings.ts)) is the right
home for that; it is what the daily cap and notify prefs already use.

---

## Credentials

[services/secrets.ts](../src/main/services/secrets.ts) does exactly the right thing
already and needs one generalisation: it is currently hard-coded to a single
`gemini.key` file. It would become a named-key store — `gemini.key`, `slack.key` —
keeping every existing property:

- `safeStorage` (macOS Keychain), file mode `0o600`
- **refuses to fall back to plaintext** — if encryption is unavailable it throws
  rather than writing the token to disk in the clear
- **no IPC getter.** The renderer can learn `{ present: boolean }` and nothing more.
  There is deliberately no channel that returns a token, so a compromised renderer
  cannot exfiltrate one.

UI: copy [GoalsAdmin/KeyVault.tsx](../src/renderer/src/sections/GoalsAdmin/KeyVault.tsx)
— password input, Test, Save, Remove, and a status dot. It is the established pattern
for exactly this.

---

## HTTP client

Do not add one. Follow `request()` in
[services/gemini.ts:58](../src/main/services/gemini.ts), which is 70 lines and already
handles what matters:

- 3 attempts, backoff `600 * 3**(n-1)` ms
- retries **only** 429 and 5xx; fails fast on network errors, 401, 403, 400
- `AbortSignal.timeout()`
- a typed error with a `kind` the UI can branch on
  (`offline | auth | rate | server | parse | unknown`)

Slack's `429` carries a `Retry-After` header, which is one addition worth making —
honour it rather than using the fixed backoff, or a rate-limited poll will keep
being rate-limited.

Slack also signals failure with `200 OK` and `{"ok": false, "error": "..."}` in the
body, unlike Gemini. That needs one explicit check, or every failure will look like a
successful empty poll.

---

## Wiring

Three touch points, all following existing precedent:

| Concern | Precedent to copy |
|---|---|
| The 2–5 minute tick | [services/reminders.ts:70](../src/main/services/reminders.ts) — `setInterval`, `timer.unref()`, immediate first pass |
| Start/stop with the app | [main/index.ts:126](../src/main/index.ts) start, `will-quit` stop |
| Pushing new mentions to the UI | Only two main→renderer channels exist today ([preload/index.ts:153](../src/preload/index.ts)); this adds a third, `slack:mentions` |

A new section is the wrong shape for this — it would be a seventh dock item for
something that is empty most of the time. Better as an **app-level panel**, like
[DataPanel](../src/renderer/src/components/shell/DataPanel.tsx): a slide-over with an
unread count on a dock button, opened from the dock or the command palette.

One trap if you build it that way: a panel whose box reaches `y = 0` sits under the
title-bar drag strips and its buttons stop receiving clicks. Apply the `no-drag`
class to the container. This is the bug that was just fixed in `DataPanel` — see
[globals.css:135](../src/renderer/src/styles/globals.css).

---

## The review flow

1. Poller claims new mentions, writes them `status = 'new'`, pushes a count.
2. Panel lists them newest first: channel, author, text, relative time.
3. Each row has three actions:
   - **Add to today** — `createSlot` with the message text as the title (truncated,
     editable first), `source_ref` = permalink. Sets `status = 'filed'` and records
     `slot_id`.
   - **Dismiss** — `status = 'dismissed'`. Not a delete; the claim row has to stay or
     the next poll pulls it straight back in.
   - **Open in Slack** — `shell.openExternal(permalink)`, which already exists
     ([main/index.ts:91](../src/main/index.ts)).
4. Filed and dismissed rows drop out of the default view.

The title needs a moment's thought: Slack messages are prose and slot titles are
short. Truncate to something sensible and let the user edit before filing, rather
than storing a title nobody can scan. `MAX_NAME` is 60 characters.

---

## Roughly what this costs

| Piece | Notes |
|---|---|
| Migration v10 + backup `TABLES` entry | small — and **do not forget the backup manifest**, or the table is silently never backed up *and wiped on every restore* |
| `secrets.ts` → named keys | small, but it touches the existing Gemini path, so its tests matter |
| Slack client + poller + claim | the bulk of it |
| Inbox panel + dock button + unread count | moderate |
| Token entry UI | small — copy `KeyVault` |
| Tests | client with `vi.stubGlobal('fetch', …)` per [test/gemini.test.ts](../test/gemini.test.ts); claim/idempotency against a real in-memory DB per [test/notify.test.ts](../test/notify.test.ts) |

The `ok: false` handling and the `Retry-After` honouring are the two places this will
bite if skipped, and the token choice is the thing to settle first.

---

## What to decide before any of this is written

1. **Bot token or user token?** Everything else follows from it. A bot token means no
   DMs and no `search.messages`, which means a different transport as well.
2. **Is a credential that can read your whole workspace acceptable** on this machine,
   in the Keychain, never leaving the main process?
3. **Confirm the Tracker reading** — that "add to Tracker" means "put it on a day as
   work", since that is the only thing the Tracker can be fed.

/**
 * Forward-only migrations, applied in order. The array index + 1 is the
 * SQLite `user_version`, so never edit or reorder a shipped entry — append.
 *
 * Kept as inline SQL rather than .sql files so the main-process bundle has no
 * runtime asset resolution to get wrong once packaged into an asar.
 */
export const MIGRATIONS: readonly string[] = [
  /* ---------------------------------------------------------- v1: schema */
  `
  CREATE TABLE slots (
    id            TEXT PRIMARY KEY,
    date          TEXT NOT NULL,
    start_min     INTEGER,
    duration_min  INTEGER NOT NULL DEFAULT 30,
    title         TEXT NOT NULL,
    note          TEXT,
    source        TEXT NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual','curriculum','amber_weekly','project')),
    source_ref    TEXT,
    category      TEXT NOT NULL DEFAULT 'personal_learning'
                  CHECK (category IN ('vibe_code','amber','personal_learning')),
    status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','done','rolled','skipped')),
    rolled_from   TEXT REFERENCES slots(id) ON DELETE SET NULL,
    roll_count    INTEGER NOT NULL DEFAULT 0,
    sort_index    INTEGER NOT NULL DEFAULT 0,
    completed_at  TEXT,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX idx_slots_date ON slots(date);
  CREATE INDEX idx_slots_status_date ON slots(status, date);

  -- Belt-and-braces against double-seeding: a given curriculum topic or
  -- weekly template can only materialise once on a given day.
  CREATE UNIQUE INDEX idx_slots_curriculum_once
    ON slots(source_ref, date) WHERE source = 'curriculum';
  CREATE UNIQUE INDEX idx_slots_weekly_once
    ON slots(source_ref, date) WHERE source = 'amber_weekly';

  CREATE TABLE projects (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    path           TEXT NOT NULL UNIQUE,
    color          TEXT,
    last_opened_at TEXT,
    pinned         INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE curricula (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    start_date      TEXT NOT NULL,
    deadline        TEXT NOT NULL,
    raw_text        TEXT NOT NULL,
    model           TEXT NOT NULL,
    minutes_per_day INTEGER NOT NULL DEFAULT 90,
    rest_days       TEXT NOT NULL DEFAULT '[]',
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','archived')),
    created_at      TEXT NOT NULL
  );

  CREATE TABLE topics (
    id            TEXT PRIMARY KEY,
    curriculum_id TEXT NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
    seq           INTEGER NOT NULL,
    module        TEXT,
    title         TEXT NOT NULL,
    detail        TEXT,
    est_minutes   INTEGER NOT NULL DEFAULT 60,
    assigned_date TEXT,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','done','skipped'))
  );
  CREATE INDEX idx_topics_assigned ON topics(curriculum_id, assigned_date);
  CREATE INDEX idx_topics_seq ON topics(curriculum_id, seq);

  CREATE TABLE weekly_templates (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    weekday      INTEGER NOT NULL DEFAULT 1,
    start_min    INTEGER,
    duration_min INTEGER NOT NULL DEFAULT 30,
    category     TEXT NOT NULL DEFAULT 'amber'
                 CHECK (category IN ('vibe_code','amber','personal_learning')),
    active       INTEGER NOT NULL DEFAULT 1,
    sort_index   INTEGER NOT NULL DEFAULT 0
  );

  -- One row per Monday that has already been seeded. Makes seeding idempotent
  -- no matter how many times the app is relaunched in a week.
  CREATE TABLE weekly_seed_log (
    week_key  TEXT PRIMARY KEY,
    seeded_at TEXT NOT NULL
  );

  CREATE TABLE stickers (
    id            TEXT PRIMARY KEY,
    body          TEXT NOT NULL,
    color         TEXT NOT NULL DEFAULT 'amber',
    kind          TEXT NOT NULL DEFAULT 'temp'
                  CHECK (kind IN ('temp','permanent')),
    expires_at    TEXT,
    attached_date TEXT,
    x             REAL NOT NULL DEFAULT 0,
    y             REAL NOT NULL DEFAULT 0,
    rotation      REAL NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX idx_stickers_attached ON stickers(attached_date);

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,

  /* ------------------------------------- v2: starter weekly amber tasks */
  `
  INSERT INTO weekly_templates (id, title, weekday, start_min, duration_min, category, active, sort_index) VALUES
    ('seed-weekly-plan',   'Plan the week',        1, 540,  20, 'amber', 1, 0),
    ('seed-weekly-sync',   'Weekly amber sync',    1, 600,  30, 'amber', 1, 1),
    ('seed-weekly-review', 'Amber content review', 1, 900,  45, 'amber', 1, 2);
  `,

  /* -------------------------- v3: several goals at once, plus reminders */
  `
  -- Many curricula can be active together now. A colour and an explicit order
  -- are what let a day card say which goal a topic belongs to.
  ALTER TABLE curricula ADD COLUMN color TEXT NOT NULL DEFAULT 'amber';
  ALTER TABLE curricula ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0;

  -- One row per brief the app has already decided about, so relaunching three
  -- times before lunch cannot fire the morning brief three times. Same guard
  -- pattern as weekly_seed_log.
  CREATE TABLE notify_log (
    day_key TEXT NOT NULL,
    kind    TEXT NOT NULL CHECK (kind IN ('morning','evening')),
    sent_at TEXT NOT NULL,
    -- False when the window was missed and the brief was suppressed rather
    -- than delivered. Recorded honestly so it is never mistaken for a send.
    delivered INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (day_key, kind)
  );
  `,

  /* --------------------------------------- v4: projects become first-class */
  `
  -- Last known git branch. Cached rather than derived so a card still reads
  -- correctly when the folder is on a drive that is not mounted right now;
  -- it is refreshed from .git/HEAD on every list.
  ALTER TABLE projects ADD COLUMN branch TEXT;

  -- Explicit display order. Pinned projects sort ahead of everything else, and
  -- sort_index is renumbered to match the displayed order after every pin or
  -- drag, so the two orderings can never disagree.
  ALTER TABLE projects ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0;
  UPDATE projects SET sort_index = rowid - 1;

  -- A day slot can point at a project (source = 'project'), and the grid can
  -- open the workspace straight from that row. Nothing enforces the reference
  -- at the SQL level because slots(source_ref) is polymorphic, so this index is
  -- what makes "which slots belong to this project" cheap.
  CREATE INDEX idx_slots_project ON slots(source_ref) WHERE source = 'project';
  `,

  /* ------------------------- v5: subtopics and dated reminder notes */
  `
  -- The learning points a topic breaks down into, as a JSON array of strings.
  -- A column rather than a child table because points are only ever read with
  -- their topic, never queried or ordered across topics, and rewriting the set
  -- is a single UPDATE instead of a delete-and-reinsert.
  --
  -- '[]' means "not broken down yet", which is also what every topic created
  -- before this migration gets — the backfill is an explicit action, not
  -- something that silently spends API calls on old goals at launch.
  ALTER TABLE topics ADD COLUMN points TEXT NOT NULL DEFAULT '[]';

  -- Notes that surface on a day card as reminders: "learned this Saturday,
  -- review it Wednesday".
  --
  -- Deliberately NOT slots. A reminder is something to be aware of on a day,
  -- not work to tick off, so it must never reach the progress ring, the
  -- Tracker, rollover, or the notification briefs — all of which read slots.
  -- Keeping it in its own table is what makes that guarantee structural rather
  -- than a filter every one of those readers has to remember.
  CREATE TABLE goal_notes (
    id            TEXT PRIMARY KEY,
    -- Nullable: a note can belong to a goal, or stand on its own.
    curriculum_id TEXT REFERENCES curricula(id) ON DELETE CASCADE,
    body          TEXT NOT NULL,
    -- The day the note appears on.
    surface_date  TEXT NOT NULL,
    -- Optional "I learned this on…", shown as provenance on the card.
    learned_date  TEXT,
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','dismissed')),
    created_at    TEXT NOT NULL
  );

  -- The deck reads notes by date window, so surface_date leads the index and
  -- status follows it — the same shape as the query in db/notes.ts.
  CREATE INDEX idx_goal_notes_surface ON goal_notes(surface_date, status);
  CREATE INDEX idx_goal_notes_goal ON goal_notes(curriculum_id);
  `
]

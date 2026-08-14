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
  `,

  /* ------------ v6: tags, sticker folders, and the storyboard space */
  `
  -- Tags are a second dimension to slots.category, not a replacement for it.
  -- Every slot still has exactly one category (the Tracker's three buckets,
  -- rollover and the notification briefs all depend on that), and may carry any
  -- number of tags on top — including none.
  CREATE TABLE tags (
    id          TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    -- What '#slug' in the quick-add bar matches. Unique so a typed token can
    -- only ever resolve to one tag.
    slug        TEXT NOT NULL UNIQUE,
    color       TEXT NOT NULL DEFAULT 'amber',
    -- JSON array of lowercased match terms. A column rather than a child table
    -- for the same reason as topics.points: only ever read with their tag,
    -- never queried across them, and rewriting the set is one UPDATE.
    keywords    TEXT NOT NULL DEFAULT '[]',
    -- Weekly cutoff, 0 = Sunday … 6 = Saturday, matching weekly_templates.
    -- NULL means this tag is not on a deadline and the Tracker stays quiet.
    due_weekday INTEGER,
    sort_index  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );

  -- Which slots are filed under which tag.
  --
  -- 'origin' and 'matched' record *why* the row is here, and are the reason
  -- this is a table with columns rather than a plain join. A keyword can be
  -- edited or deleted long after it filed something; re-deriving the reason at
  -- read time would then either lose it or invent a new one, where a stored
  -- "auto-filed on 'amber'" stays true about what actually happened.
  CREATE TABLE slot_tags (
    slot_id TEXT NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
    origin  TEXT NOT NULL DEFAULT 'auto'
            CHECK (origin IN ('auto','typed','manual')),
    matched TEXT,
    PRIMARY KEY (slot_id, tag_id)
  );
  CREATE INDEX idx_slot_tags_tag ON slot_tags(tag_id);

  -- One tag to start with, because the feature is invisible until something is
  -- in it. Its label alone matches "amber automation" — see shared/tag-match —
  -- so the keyword list is for the words that are *not* the name.
  INSERT INTO tags (id, label, slug, color, keywords, due_weekday, sort_index, created_at)
  VALUES ('seed-tag-amber', 'Amber', 'amber', 'amber',
          '["amberstudent","amber student"]', 5, 0, datetime('now'));

  -- Optional grouping for the stickers wall. SET NULL rather than CASCADE:
  -- deleting a folder releases its notes back onto the loose wall, it does not
  -- shred them.
  CREATE TABLE sticker_folders (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT 'butter',
    sort_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  ALTER TABLE stickers ADD COLUMN folder_id TEXT
    REFERENCES sticker_folders(id) ON DELETE SET NULL;
  CREATE INDEX idx_stickers_folder ON stickers(folder_id);

  -- The storyboard space. A board is one segment of it; frames live on an
  -- unbounded canvas inside that board and carry their own coordinates, which
  -- is why nothing here has an ordering that positions them.
  CREATE TABLE storyboards (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    -- Nullable: a board can belong to a project, or stand on its own. SET NULL
    -- so removing a folder from the Projects grid does not delete the thinking
    -- that was done about it.
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    color      TEXT NOT NULL DEFAULT 'amber',
    sort_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE storyboard_frames (
    id          TEXT PRIMARY KEY,
    board_id    TEXT NOT NULL REFERENCES storyboards(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    -- The generation prompt allocated to this frame. Its own column because it
    -- is the thing that gets copied out whole; folded into the description it
    -- would need hand-editing on every use.
    prompt      TEXT NOT NULL DEFAULT '',
    x           REAL NOT NULL DEFAULT 0,
    y           REAL NOT NULL DEFAULT 0,
    w           REAL NOT NULL DEFAULT 280,
    h           REAL NOT NULL DEFAULT 200,
    color       TEXT NOT NULL DEFAULT 'amber',
    sort_index  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX idx_frames_board ON storyboard_frames(board_id);
  `,

  /* v7 — the storyboard becomes a graph. */
  `
  -- The brief lives on the board row rather than in a nodes table, and that is
  -- the whole trick: there is no row to delete, so "always present, never
  -- deletable, exactly one per board" is a property of the schema instead of a
  -- rule the UI has to remember to enforce.
  ALTER TABLE storyboards ADD COLUMN brief        TEXT NOT NULL DEFAULT '';
  ALTER TABLE storyboards ADD COLUMN visual_style TEXT NOT NULL DEFAULT '';

  -- Generation length for this shot, in seconds, constrained to what the model
  -- can actually produce. Nullable because "not yet decided" is a real state and
  -- is not the same as any particular number.
  ALTER TABLE storyboard_frames ADD COLUMN duration_sec INTEGER;

  -- A list of references, as a container node on the canvas. It carries its own
  -- coordinates for the same reason frames do: where it sits is information.
  CREATE TABLE storyboard_lists (
    id         TEXT PRIMARY KEY,
    board_id   TEXT NOT NULL REFERENCES storyboards(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT '',
    x          REAL NOT NULL DEFAULT 0,
    y          REAL NOT NULL DEFAULT 0,
    w          REAL NOT NULL DEFAULT 260,
    h          REAL NOT NULL DEFAULT 220,
    color      TEXT NOT NULL DEFAULT 'amber',
    sort_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_sb_lists_board ON storyboard_lists(board_id);

  CREATE TABLE storyboard_list_items (
    id         TEXT PRIMARY KEY,
    list_id    TEXT NOT NULL REFERENCES storyboard_lists(id) ON DELETE CASCADE,
    label      TEXT NOT NULL DEFAULT '',
    -- An absolute path to media that is linked, never copied. That means this can
    -- go stale, so the read path stats it and reports "missing" rather than
    -- storing a flag that would itself go stale.
    media_path TEXT,
    media_kind TEXT CHECK (media_kind IN ('image','video')),
    -- A small JPEG data URI, generated once on import. Keeps the board painting
    -- fast, and gives a video row a poster frame without an ffmpeg dependency.
    thumb      TEXT,
    sort_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_sb_items_list ON storyboard_list_items(list_id);

  -- The only edge the graph stores. Both ends are real foreign keys with CASCADE,
  -- so deleting either node takes its wires with it and there is no orphan sweep
  -- to remember to run.
  --
  -- Brief-to-scene and style-to-brief are deliberately absent: every frame already
  -- carries its board_id, and a placed style always attaches to the one brief, so
  -- both are derivable. Storing them would mean a polymorphic edge table with no
  -- foreign keys at all — strictly worse than computing them.
  CREATE TABLE storyboard_frame_refs (
    frame_id   TEXT NOT NULL REFERENCES storyboard_frames(id)     ON DELETE CASCADE,
    item_id    TEXT NOT NULL REFERENCES storyboard_list_items(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (frame_id, item_id)
  );
  CREATE INDEX idx_sb_refs_item ON storyboard_frame_refs(item_id);
  `,

  /* v8 — reusable cinematic styles. */
  `
  -- Board-independent on purpose: a look you worked out once outlives the board
  -- you worked it out on, and the whole point of saving one is using it again.
  CREATE TABLE video_styles (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    -- The named dimensions. Separate columns rather than one blob because these
    -- are the ones the prompt builder assembles in a fixed order, and a shot
    -- described as "35mm anamorphic" needs the lens to be a lens.
    video_style TEXT NOT NULL DEFAULT '',
    camera      TEXT NOT NULL DEFAULT '',
    lens        TEXT NOT NULL DEFAULT '',
    grade       TEXT NOT NULL DEFAULT '',
    lighting    TEXT NOT NULL DEFAULT '',
    film_stock  TEXT NOT NULL DEFAULT '',
    aspect      TEXT NOT NULL DEFAULT '',
    -- Everything else, as a JSON array of {key,value}. Same shape as
    -- tags.keywords: an open dimension that does not need a migration to grow.
    extras      TEXT NOT NULL DEFAULT '[]',
    color       TEXT NOT NULL DEFAULT 'amber',
    sort_index  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );

  -- A style placed on one board's canvas. Its wire to the brief is not stored:
  -- there is exactly one brief per board, so a placed style is already attached
  -- to it and an edge row could only ever agree or be wrong.
  CREATE TABLE storyboard_style_nodes (
    id         TEXT PRIMARY KEY,
    board_id   TEXT NOT NULL REFERENCES storyboards(id)  ON DELETE CASCADE,
    style_id   TEXT NOT NULL REFERENCES video_styles(id) ON DELETE CASCADE,
    x          REAL NOT NULL DEFAULT 0,
    y          REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  -- Dropping the same style on the same board twice is the same statement made
  -- twice, not two statements.
  CREATE UNIQUE INDEX idx_sb_style_once
    ON storyboard_style_nodes(board_id, style_id);
  CREATE INDEX idx_sb_style_board ON storyboard_style_nodes(board_id);
  `,

  /* v9 — creative projects, and folders that map to real directories. */
  `
  -- 'code' or 'creative'. No CHECK constraint deliberately: SQLite cannot alter a
  -- CHECK afterwards, so adding a third kind later would mean rebuilding the
  -- table. Every other enum in this app is already validated in the IPC layer,
  -- which is where this one is too.
  ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'code';

  -- The file a creative project opens on click — a .prproj, a .aep. NULL for code
  -- projects, which open in the embedded workspace instead. The project's "path"
  -- column stays what it always was: the folder this file lives in.
  ALTER TABLE projects ADD COLUMN entry_path TEXT;

  -- A folder in the panel, backed by a real directory.
  CREATE TABLE project_folders (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id)        ON DELETE CASCADE,
    parent_id  TEXT          REFERENCES project_folders(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    -- Relative to the project root, always. Storing an absolute path would mean
    -- keeping a second copy of the root that could disagree with it, and would
    -- give this table the power to name somewhere outside the project.
    rel_path   TEXT NOT NULL,
    sort_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_project_folder_path
    ON project_folders(project_id, rel_path);
  CREATE INDEX idx_project_folder_parent ON project_folders(parent_id);
  `,

  /* v10 — references on the brief, and a style's own source text. */
  `
  -- A reference wired to the brief rather than to one scene. Mirrors
  -- storyboard_frame_refs exactly, keyed by board because the brief is the
  -- board: one per board, no id of its own. Brief refs inform every scene's
  -- prompt; frame refs inform only their own.
  CREATE TABLE storyboard_brief_refs (
    board_id   TEXT NOT NULL REFERENCES storyboards(id)          ON DELETE CASCADE,
    item_id    TEXT NOT NULL REFERENCES storyboard_list_items(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (board_id, item_id)
  );
  CREATE INDEX idx_sb_brief_refs_item ON storyboard_brief_refs(item_id);

  -- The look as the user typed it, kept verbatim. The named columns can be
  -- sorted out of this text by the model, and a bad sort loses nothing because
  -- this copy is never touched by the sorter.
  ALTER TABLE video_styles ADD COLUMN source_text TEXT NOT NULL DEFAULT '';
  `,

  /* v11 — character sheets, and the supported generation lengths change. */
  `
  -- The cast. A style locks how the film is *shot*; a sheet locks who is *in*
  -- it — the other half of shot-to-shot consistency, and the half a prompt
  -- cannot carry on its own ("the same woman as before" means nothing to a
  -- generator that has never seen the previous shot).
  --
  -- Board-scoped, unlike video_styles: a look is a house style worth reusing
  -- across films, a cast belongs to one film.
  --
  -- 'location' is accepted but unused by the UI today. It costs one CHECK
  -- branch now and saves a migration later, and these are forward-only.
  CREATE TABLE storyboard_sheets (
    id          TEXT PRIMARY KEY,
    board_id    TEXT NOT NULL REFERENCES storyboards(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL DEFAULT 'character'
                CHECK (kind IN ('character','location')),
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_index  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX idx_sb_sheets_board ON storyboard_sheets(board_id);

  -- The generator's real lengths are 4/6/8/10; 5 was never one of them. A row
  -- left at 5 would render with no length selected and be rejected by the IPC
  -- validator on the next edit. Rounded up rather than to the arithmetic
  -- nearest — 4 and 6 are equidistant, and lengthening a shot someone already
  -- timed loses nothing where shortening it cuts a beat.
  UPDATE storyboard_frames SET duration_sec = 6 WHERE duration_sec = 5;
  `
]

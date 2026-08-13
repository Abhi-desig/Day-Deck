import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../src/main/db/migrations'

/**
 * `makeDb()` builds every schema from scratch, which is the one path a real
 * installation never takes. These exercise the upgrade instead — an ALTER
 * against a database that already holds the user's data is where a bad
 * migration costs someone their goals.
 */
function dbAtVersion(version: number): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  for (let v = 0; v < version; v++) db.exec(MIGRATIONS[v])
  db.pragma(`user_version = ${version}`)
  return db
}

/** The forward-only runner from db/index.ts, minus its electron import. */
function migrate(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}

describe('migrating an existing database', () => {
  it('upgrades a v2 database that already has a curriculum in it', () => {
    const db = dbAtVersion(2)

    db.prepare(
      `INSERT INTO curricula
         (id, title, start_date, deadline, raw_text, model, minutes_per_day,
          rest_days, status, created_at)
       VALUES ('c1', 'Existing goal', '2026-08-01', '2026-12-31', 'text',
               'gemini-3.5-flash', 90, '[]', 'active', '2026-08-01T00:00:00Z')`
    ).run()

    migrate(db)

    const row = db
      .prepare<[], { color: string; sort_index: number; title: string }>(
        `SELECT title, color, sort_index FROM curricula WHERE id = 'c1'`
      )
      .get()

    expect(row?.title).toBe('Existing goal')
    // The pre-existing goal has to come out of the upgrade usable, not null.
    expect(row?.color).toBe('amber')
    expect(row?.sort_index).toBe(0)
  })

  it('lands on the current version and creates notify_log', () => {
    const db = dbAtVersion(2)
    migrate(db)

    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)

    const table = db
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notify_log'`
      )
      .get()
    expect(table?.name).toBe('notify_log')
  })

  it('gives a pre-existing topic empty points rather than null', () => {
    const db = dbAtVersion(4)

    db.prepare(
      `INSERT INTO curricula
         (id, title, start_date, deadline, raw_text, model, minutes_per_day,
          rest_days, status, color, sort_index, created_at)
       VALUES ('c1', 'Old goal', '2026-08-01', '2026-12-31', 'text',
               'gemini-3.5-flash', 90, '[]', 'active', 'amber', 0,
               '2026-08-01T00:00:00Z')`
    ).run()
    db.prepare(
      `INSERT INTO topics
         (id, curriculum_id, seq, title, est_minutes, assigned_date, status)
       VALUES ('t1', 'c1', 1, 'Shaders', 60, '2026-08-12', 'pending')`
    ).run()

    migrate(db)

    const row = db
      .prepare<[], { title: string; points: string }>(
        `SELECT title, points FROM topics WHERE id = 't1'`
      )
      .get()

    expect(row?.title).toBe('Shaders')
    // '[]', not NULL — "not broken down yet" is a state the reader understands,
    // and it is what makes the goal show up as backfillable in Goals Admin.
    expect(row?.points).toBe('[]')
  })

  it('creates goal_notes and cascades it from curricula', () => {
    const db = dbAtVersion(4)
    db.prepare(
      `INSERT INTO curricula
         (id, title, start_date, deadline, raw_text, model, minutes_per_day,
          rest_days, status, color, sort_index, created_at)
       VALUES ('c1', 'Old goal', '2026-08-01', '2026-12-31', 'text',
               'gemini-3.5-flash', 90, '[]', 'active', 'amber', 0,
               '2026-08-01T00:00:00Z')`
    ).run()

    migrate(db)

    db.prepare(
      `INSERT INTO goal_notes
         (id, curriculum_id, body, surface_date, status, created_at)
       VALUES ('n1', 'c1', 'Review Wednesday', '2026-08-12', 'active',
               '2026-08-11T00:00:00Z')`
    ).run()

    db.prepare(`DELETE FROM curricula WHERE id = 'c1'`).run()

    const left = db
      .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM goal_notes`)
      .get()?.n
    expect(left).toBe(0)
  })

  it('gives a pre-existing board an empty brief rather than null', () => {
    const db = dbAtVersion(6)

    db.prepare(
      `INSERT INTO storyboards (id, title, color, sort_index, created_at)
       VALUES ('b1', 'Nike spot', 'amber', 0, '2026-08-01T00:00:00Z')`
    ).run()
    db.prepare(
      `INSERT INTO storyboard_frames
         (id, board_id, title, description, prompt, x, y, w, h, color,
          sort_index, created_at)
       VALUES ('f1', 'b1', 'Opening', 'wide establishing', 'a wide shot',
               10, 20, 300, 240, 'amber', 0, '2026-08-01T00:00:00Z')`
    ).run()

    migrate(db)

    const board = db
      .prepare<[], { brief: string; visual_style: string; title: string }>(
        `SELECT title, brief, visual_style FROM storyboards WHERE id = 'b1'`
      )
      .get()

    expect(board?.title).toBe('Nike spot')
    // '' rather than NULL: the Brief node renders straight from these columns and
    // an empty brief is a real, editable state. NULL would be a crash.
    expect(board?.brief).toBe('')
    expect(board?.visual_style).toBe('')

    const frame = db
      .prepare<[], { prompt: string; duration_sec: number | null }>(
        `SELECT prompt, duration_sec FROM storyboard_frames WHERE id = 'f1'`
      )
      .get()

    expect(frame?.prompt).toBe('a wide shot')
    // NULL here *is* the meaningful value — "no duration decided yet" is not the
    // same as any particular number of seconds.
    expect(frame?.duration_sec).toBeNull()
  })

  it('cascades reference wires from both of their ends', () => {
    const db = dbAtVersion(6)
    db.prepare(
      `INSERT INTO storyboards (id, title, color, sort_index, created_at)
       VALUES ('b1', 'Board', 'amber', 0, '2026-08-01T00:00:00Z')`
    ).run()

    migrate(db)

    const seed = (): void => {
      db.prepare(
        `INSERT INTO storyboard_frames
           (id, board_id, title, description, prompt, x, y, w, h, color,
            sort_index, created_at)
         VALUES ('f1', 'b1', '', '', '', 0, 0, 300, 240, 'amber', 0, 'now')`
      ).run()
      db.prepare(
        `INSERT INTO storyboard_lists
           (id, board_id, title, x, y, w, h, color, sort_index, created_at)
         VALUES ('l1', 'b1', 'Refs', 0, 0, 260, 220, 'amber', 0, 'now')`
      ).run()
      db.prepare(
        `INSERT INTO storyboard_list_items
           (id, list_id, label, media_path, media_kind, sort_index, created_at)
         VALUES ('i1', 'l1', 'plate', '/tmp/a.mp4', 'video', 0, 'now')`
      ).run()
      db.prepare(
        `INSERT INTO storyboard_frame_refs (frame_id, item_id, created_at)
         VALUES ('f1', 'i1', 'now')`
      ).run()
    }
    const wires = (): number =>
      db
        .prepare<[], { n: number }>(
          `SELECT COUNT(*) AS n FROM storyboard_frame_refs`
        )
        .get()?.n ?? -1

    // Deleting the scene takes the wire.
    seed()
    expect(wires()).toBe(1)
    db.prepare(`DELETE FROM storyboard_frames WHERE id = 'f1'`).run()
    expect(wires()).toBe(0)

    // And so does deleting the list the reference lived in, two hops up.
    db.prepare(`DELETE FROM storyboard_lists WHERE id = 'l1'`).run()
    seed()
    expect(wires()).toBe(1)
    db.prepare(`DELETE FROM storyboard_lists WHERE id = 'l1'`).run()
    expect(wires()).toBe(0)
    const items = db
      .prepare<[], { n: number }>(
        `SELECT COUNT(*) AS n FROM storyboard_list_items`
      )
      .get()?.n
    expect(items).toBe(0)
  })

  it('rejects a media kind it does not know how to render', () => {
    const db = dbAtVersion(6)
    db.prepare(
      `INSERT INTO storyboards (id, title, color, sort_index, created_at)
       VALUES ('b1', 'Board', 'amber', 0, '2026-08-01T00:00:00Z')`
    ).run()
    migrate(db)
    db.prepare(
      `INSERT INTO storyboard_lists
         (id, board_id, title, x, y, w, h, color, sort_index, created_at)
       VALUES ('l1', 'b1', 'Refs', 0, 0, 260, 220, 'amber', 0, 'now')`
    ).run()

    expect(() =>
      db
        .prepare(
          `INSERT INTO storyboard_list_items
             (id, list_id, label, media_path, media_kind, sort_index, created_at)
           VALUES ('i1', 'l1', 'doc', '/tmp/a.pdf', 'pdf', 0, 'now')`
        )
        .run()
    ).toThrow(/CHECK constraint/i)
  })

  it('keeps a style library entry when the board using it is deleted', () => {
    const db = dbAtVersion(7)
    db.prepare(
      `INSERT INTO storyboards
         (id, title, brief, visual_style, color, sort_index, created_at)
       VALUES ('b1', 'Board', 'the idea', '', 'amber', 0, 'now')`
    ).run()

    migrate(db)

    db.prepare(
      `INSERT INTO video_styles (id, name, extras, color, sort_index, created_at)
       VALUES ('s1', 'Urban indie', '[]', 'amber', 0, 'now')`
    ).run()
    db.prepare(
      `INSERT INTO storyboard_style_nodes
         (id, board_id, style_id, x, y, created_at)
       VALUES ('n1', 'b1', 's1', 0, 0, 'now')`
    ).run()

    db.prepare(`DELETE FROM storyboards WHERE id = 'b1'`).run()

    // The placement goes; the library keeps the look. A style outlives the board
    // it was worked out on — that is the whole reason it is a separate table.
    const placements = db
      .prepare<[], { n: number }>(
        `SELECT COUNT(*) AS n FROM storyboard_style_nodes`
      )
      .get()?.n
    const library = db
      .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM video_styles`)
      .get()?.n

    expect(placements).toBe(0)
    expect(library).toBe(1)
  })

  it('refuses the same style twice on one board', () => {
    const db = dbAtVersion(7)
    db.prepare(
      `INSERT INTO storyboards
         (id, title, brief, visual_style, color, sort_index, created_at)
       VALUES ('b1', 'Board', '', '', 'amber', 0, 'now')`
    ).run()
    migrate(db)
    db.prepare(
      `INSERT INTO video_styles (id, name, extras, color, sort_index, created_at)
       VALUES ('s1', 'Look', '[]', 'amber', 0, 'now')`
    ).run()
    db.prepare(
      `INSERT INTO storyboard_style_nodes (id, board_id, style_id, x, y, created_at)
       VALUES ('n1', 'b1', 's1', 0, 0, 'now')`
    ).run()

    expect(() =>
      db
        .prepare(
          `INSERT INTO storyboard_style_nodes
             (id, board_id, style_id, x, y, created_at)
           VALUES ('n2', 'b1', 's1', 5, 5, 'now')`
        )
        .run()
    ).toThrow(/UNIQUE constraint/i)
  })

  it('leaves a pre-existing project as a code project', () => {
    const db = dbAtVersion(8)
    db.prepare(
      `INSERT INTO projects
         (id, name, path, color, branch, pinned, sort_index, created_at)
       VALUES ('p1', 'Day Deck', '/repos/day-deck', 'sky', 'main', 0, 0, 'now')`
    ).run()

    migrate(db)

    const row = db
      .prepare<[], { name: string; kind: string; entry_path: string | null }>(
        `SELECT name, kind, entry_path FROM projects WHERE id = 'p1'`
      )
      .get()

    expect(row?.name).toBe('Day Deck')
    // Everything that existed before this migration is a code project — that is
    // what the app has been doing all along.
    expect(row?.kind).toBe('code')
    expect(row?.entry_path).toBeNull()
  })

  it('cascades project folders from their project and their parent', () => {
    const db = dbAtVersion(8)
    db.prepare(
      `INSERT INTO projects
         (id, name, path, color, branch, pinned, sort_index, created_at)
       VALUES ('p1', 'Spot', '/spot', 'sky', NULL, 0, 0, 'now')`
    ).run()
    migrate(db)

    db.prepare(
      `INSERT INTO project_folders
         (id, project_id, parent_id, name, rel_path, sort_index, created_at)
       VALUES ('f1', 'p1', NULL, 'Footage', 'Footage', 0, 'now')`
    ).run()
    db.prepare(
      `INSERT INTO project_folders
         (id, project_id, parent_id, name, rel_path, sort_index, created_at)
       VALUES ('f2', 'p1', 'f1', 'Day 1', 'Footage/Day 1', 0, 'now')`
    ).run()

    const count = (): number =>
      db
        .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM project_folders`)
        .get()?.n ?? -1

    expect(count()).toBe(2)
    // A child row is meaningless without its parent's, so the nested one goes too.
    db.prepare(`DELETE FROM project_folders WHERE id = 'f1'`).run()
    expect(count()).toBe(0)
  })

  it('refuses two folder rows for the same directory', () => {
    const db = dbAtVersion(8)
    db.prepare(
      `INSERT INTO projects
         (id, name, path, color, branch, pinned, sort_index, created_at)
       VALUES ('p1', 'Spot', '/spot', 'sky', NULL, 0, 0, 'now')`
    ).run()
    migrate(db)
    db.prepare(
      `INSERT INTO project_folders
         (id, project_id, parent_id, name, rel_path, sort_index, created_at)
       VALUES ('f1', 'p1', NULL, 'Footage', 'Footage', 0, 'now')`
    ).run()

    expect(() =>
      db
        .prepare(
          `INSERT INTO project_folders
             (id, project_id, parent_id, name, rel_path, sort_index, created_at)
           VALUES ('f2', 'p1', NULL, 'Footage', 'Footage', 1, 'now')`
        )
        .run()
    ).toThrow(/UNIQUE constraint/i)
  })

  it('upgrades a v9 database with styles in it, leaving their text empty', () => {
    const db = dbAtVersion(9)
    db.prepare(
      `INSERT INTO video_styles
         (id, name, video_style, camera, lens, grade, lighting, film_stock,
          aspect, extras, color, sort_index, created_at)
       VALUES ('s1', 'Urban indie', 'gritty', 'handheld', '35mm', 'teal',
               '', '', '2.39:1', '[]', 'amber', 0, 'now')`
    ).run()

    migrate(db)

    const row = db
      .prepare<[], { name: string; source_text: string }>(
        `SELECT name, source_text FROM video_styles WHERE id = 's1'`
      )
      .get()
    expect(row?.name).toBe('Urban indie')
    // A style that predates source text has none — not NULL, which would make
    // every read defend against it.
    expect(row?.source_text).toBe('')
  })

  it('cascades brief refs from both of their ends', () => {
    const db = dbAtVersion(9)
    migrate(db)

    db.prepare(
      `INSERT INTO storyboards (id, title, brief, visual_style, color, sort_index, created_at)
       VALUES ('b1', 'Launch', '', '', 'amber', 0, 'now')`
    ).run()
    db.prepare(
      `INSERT INTO storyboard_lists (id, board_id, title, x, y, w, h, color, sort_index, created_at)
       VALUES ('l1', 'b1', 'Plates', 0, 0, 260, 220, 'amber', 0, 'now')`
    ).run()
    db.prepare(
      `INSERT INTO storyboard_list_items (id, list_id, label, sort_index, created_at)
       VALUES ('i1', 'l1', 'plate', 0, 'now')`
    ).run()
    db.prepare(
      `INSERT INTO storyboard_brief_refs (board_id, item_id, created_at)
       VALUES ('b1', 'i1', 'now')`
    ).run()

    const count = (): number =>
      db
        .prepare<[], { n: number }>(
          `SELECT COUNT(*) AS n FROM storyboard_brief_refs`
        )
        .get()?.n ?? -1

    expect(count()).toBe(1)
    // Deleting the item takes the wire; the board still stands.
    db.prepare(`DELETE FROM storyboard_list_items WHERE id = 'i1'`).run()
    expect(count()).toBe(0)

    db.prepare(
      `INSERT INTO storyboard_list_items (id, list_id, label, sort_index, created_at)
       VALUES ('i2', 'l1', 'plate 2', 0, 'now')`
    ).run()
    db.prepare(
      `INSERT INTO storyboard_brief_refs (board_id, item_id, created_at)
       VALUES ('b1', 'i2', 'now')`
    ).run()
    // And deleting the board takes its wires with it.
    db.prepare(`DELETE FROM storyboards WHERE id = 'b1'`).run()
    expect(count()).toBe(0)
  })

  it('is a no-op when already current', () => {
    const db = dbAtVersion(MIGRATIONS.length)
    expect(() => migrate(db)).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
  })

  it('keeps the weekly seed rows through the upgrade', () => {
    const db = dbAtVersion(2)
    const before = db
      .prepare<[], { n: number }>(
        `SELECT COUNT(*) AS n FROM weekly_templates`
      )
      .get()?.n

    migrate(db)

    const after = db
      .prepare<[], { n: number }>(
        `SELECT COUNT(*) AS n FROM weekly_templates`
      )
      .get()?.n

    expect(before).toBe(3)
    expect(after).toBe(3)
  })
})

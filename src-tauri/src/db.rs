//! The local archive database.
//!
//! One SQLite file, owned by this process, opened once. It holds what the user
//! actually has: a row per real file, the text extracted from it, the tags,
//! collections and projects the user created, the activity log, and an FTS5
//! index over the searchable text.
//!
//! Two rules run through this module:
//!
//!   * The database is the source of truth for every number the interface
//!     shows. Counts are `COUNT(*)`, sizes are `SUM(bytes)`. Nothing is cached
//!     in the renderer and nothing is estimated.
//!   * A file that is no longer on disk is marked `missing`, not deleted, so
//!     tags and collections survive the file being moved back.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::time::SystemTime;

use chrono::{DateTime, Duration, Local, NaiveDate, SecondsFormat, TimeZone};
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};

use crate::error::{AppError, AppResult};
use crate::models::{
    ActivityEntry, ArchiveCollection, ArchiveTotals, CollectionRule, FileQuery, FileRecord, FileVersion,
    Folder, Project, StorageStats, Tag,
};

/// Index states a file can be in.
pub const STATE_PENDING: &str = "pending";
pub const STATE_PROCESSING: &str = "processing";
pub const STATE_INDEXED: &str = "indexed";
pub const STATE_FAILED: &str = "failed";
pub const STATE_UNSUPPORTED: &str = "unsupported";
pub const STATE_MISSING: &str = "missing";

/// The projection every file query uses, so `row_to_file` always lines up.
const FILE_COLUMNS: &str = "f.id, f.name, f.path, f.kind, f.ext, f.mime, f.bytes, f.width, \
     f.height, f.duration_sec, f.pages, f.folder_id, f.folder_path, f.created_at, f.modified_at, \
     f.indexed_at, f.favorite, f.thumb_path, f.preview_path, f.generated_title, f.description, \
     f.labels, f.project_id, f.ocr_state, f.ocr_confidence, f.ocr_engine, f.index_state, f.hash, \
     f.embedding_state, o.text, f.context";

const FILE_SOURCE: &str = "FROM files f LEFT JOIN ocr_content o ON o.file_id = f.id";

pub fn now() -> String {
    Local::now().to_rfc3339_opts(SecondsFormat::Secs, false)
}

/// Filesystem time as an RFC 3339 string in the machine's own zone.
pub fn timestamp(time: SystemTime) -> String {
    let moment: DateTime<Local> = time.into();
    moment.to_rfc3339_opts(SecondsFormat::Secs, false)
}

pub fn open(path: &Path) -> AppResult<Connection> {
    let connection = Connection::open(path)?;
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;",
    )?;
    Ok(connection)
}

/// Whether the full-text table predates the current schema.
///
/// FTS5 tables cannot be altered in place, so a column that was added later
/// means dropping and refilling. The check is a `pragma`, the drop only ever
/// happens when a column is genuinely missing, and the refill reads from the
/// tables that own the data — so this is a migration, not a repair.
fn search_table_needs_rebuild(conn: &Connection) -> AppResult<bool> {
    let mut statement = conn.prepare("PRAGMA table_info(file_search)")?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<String>>>()?;
    if columns.is_empty() {
        // No table yet: the migration below creates it with every column.
        return Ok(false);
    }
    // Each new column this index has gained is listed here. A table missing any
    // of them is rebuilt rather than served half-populated, because a column
    // that is silently empty looks exactly like a column that matched nothing.
    for required in ["people", "context"] {
        if !columns.iter().any(|column| column == required) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Refill the full-text table from the tables that own the data.
///
/// One row per file, in one pass. Called only after a schema change, because on
/// twelve thousand files it is a few seconds of work that nothing else needs.
pub fn rebuild_search_index(conn: &Connection) -> AppResult<usize> {
    let ids = {
        let mut statement = conn.prepare("SELECT id FROM files")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<String>>>()?
    };
    for id in &ids {
        reindex_search_row(conn, id)?;
    }
    Ok(ids.len())
}

pub fn migrate(conn: &Connection) -> AppResult<()> {
    let rebuild_search = search_table_needs_rebuild(conn)?;
    if rebuild_search {
        log::info!("search index predates the people column — rebuilding it");
        conn.execute_batch("DROP TABLE IF EXISTS file_search;")
            .map_err(|error| AppError::Other(format!("could not rebuild the search index: {error}")))?;
    }

    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS folders (
            id           TEXT PRIMARY KEY,
            path         TEXT NOT NULL UNIQUE,
            name         TEXT NOT NULL,
            watched      INTEGER NOT NULL DEFAULT 1,
            status       TEXT NOT NULL DEFAULT 'ok',
            problem      TEXT,
            last_scan_at TEXT,
            added_at     TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS files (
            id              TEXT PRIMARY KEY,
            path            TEXT NOT NULL UNIQUE,
            name            TEXT NOT NULL,
            ext             TEXT NOT NULL DEFAULT '',
            mime            TEXT NOT NULL DEFAULT 'application/octet-stream',
            kind            TEXT NOT NULL DEFAULT 'other',
            bytes           INTEGER NOT NULL DEFAULT 0,
            width           INTEGER,
            height          INTEGER,
            duration_sec    REAL,
            pages           INTEGER,
            folder_id       TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
            folder_path     TEXT NOT NULL DEFAULT '',
            created_at      TEXT NOT NULL,
            modified_at     TEXT NOT NULL,
            indexed_at      TEXT NOT NULL,
            favorite        INTEGER NOT NULL DEFAULT 0,
            thumb_path      TEXT,
            -- Larger derivative of the same image, written for the hero. Kept
            -- separate so a full-screen panel never decodes a 12 MP original.
            preview_path    TEXT,
            generated_title TEXT,
            description     TEXT,
            labels          TEXT NOT NULL DEFAULT '[]',
            -- Inferred context: what this file appears to be for, from the
            -- model's own labels plus what the pipeline measured. Never a claim
            -- about the user's intentions, and null when nothing could be said.
            context         TEXT,
            -- none | analysed. Read by the backfill pass, which is how a library
            -- that was indexed before any model was installed gets analysed
            -- afterwards without being re-imported.
            analysis_state  TEXT NOT NULL DEFAULT 'none',
            project_id      TEXT,
            ocr_state       TEXT NOT NULL DEFAULT 'pending',
            ocr_confidence  REAL,
            ocr_engine      TEXT,
            index_state     TEXT NOT NULL DEFAULT 'pending',
            embedding_state TEXT NOT NULL DEFAULT 'none',
            hash            TEXT,
            seen_at         TEXT
        );

        CREATE TABLE IF NOT EXISTS ocr_content (
            file_id    TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
            text       TEXT NOT NULL DEFAULT '',
            language   TEXT,
            confidence REAL,
            engine     TEXT,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tags (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL UNIQUE,
            pinned     INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        -- `source` is what keeps a machine's tags and a person's tags apart.
        -- Re-analysis replaces every 'ai' row for a file and never touches a row
        -- the user added by hand, which is the difference between a tag list that
        -- sharpens as the index is rebuilt and one that loses the user's own work
        -- every time a model is installed.
        CREATE TABLE IF NOT EXISTS file_tags (
            file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            source  TEXT NOT NULL DEFAULT 'user',
            PRIMARY KEY (file_id, tag_id)
        );

        CREATE TABLE IF NOT EXISTS collections (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL UNIQUE,
            kind       TEXT NOT NULL DEFAULT 'manual',
            rule       TEXT,
            surface    TEXT NOT NULL DEFAULT 'neutral',
            icon       TEXT NOT NULL DEFAULT 'Layers',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS file_collections (
            file_id       TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            PRIMARY KEY (file_id, collection_id)
        );

        CREATE TABLE IF NOT EXISTS projects (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL UNIQUE,
            color      TEXT NOT NULL DEFAULT '#0969da',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS activity (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            kind    TEXT NOT NULL,
            label   TEXT NOT NULL,
            detail  TEXT,
            file_id TEXT,
            at      TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        -- Kept versions, for before/after comparison.
        --
        -- One row per presentation copy the archive decided to hold on to: the
        -- copy that existed before an edit landed, or one the user kept by hand.
        -- The file itself is a JPEG in the thumbnail directory, which is the
        -- only place the webview is allowed to read from.
        CREATE TABLE IF NOT EXISTS file_versions (
            id          TEXT PRIMARY KEY,
            file_id     TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            path        TEXT NOT NULL,
            bytes       INTEGER NOT NULL DEFAULT 0,
            width       INTEGER,
            height      INTEGER,
            captured_at TEXT NOT NULL,
            content_at  TEXT NOT NULL,
            source      TEXT NOT NULL DEFAULT 'change'
        );

        -- Face grouping.
        --
        -- `people` holds a *suggestion* of identity: a centroid and a count.
        -- `label` is null until the person using this machine types a name, and
        -- nothing else in the application ever writes to that column.
        CREATE TABLE IF NOT EXISTS people (
            id         TEXT PRIMARY KEY,
            label      TEXT,
            centroid   BLOB,
            face_count INTEGER NOT NULL DEFAULT 0,
            hidden     INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS faces (
            id         TEXT PRIMARY KEY,
            file_id    TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            person_id  TEXT REFERENCES people(id) ON DELETE SET NULL,
            -- Pixels, in the original image's own coordinates, so the renderer
            -- can draw the box over the real picture rather than a resized copy.
            left       REAL NOT NULL DEFAULT 0,
            top        REAL NOT NULL DEFAULT 0,
            width      REAL NOT NULL DEFAULT 0,
            height     REAL NOT NULL DEFAULT 0,
            score      REAL NOT NULL DEFAULT 0,
            quality    REAL NOT NULL DEFAULT 0,
            crop_path  TEXT,
            embedding  BLOB,
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_faces_file       ON faces(file_id);
        CREATE INDEX IF NOT EXISTS idx_faces_person     ON faces(person_id);
        CREATE INDEX IF NOT EXISTS idx_people_label     ON people(label);

        CREATE INDEX IF NOT EXISTS idx_files_folder     ON files(folder_id);
        CREATE INDEX IF NOT EXISTS idx_files_kind       ON files(kind);
        CREATE INDEX IF NOT EXISTS idx_files_created    ON files(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_files_modified   ON files(modified_at DESC);
        CREATE INDEX IF NOT EXISTS idx_files_project    ON files(project_id);
        CREATE INDEX IF NOT EXISTS idx_files_state      ON files(index_state);
        CREATE INDEX IF NOT EXISTS idx_files_name       ON files(name);
        CREATE INDEX IF NOT EXISTS idx_file_tags_tag    ON file_tags(tag_id);
        CREATE INDEX IF NOT EXISTS idx_activity_at      ON activity(at DESC);
        CREATE INDEX IF NOT EXISTS idx_versions_file    ON file_versions(file_id, content_at DESC);

        -- One searchable document per file: name, generated title, description,
        -- labels, extracted text, folder, tags and project name. Rebuilt from
        -- the row whenever any of those change, so the index can never drift.
        CREATE VIRTUAL TABLE IF NOT EXISTS file_search USING fts5(
            file_id UNINDEXED,
            name,
            title,
            description,
            labels,
            -- The inferred reason this file was kept, in the words the interface
            -- shows ("Possible context: Programming / React debugging"). It is
            -- indexed so a natural sentence finds it, which is the whole point
            -- of deriving it rather than only displaying it.
            context,
            text,
            folder,
            tags,
            project,
            -- The names the user gave to people in these files. Without this
            -- column, searching for somebody by name found nothing at all: the
            -- name exists only in the `people` table, and no query ever reached
            -- it.
            people,
            tokenize = 'unicode61 remove_diacritics 2'
        );
        "#,
    )?;

    // A full-text table cannot be altered in place, so a schema change there is
    // a rebuild: the table was dropped above, this is what fills it again.
    if rebuild_search {
        let files = rebuild_search_index(conn)?;
        log::info!("rebuild of the search index finished: {files} files");
    }

    // Columns added after the first release. `CREATE TABLE IF NOT EXISTS` does
    // nothing to an existing database, so anything new arrives by ALTER.
    ensure_column(conn, "files", "preview_path", "TEXT")?;
    // Whether this machine has already looked for faces in a file. Separating
    // "no faces here" from "not looked yet" is what stops the face pass from
    // re-reading every photograph with nobody in it, forever.
    ensure_column(conn, "files", "faces_state", "TEXT NOT NULL DEFAULT 'none'")?;
    // When the content a file has now was written, the content it held before
    // that. Set by the scan when a fingerprint moves, consumed by the pipeline
    // to keep the presentation copy that is about to be replaced, and null the
    // rest of the time.
    ensure_column(conn, "files", "previous_modified_at", "TEXT")?;
    ensure_column(conn, "files", "context", "TEXT")?;
    ensure_column(conn, "file_tags", "source", "TEXT NOT NULL DEFAULT 'user'")?;
    // Whether the local models have had a look at this file yet.
    //
    // Kept separate from `embedding_state` on purpose: a file can be analysed
    // and still have no vector (a text-only document in an image-only space),
    // and conflating the two would either re-run the work forever or skip files
    // that were never analysed at all. This is the flag a backfill pass reads.
    ensure_column(conn, "files", "analysis_state", "TEXT NOT NULL DEFAULT 'none'")?;

    Ok(())
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> AppResult<bool> {
    let mut statement = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn ensure_column(conn: &Connection, table: &str, column: &str, definition: &str) -> AppResult<()> {
    if !column_exists(conn, table, column)? {
        conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

fn labels_from_json(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw).unwrap_or_default()
}

fn row_to_file(row: &rusqlite::Row<'_>) -> rusqlite::Result<FileRecord> {
    let labels: String = row.get(21)?;
    let text: Option<String> = row.get(29)?;
    let context: Option<String> = row.get(30)?;
    let ext: String = row.get(4)?;
    Ok(FileRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        kind: row.get(3)?,
        ext,
        mime: row.get(5)?,
        bytes: row.get(6)?,
        width: row.get(7)?,
        height: row.get(8)?,
        duration_sec: row.get(9)?,
        pages: row.get(10)?,
        folder_id: row.get(11)?,
        folder_path: row.get(12)?,
        created_at: row.get(13)?,
        modified_at: row.get(14)?,
        indexed_at: row.get(15)?,
        favorite: row.get::<_, i64>(16)? != 0,
        thumb_path: row.get(17)?,
        preview_path: row.get(18)?,
        generated_title: row.get(19)?,
        description: row.get(20)?,
        labels: labels_from_json(&labels),
        project_id: row.get(22)?,
        ocr_state: row.get(23)?,
        ocr_confidence: row.get(24)?,
        ocr_engine: row.get(25)?,
        index_state: row.get(26)?,
        hash: row.get(27)?,
        embedding_state: row.get(28)?,
        ocr_text: text.filter(|value| !value.trim().is_empty()),
        context: context.filter(|value| !value.trim().is_empty()),
        tag_ids: Vec::new(),
        machine_tag_ids: Vec::new(),
        collection_ids: Vec::new(),
    })
}

fn row_to_folder(row: &rusqlite::Row<'_>) -> rusqlite::Result<Folder> {
    Ok(Folder {
        id: row.get(0)?,
        path: row.get(1)?,
        name: row.get(2)?,
        watched: row.get::<_, i64>(3)? != 0,
        last_scan_at: row.get(4)?,
        status: row.get(5)?,
        problem: row.get(6)?,
        file_count: row.get(7)?,
        size_bytes: row.get(8)?,
    })
}

const FOLDER_SELECT: &str = "SELECT fo.id, fo.path, fo.name, fo.watched, fo.last_scan_at, \
     fo.status, fo.problem, \
     (SELECT COUNT(*) FROM files f WHERE f.folder_id = fo.id AND f.index_state <> 'missing'), \
     (SELECT COALESCE(SUM(f.bytes), 0) FROM files f WHERE f.folder_id = fo.id AND \
      f.index_state <> 'missing') \
     FROM folders fo";

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

pub fn list_folders(conn: &Connection) -> AppResult<Vec<Folder>> {
    let mut statement = conn.prepare(&format!("{FOLDER_SELECT} ORDER BY fo.name COLLATE NOCASE"))?;
    let rows = statement.query_map([], row_to_folder)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn folder_by_id(conn: &Connection, id: &str) -> AppResult<Option<Folder>> {
    let mut statement = conn.prepare(&format!("{FOLDER_SELECT} WHERE fo.id = ?1"))?;
    Ok(statement.query_row(params![id], row_to_folder).optional()?)
}

pub fn folder_by_path(conn: &Connection, path: &str) -> AppResult<Option<Folder>> {
    let mut statement = conn.prepare(&format!("{FOLDER_SELECT} WHERE fo.path = ?1"))?;
    Ok(statement
        .query_row(params![path], row_to_folder)
        .optional()?)
}

pub fn insert_folder(conn: &Connection, id: &str, path: &str, name: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO folders (id, path, name, watched, status, added_at) VALUES (?1, ?2, ?3, 1, 'ok', ?4)",
        params![id, path, name, now()],
    )?;
    Ok(())
}

pub fn delete_folder(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM files WHERE folder_id = ?1", params![id])?;
    conn.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn set_folder_watched(conn: &Connection, id: &str, watched: bool) -> AppResult<()> {
    conn.execute(
        "UPDATE folders SET watched = ?2 WHERE id = ?1",
        params![id, if watched { 1 } else { 0 }],
    )?;
    Ok(())
}

pub fn set_folder_status(conn: &Connection, id: &str, status: &str, problem: Option<&str>) -> AppResult<()> {
    conn.execute(
        "UPDATE folders SET status = ?2, problem = ?3 WHERE id = ?1",
        params![id, status, problem],
    )?;
    Ok(())
}

pub fn mark_folder_scanned(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE folders SET status = 'ok', problem = NULL, last_scan_at = ?2 WHERE id = ?1",
        params![id, now()],
    )?;
    Ok(())
}

pub fn last_scan_at(conn: &Connection) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT MAX(last_scan_at) FROM folders", [], |row| {
            row.get::<_, Option<String>>(0)
        })
        .optional()?
        .flatten())
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/// What scanning learned about one file on disk.
pub struct ScanRow {
    pub id: String,
    pub path: String,
    pub name: String,
    pub ext: String,
    pub mime: String,
    pub kind: String,
    pub bytes: i64,
    pub created_at: String,
    pub modified_at: String,
    pub folder_id: String,
    pub folder_path: String,
    pub hash: String,
    /// False for formats the pipeline deliberately does not process.
    pub supported: bool,
}

/// Fingerprint of every file already indexed in a folder, by path.
///
/// The scan compares these before touching anything, which is what makes a
/// rescan of a large folder cheap: unchanged files are never re-read.
pub fn folder_fingerprints(conn: &Connection, folder_id: &str) -> AppResult<HashMap<String, (String, String)>> {
    let mut statement = conn.prepare("SELECT path, id, COALESCE(hash, '') FROM files WHERE folder_id = ?1")?;
    let rows = statement.query_map(params![folder_id], |row| {
        Ok((row.get::<_, String>(0)?, (row.get::<_, String>(1)?, row.get::<_, String>(2)?)))
    })?;
    let mut map = HashMap::new();
    for row in rows {
        let (path, value) = row?;
        map.insert(path, value);
    }
    Ok(map)
}

/// Insert or refresh the metadata row for a discovered file.
///
/// The row exists from the moment a file is found — with `pending` state — so
/// the grid can show it immediately and the pipeline can enrich it after.
pub fn upsert_scanned_file(conn: &Connection, row: &ScanRow) -> AppResult<()> {
    let state = if row.supported { STATE_PENDING } else { STATE_UNSUPPORTED };
    let ocr_state = if row.supported { "pending" } else { "none" };
    conn.execute(
        "INSERT INTO files (id, path, name, ext, mime, kind, bytes, folder_id, folder_path,
                            created_at, modified_at, indexed_at, index_state, ocr_state, hash, seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
         ON CONFLICT(path) DO UPDATE SET
            name = excluded.name,
            ext = excluded.ext,
            mime = excluded.mime,
            kind = excluded.kind,
            bytes = excluded.bytes,
            folder_id = excluded.folder_id,
            folder_path = excluded.folder_path,
            modified_at = excluded.modified_at,
            hash = excluded.hash,
            seen_at = excluded.seen_at,
            -- When the content moved, the timestamp it had before is kept.
            -- Somebody edited the file, and the pipeline is about to replace its
            -- presentation copy: this is the last moment at which the previous
            -- one can still be saved. SET expressions read the old row, so this
            -- stores the timestamp being overwritten.
            previous_modified_at = CASE
                WHEN files.hash IS excluded.hash THEN files.previous_modified_at
                ELSE files.modified_at
            END,
            index_state = CASE
                WHEN files.hash IS excluded.hash AND files.index_state IN ('indexed', 'unsupported')
                    THEN files.index_state
                ELSE excluded.index_state
            END,
            ocr_state = CASE
                WHEN files.hash IS excluded.hash AND files.index_state IN ('indexed', 'unsupported')
                    THEN files.ocr_state
                ELSE excluded.ocr_state
            END",
        params![
            row.id,
            row.path,
            row.name,
            row.ext,
            row.mime,
            row.kind,
            row.bytes,
            row.folder_id,
            row.folder_path,
            row.created_at,
            row.modified_at,
            now(),
            state,
            ocr_state,
            row.hash,
            now(),
        ],
    )?;
    Ok(())
}

/// Mark files that were not seen during the last scan of a folder as `missing`.
///
/// The row survives: it keeps tag, collection and project membership, so a file
/// that is moved back into a watched folder comes back with its history intact.
/// Returns the names of the files that went missing, for the activity log.
pub fn mark_missing(
    conn: &Connection,
    folder_id: &str,
    seen_ids: &std::collections::HashSet<String>,
) -> AppResult<Vec<String>> {
    let mut stale: Vec<(String, String)> = Vec::new();
    {
        let mut statement = conn.prepare(
            "SELECT id, name FROM files WHERE folder_id = ?1 AND index_state <> 'missing'",
        )?;
        let rows = statement.query_map(params![folder_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (id, name) = row?;
            if !seen_ids.contains(&id) {
                stale.push((id, name));
            }
        }
    }

    let mut names = Vec::with_capacity(stale.len());
    for (id, name) in stale {
        conn.execute(
            "UPDATE files SET index_state = 'missing', seen_at = ?2 WHERE id = ?1",
            params![id, now()],
        )?;
        names.push(name);
    }

    Ok(names)
}

pub fn set_index_state(conn: &Connection, file_id: &str, state: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE files SET index_state = ?2, seen_at = ?3 WHERE id = ?1",
        params![file_id, state, now()],
    )?;
    Ok(())
}

pub fn set_analysis_state(conn: &Connection, file_id: &str, state: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE files SET analysis_state = ?2 WHERE id = ?1",
        params![file_id, state],
    )?;
    Ok(())
}

/// Files the models have not looked at yet, oldest first.
///
/// The oldest first matters: a backfill over a large library should reach the
/// pictures somebody actually kept early rather than the most recent few
/// thousand, and the order also means an interrupted pass resumes where it
/// stopped.
pub fn files_needing_analysis(conn: &Connection, limit: i64) -> AppResult<Vec<(String, String, String)>> {
    // Two reasons to look at a file, and the second one is not about models at
    // all. A file whose 
    // preview is missing needs the pipeline to run for the picture alone: this
    // is how a library indexed before video and document stills existed gets
    // them, without anybody re-importing anything. Without this clause those
    // files are 'analysed' or 'none' and permanently invisible in the grid —
    // a video tile with no frame and a PDF tile with no page.
    let mut statement = conn.prepare(
        "SELECT id, path, kind FROM files
         WHERE index_state = 'indexed'
           AND (
             analysis_state != 'analysed'
             OR (preview_path IS NULL
                 AND kind IN ('photo', 'screenshot', 'video', 'document', 'design'))
           )
         ORDER BY created_at ASC
         LIMIT ?1",
    )?;
    let rows = statement.query_map(params![limit], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// How much of the library the models have not looked at yet.
pub fn analysis_progress(conn: &Connection) -> AppResult<(i64, i64)> {
    let remaining: i64 = conn.query_row(
        "SELECT COUNT(*) FROM files
         WHERE index_state = 'indexed'
           AND (analysis_state != 'analysed'
                OR (preview_path IS NULL
                    AND kind IN ('photo', 'screenshot', 'video', 'document', 'design')))",
        [],
        |row| row.get(0),
    )?;
    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM files WHERE index_state = 'indexed'",
        [],
        |row| row.get(0),
    )?;
    Ok((total - remaining, total))
}

pub fn set_ocr_state(conn: &Connection, file_id: &str, state: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE files SET ocr_state = ?2 WHERE id = ?1",
        params![file_id, state],
    )?;
    Ok(())
}

pub fn set_embedding_state(conn: &Connection, file_id: &str, state: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE files SET embedding_state = ?2 WHERE id = ?1",
        params![file_id, state],
    )?;
    Ok(())
}

pub fn set_faces_state(conn: &Connection, file_id: &str, state: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE files SET faces_state = ?2 WHERE id = ?1",
        params![file_id, state],
    )?;
    Ok(())
}

pub fn set_thumbnail(conn: &Connection, file_id: &str, path: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE files SET thumb_path = ?2 WHERE id = ?1",
        params![file_id, path],
    )?;
    Ok(())
}

/// Store the larger derivative written for the hero panel.
pub fn set_preview(conn: &Connection, file_id: &str, path: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE files SET preview_path = ?2 WHERE id = ?1",
        params![file_id, path],
    )?;
    Ok(())
}

/// The modification time a file's content had before its last change.
///
/// The scan writes this whenever a fingerprint moves, and reading it clears it:
/// a kept version is taken exactly once per change, so a crash between the scan
/// and the pipeline can never produce two copies of the same edit.
///
/// `None` means the file has never changed since it was first indexed, which
/// also means there is nothing to compare it against.
pub fn take_previous_content(conn: &Connection, file_id: &str) -> AppResult<Option<String>> {
    let previous = conn
        .query_row(
            "SELECT previous_modified_at FROM files WHERE id = ?1",
            params![file_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();

    if previous.is_some() {
        conn.execute(
            "UPDATE files SET previous_modified_at = NULL WHERE id = ?1",
            params![file_id],
        )?;
    }
    Ok(previous)
}

/// The photograph the Home hero should show, chosen from the user's own files.
///
/// Deliberately narrow: a landscape photograph, large enough not to look like a
/// crop, with a preview already on disk. Screenshots, documents and PDF pages are
/// excluded — a hero built from an error dialog would misrepresent the archive —
/// and when nothing qualifies this returns `None`, so the interface falls back to
/// its own tint rather than inventing a scene.
pub fn hero_candidate(conn: &Connection) -> AppResult<Option<FileRecord>> {
    // Three tiers, loosest last: a wide photograph at real resolution, then any
    // photograph, then any image-like file that has a preview.
    const TIERS: [&str; 3] = [
        "WHERE f.index_state = 'indexed' AND f.kind = 'photo'
           AND f.preview_path IS NOT NULL AND f.width >= 1200 AND f.height >= 800
           AND CAST(f.width AS REAL) / f.height BETWEEN 1.15 AND 2.4
         ORDER BY ABS(CAST(f.width AS REAL) / f.height - 1.6) ASC,
                  f.width * f.height DESC, f.created_at DESC LIMIT 8",
        "WHERE f.index_state = 'indexed' AND f.kind = 'photo' AND f.preview_path IS NOT NULL
         ORDER BY f.width * f.height DESC, f.created_at DESC LIMIT 8",
        "WHERE f.index_state = 'indexed' AND f.kind IN ('design', 'video')
           AND f.preview_path IS NOT NULL
         ORDER BY f.created_at DESC LIMIT 8",
    ];

    for tier in TIERS {
        let sql = format!("SELECT {FILE_COLUMNS} {FILE_SOURCE} {tier}");
        let mut statement = conn.prepare(&sql)?;
        let candidates = statement
            .query_map([], row_to_file)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for candidate in candidates {
            // A row can outlive the file it names — a preview deleted by hand, an
            // index carried between machines — so a picture is only offered once
            // it is confirmed to be on disk.
            if let Some(preview) = candidate.preview_path.as_deref() {
                if Path::new(preview).is_file() {
                    return Ok(Some(candidate));
                }
            }
        }
    }

    Ok(None)
}

pub fn set_probe(
    conn: &Connection,
    file_id: &str,
    width: Option<i64>,
    height: Option<i64>,
    pages: Option<i64>,
    duration: Option<f64>,
) -> AppResult<()> {
    conn.execute(
        "UPDATE files SET width = COALESCE(?2, width), height = COALESCE(?3, height),
                          pages = COALESCE(?4, pages), duration_sec = COALESCE(?5, duration_sec)
         WHERE id = ?1",
        params![file_id, width, height, pages, duration],
    )?;
    Ok(())
}

pub fn save_text(
    conn: &Connection,
    file_id: &str,
    text: &str,
    confidence: f64,
    engine: &str,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO ocr_content (file_id, text, confidence, engine, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(file_id) DO UPDATE SET
            text = excluded.text,
            confidence = excluded.confidence,
            engine = excluded.engine,
            updated_at = excluded.updated_at",
        params![file_id, text, confidence, engine, now()],
    )?;
    conn.execute(
        "UPDATE files SET ocr_state = 'extracted', ocr_confidence = ?2, ocr_engine = ?3
         WHERE id = ?1",
        params![file_id, confidence, engine],
    )?;
    Ok(())
}

pub fn save_generated(
    conn: &Connection,
    file_id: &str,
    title: Option<&str>,
    description: Option<&str>,
    labels: &[String],
    context: Option<&str>,
    tags: &[String],
) -> AppResult<()> {
    conn.execute(
        "UPDATE files SET generated_title = ?2, description = ?3, labels = ?4, context = ?5
         WHERE id = ?1",
        params![
            file_id,
            title,
            description,
            serde_json::to_string(labels).unwrap_or_else(|_| "[]".into()),
            context
        ],
    )?;
    // The labels are also written as real tags, in the same transaction as the
    // label column.
    //
    // They used to live only in that column, which meant the tag list, the tag
    // chips and every tag-based search saw a file with no tags on it while its
    // `labels` column held four. A label the interface cannot show, filter by or
    // search on is not a tag, it is a string nobody reads.
    set_analysis_tags(conn, file_id, tags)?;
    Ok(())
}

/// The tags a machine put on this file, replaced wholesale.
///
/// Only rows with `source = 'ai'` are touched. A tag the user added by hand
/// survives re-analysis, model installs and rebuilds — the alternative loses
/// somebody's own work every time a better model arrives, which is the kind of
/// thing that makes people stop tagging anything.
///
/// An empty list is a legitimate result and clears the machine's tags: the file
/// was analysed and there was nothing to say about it.
pub fn set_analysis_tags(conn: &Connection, file_id: &str, names: &[String]) -> AppResult<()> {
    conn.execute(
        "DELETE FROM file_tags WHERE file_id = ?1 AND source = 'ai'",
        params![file_id],
    )?;

    for name in names {
        let tag = ensure_tag(conn, name)?;
        conn.execute(
            "INSERT OR IGNORE INTO file_tags (file_id, tag_id, source) VALUES (?1, ?2, 'ai')",
            params![file_id, tag.id],
        )?;
    }
    Ok(())
}

/// Every tag that came from analysis rather than from the user.
///
/// This is what a smart collection can be built on and what the interface
/// groups under "from your files": a tag nobody typed but that describes what
/// is actually in the archive.
pub fn analysis_tag_names(conn: &Connection) -> AppResult<Vec<String>> {
    let mut statement = conn.prepare(
        "SELECT DISTINCT t.name FROM file_tags ft JOIN tags t ON t.id = ft.tag_id
         WHERE ft.source = 'ai' ORDER BY t.name COLLATE NOCASE ASC",
    )?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Rebuild this file's row in the full-text index.
///
/// Called after any change to searchable content, so `file_search` is a
/// projection of the tables rather than a parallel truth that can drift.
pub fn reindex_search_row(conn: &Connection, file_id: &str) -> AppResult<()> {
    // The names of the people in this file, as the user typed them. `group_concat`
    // over the faces join means a photograph with three named faces contributes
    // all three, and an unnamed group contributes nothing rather than a placeholder.
    let row = conn
        .query_row(
            "SELECT f.name, COALESCE(f.generated_title, ''), COALESCE(f.description, ''),
                    f.labels, COALESCE(o.text, ''), f.folder_path, f.project_id,
                    COALESCE(p.name, ''),
                    COALESCE((SELECT group_concat(pe.label, ' ')
                              FROM faces fa JOIN people pe ON pe.id = fa.person_id
                              WHERE fa.file_id = f.id AND pe.label IS NOT NULL
                                AND pe.hidden = 0), ''),
                    COALESCE(f.context, '')
             FROM files f
             LEFT JOIN ocr_content o ON o.file_id = f.id
             LEFT JOIN projects p ON p.id = f.project_id
             WHERE f.id = ?1",
            params![file_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                ))
            },
        )
        .optional()?;

    conn.execute("DELETE FROM file_search WHERE file_id = ?1", params![file_id])?;
    let Some((name, title, description, labels, text, folder, project, people, context)) = row else {
        return Ok(());
    };

    let mut tags = String::new();
    {
        let mut statement = conn.prepare(
            "SELECT t.name FROM file_tags ft JOIN tags t ON t.id = ft.tag_id WHERE ft.file_id = ?1",
        )?;
        let rows = statement.query_map(params![file_id], |row| row.get::<_, String>(0))?;
        for tag in rows {
            tags.push(' ');
            tags.push_str(&tag?);
        }
    }

    let labels_text = labels_from_json(&labels).join(" ");
    conn.execute(
        "INSERT INTO file_search (file_id, name, title, description, labels, context, text, folder, tags, project, people)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            file_id,
            name,
            title,
            description,
            labels_text,
            context,
            text,
            folder,
            tags,
            project,
            people
        ],
    )?;
    Ok(())
}

pub fn file_by_id(conn: &Connection, file_id: &str) -> AppResult<Option<FileRecord>> {
    let mut statement = conn.prepare(&format!(
        "SELECT {FILE_COLUMNS} {FILE_SOURCE} WHERE f.id = ?1"
    ))?;
    let file = statement.query_row(params![file_id], row_to_file).optional()?;
    match file {
        Some(mut file) => {
            hydrate(conn, std::slice::from_mut(&mut file))?;
            Ok(Some(file))
        }
        None => Ok(None),
    }
}

pub fn file_path(conn: &Connection, file_id: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT path FROM files WHERE id = ?1", params![file_id], |row| {
            row.get::<_, String>(0)
        })
        .optional()?)
}

pub fn files_by_ids(conn: &Connection, ids: &[String]) -> AppResult<Vec<FileRecord>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = std::iter::repeat("?").take(ids.len()).collect::<Vec<_>>().join(", ");
    let sql = format!("SELECT {FILE_COLUMNS} {FILE_SOURCE} WHERE f.id IN ({placeholders})");
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(ids.iter()), row_to_file)?;
    let mut files = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    hydrate(conn, &mut files)?;
    Ok(files)
}

/// Fill in tag and collection membership for a page of files.
///
/// Two extra queries for a whole page beats a join that multiplies rows.
fn hydrate(conn: &Connection, files: &mut [FileRecord]) -> AppResult<()> {
    if files.is_empty() {
        return Ok(());
    }
    let ids: Vec<String> = files.iter().map(|file| file.id.clone()).collect();
    let placeholders = std::iter::repeat("?").take(ids.len()).collect::<Vec<_>>().join(", ");

    let mut tag_map: HashMap<String, Vec<String>> = HashMap::new();
    let mut machine_tag_map: HashMap<String, Vec<String>> = HashMap::new();
    {
        // `source` travels with the membership so the interface can tell a tag
        // the user typed from one the models inferred. They are shown
        // differently because they are different kinds of statement: one is the
        // user's own word, the other is the application's opinion, and removing
        // the second is not the same act as removing the first.
        let sql = format!(
            "SELECT ft.file_id, ft.tag_id, ft.source FROM file_tags ft
             WHERE ft.file_id IN ({placeholders})"
        );
        let mut statement = conn.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(ids.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?;
        for row in rows {
            let (file_id, tag_id, source) = row?;
            if source.as_deref() == Some("ai") {
                machine_tag_map.entry(file_id).or_default().push(tag_id);
            } else {
                tag_map.entry(file_id).or_default().push(tag_id);
            }
        }
    }

    let mut collection_map: HashMap<String, Vec<String>> = HashMap::new();
    {
        let sql = format!(
            "SELECT fc.file_id, fc.collection_id FROM file_collections fc WHERE fc.file_id IN ({placeholders})"
        );
        let mut statement = conn.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(ids.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (file_id, collection_id) = row?;
            collection_map.entry(file_id).or_default().push(collection_id);
        }
    }

    for file in files.iter_mut() {
        // Both kinds are in `tag_ids`: every filter, count and search that works
        // on tags keeps working unchanged. `machine_tag_ids` is the subset, for
        // the one place that needs to draw them differently.
        let machine = machine_tag_map.remove(&file.id).unwrap_or_default();
        let mut all = tag_map.remove(&file.id).unwrap_or_default();
        all.extend(machine.iter().cloned());
        file.tag_ids = all;
        file.machine_tag_ids = machine;
        file.collection_ids = collection_map.remove(&file.id).unwrap_or_default();
    }
    Ok(())
}

/// True when the file matches a collection: explicit membership, or its rule.
fn collection_fragment(conn: &Connection, collection_id: &str) -> AppResult<Option<(String, Vec<Value>)>> {
    let row: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT kind, rule FROM collections WHERE id = ?1",
            params![collection_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    let Some((kind, rule)) = row else {
        return Ok(None);
    };

    if kind == "manual" || rule.is_none() {
        return Ok(Some((
            "EXISTS (SELECT 1 FROM file_collections fc WHERE fc.file_id = f.id AND fc.collection_id = ?)"
                .to_string(),
            vec![Value::Text(collection_id.to_string())],
        )));
    }

    let rule: CollectionRule = serde_json::from_str(rule.as_deref().unwrap_or("{}")).unwrap_or_default();
    let mut clause = String::from("(");
    let mut values: Vec<Value> = Vec::new();
    let mut conditions: Vec<String> = Vec::new();

    if let Some(kinds) = rule.kinds.as_ref().filter(|kinds| !kinds.is_empty()) {
        let list = std::iter::repeat("?").take(kinds.len()).collect::<Vec<_>>().join(", ");
        conditions.push(format!("f.kind IN ({list})"));
        values.extend(kinds.iter().cloned().map(Value::Text));
    }
    if let Some(days) = rule.days {
        conditions.push("f.created_at >= ?".into());
        values.push(Value::Text(
            (Local::now() - Duration::days(days)).to_rfc3339_opts(SecondsFormat::Secs, false),
        ));
    }
    if let Some(tags) = rule.tags.as_ref().filter(|tags| !tags.is_empty()) {
        let list = std::iter::repeat("?").take(tags.len()).collect::<Vec<_>>().join(", ");
        conditions.push(format!(
            "EXISTS (SELECT 1 FROM file_tags ft JOIN tags t ON t.id = ft.tag_id
                     WHERE ft.file_id = f.id AND t.name IN ({list}))"
        ));
        values.extend(tags.iter().cloned().map(Value::Text));
    }
    if rule.favorites_only.unwrap_or(false) {
        conditions.push("f.favorite = 1".into());
    }

    clause.push_str(&conditions.join(" AND "));
    clause.push_str(")");
    Ok(Some((clause, values)))
}

fn sort_clause(sort: Option<&str>) -> &'static str {
    match sort.unwrap_or("recent") {
        "oldest" => "f.created_at ASC",
        "name" => "f.name COLLATE NOCASE ASC",
        "size" => "f.bytes DESC",
        "kind" => "f.kind ASC, f.created_at DESC",
        _ => "f.created_at DESC",
    }
}

pub fn list_files(conn: &Connection, query: &FileQuery) -> AppResult<(Vec<FileRecord>, i64)> {
    let mut where_clause = String::from("WHERE f.index_state <> 'missing'");
    let mut values: Vec<Value> = Vec::new();

    if let Some(kinds) = query.kinds.as_ref().filter(|kinds| !kinds.is_empty()) {
        let list = std::iter::repeat("?").take(kinds.len()).collect::<Vec<_>>().join(", ");
        where_clause.push_str(&format!(" AND f.kind IN ({list})"));
        values.extend(kinds.iter().cloned().map(Value::Text));
    }
    if let Some(folder_id) = &query.folder_id {
        where_clause.push_str(" AND f.folder_id = ?");
        values.push(Value::Text(folder_id.clone()));
    }
    if let Some(person_id) = &query.person_id {
        where_clause.push_str(
            " AND EXISTS (SELECT 1 FROM faces fa WHERE fa.file_id = f.id AND fa.person_id = ?)",
        );
        values.push(Value::Text(person_id.clone()));
    }
    if let Some(project_id) = &query.project_id {
        where_clause.push_str(" AND f.project_id = ?");
        values.push(Value::Text(project_id.clone()));
    }
    if let Some(tag_id) = &query.tag_id {
        where_clause.push_str(
            " AND EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id AND ft.tag_id = ?)",
        );
        values.push(Value::Text(tag_id.clone()));
    }
    if query.favorites_only.unwrap_or(false) {
        where_clause.push_str(" AND f.favorite = 1");
    }
    if let Some(days) = query.since_days {
        where_clause.push_str(" AND f.created_at >= ?");
        values.push(Value::Text(
            (Local::now() - Duration::days(days)).to_rfc3339_opts(SecondsFormat::Secs, false),
        ));
    }
    if let Some(day) = query.day.as_deref().filter(|day| !day.trim().is_empty()) {
        // Half-open, so a file added at 23:59:59 on the day belongs to that day
        // and to nothing else. Rows are stored as RFC 3339 in local time, which
        // is what makes the comparison correct here — and the one thing that
        // makes the day filter mean what the header above it said.
        if let Ok(start) = NaiveDate::parse_from_str(day.trim(), "%Y-%m-%d") {
            let from = start
                .and_hms_opt(0, 0, 0)
                .and_then(|moment| Local.from_local_datetime(&moment).single());
            let until = start
                .succ_opt()
                .and_then(|next| next.and_hms_opt(0, 0, 0))
                .and_then(|moment| Local.from_local_datetime(&moment).single());
            if let (Some(from), Some(until)) = (from, until) {
                where_clause.push_str(" AND f.created_at >= ? AND f.created_at < ?");
                values.push(Value::Text(from.to_rfc3339_opts(SecondsFormat::Secs, false)));
                values.push(Value::Text(until.to_rfc3339_opts(SecondsFormat::Secs, false)));
            }
        }
    }
    if let Some(collection_id) = &query.collection_id {
        match collection_fragment(conn, collection_id)? {
            Some((fragment, mut fragment_values)) => {
                where_clause.push_str(&format!(" AND {fragment}"));
                values.append(&mut fragment_values);
            }
            // A collection that no longer exists matches nothing.
            None => where_clause.push_str(" AND 0"),
        }
    }

    let total: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM files f {where_clause}"),
        params_from_iter(values.iter()),
        |row| row.get(0),
    )?;

    let limit = query.limit.unwrap_or(120).clamp(1, 1000);
    let offset = query.offset.unwrap_or(0).max(0);

    let sql = format!(
        "SELECT {FILE_COLUMNS} {FILE_SOURCE} {where_clause} ORDER BY {} LIMIT ? OFFSET ?",
        sort_clause(query.sort.as_deref())
    );

    let mut statement = conn.prepare(&sql)?;
    let mut page_values = values.clone();
    page_values.push(Value::Integer(limit));
    page_values.push(Value::Integer(offset));
    let rows = statement.query_map(params_from_iter(page_values.iter()), row_to_file)?;
    let mut files = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    hydrate(conn, &mut files)?;
    Ok((files, total))
}

pub fn totals(conn: &Connection) -> AppResult<ArchiveTotals> {
    let files: i64 = conn.query_row(
        "SELECT COUNT(*) FROM files WHERE index_state <> 'missing'",
        [],
        |row| row.get(0),
    )?;

    let start_of_day = Local::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .map(|naive| {
            DateTime::<Local>::from_naive_utc_and_offset(naive, Local::now().offset().clone())
                .to_rfc3339_opts(SecondsFormat::Secs, false)
        })
        .unwrap_or_else(now);

    let new_today: i64 = conn.query_row(
        "SELECT COUNT(*) FROM files WHERE index_state <> 'missing' AND created_at >= ?1",
        params![start_of_day],
        |row| row.get(0),
    )?;

    let mut by_kind: BTreeMap<String, i64> = BTreeMap::new();
    {
        let mut statement = conn.prepare(
            "SELECT kind, COUNT(*) FROM files WHERE index_state <> 'missing' GROUP BY kind",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        for row in rows {
            let (kind, count) = row?;
            by_kind.insert(kind, count);
        }
    }

    Ok(ArchiveTotals {
        files,
        new_today,
        by_kind,
    })
}

pub fn storage_stats(conn: &Connection, capacity: i64) -> AppResult<StorageStats> {
    let (used_bytes, indexed_files): (i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(bytes), 0), COUNT(*) FROM files
         WHERE index_state <> 'missing' AND index_state <> 'failed'",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    let pending_files: i64 = conn.query_row(
        "SELECT COUNT(*) FROM files WHERE index_state IN ('pending', 'processing')",
        [],
        |row| row.get(0),
    )?;

    let failed_files: i64 = conn.query_row(
        "SELECT COUNT(*) FROM files WHERE index_state = 'failed'",
        [],
        |row| row.get(0),
    )?;

    let mut by_kind: BTreeMap<String, i64> = BTreeMap::new();
    {
        let mut statement = conn.prepare(
            "SELECT kind, COALESCE(SUM(bytes), 0) FROM files WHERE index_state <> 'missing'
             GROUP BY kind",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        for row in rows {
            let (kind, bytes) = row?;
            by_kind.insert(kind, bytes);
        }
    }

    Ok(StorageStats {
        used_bytes,
        total_bytes: capacity,
        indexed_files,
        pending_files,
        failed_files,
        by_kind,
    })
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

pub fn list_tags(conn: &Connection) -> AppResult<Vec<Tag>> {
    let mut statement = conn.prepare(
        "SELECT t.id, t.name, t.pinned,
                (SELECT COUNT(*) FROM file_tags ft WHERE ft.tag_id = t.id) AS count
         FROM tags t
         ORDER BY count DESC, t.name COLLATE NOCASE ASC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(Tag {
            id: row.get(0)?,
            name: row.get(1)?,
            pinned: row.get::<_, i64>(2)? != 0,
            count: row.get(3)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn ensure_tag(conn: &Connection, name: &str) -> AppResult<Tag> {
    let clean = name.trim().trim_start_matches('#').trim();
    if let Some(tag) = conn
        .query_row(
            "SELECT id, name, pinned, (SELECT COUNT(*) FROM file_tags ft WHERE ft.tag_id = tags.id)
             FROM tags WHERE name = ?1 COLLATE NOCASE",
            params![clean],
            |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    pinned: row.get::<_, i64>(2)? != 0,
                    count: row.get(3)?,
                })
            },
        )
        .optional()?
    {
        return Ok(tag);
    }

    let id = format!("tag-{}", uuid_like());
    conn.execute(
        "INSERT INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)",
        params![id, clean, now()],
    )?;
    Ok(Tag {
        id,
        name: clean.to_string(),
        count: 0,
        pinned: false,
    })
}

pub fn attach_tag(conn: &Connection, file_id: &str, tag_id: &str) -> AppResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?1, ?2)",
        params![file_id, tag_id],
    )?;
    reindex_search_row(conn, file_id)?;
    Ok(())
}

pub fn detach_tag(conn: &Connection, file_id: &str, tag_id: &str) -> AppResult<()> {
    conn.execute(
        "DELETE FROM file_tags WHERE file_id = ?1 AND tag_id = ?2",
        params![file_id, tag_id],
    )?;
    reindex_search_row(conn, file_id)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

/// The collections, each with the counts its card shows.
///
/// A smart collection has no membership rows to count — that is exactly what
/// makes it smart — so its rule is evaluated here. Skipping that step is how a
/// card ends up reading "0 files" beside a name that opens a full grid, which is
/// worse than a wrong number: it is a number the user can see is wrong.
pub fn list_collections(conn: &Connection) -> AppResult<Vec<ArchiveCollection>> {
    let mut statement = conn.prepare(
        "SELECT id, name, kind, surface, rule, icon FROM collections ORDER BY name COLLATE NOCASE",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, String>(5)?,
        ))
    })?;

    let mut collections: Vec<ArchiveCollection> = Vec::new();
    for row in rows {
        let (id, name, kind, surface, rule_raw, icon) = row?;
        let rule = rule_raw
            .as_deref()
            .and_then(|raw| serde_json::from_str::<CollectionRule>(raw).ok());

        let (file_count, size_bytes, preview) = if kind == "smart" && rule.is_some() {
            resolve_rule(conn, &id)?
        } else {
            explicit_members(conn, &id)?
        };

        collections.push(ArchiveCollection {
            id,
            name,
            kind,
            surface,
            rule,
            icon,
            file_count,
            size_bytes,
            preview,
        });
    }

    Ok(collections)
}

/// Count, size and the four previews for a collection of explicit members.
fn explicit_members(conn: &Connection, collection_id: &str) -> AppResult<(i64, i64, Vec<String>)> {
    let totals = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(f.bytes), 0)
           FROM file_collections fc JOIN files f ON f.id = fc.file_id
          WHERE fc.collection_id = ?1 AND f.index_state <> 'missing'",
        params![collection_id],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )?;
    let preview = previews_for(
        conn,
        "EXISTS (SELECT 1 FROM file_collections fc WHERE fc.file_id = f.id AND fc.collection_id = ?1)",
        params![collection_id],
    );
    Ok((totals.0, totals.1, preview))
}

/// The same three things for a collection defined by a rule.
fn resolve_rule(conn: &Connection, collection_id: &str) -> AppResult<(i64, i64, Vec<String>)> {
    let Some((clause, values)) = collection_fragment(conn, collection_id)? else {
        return Ok((0, 0, Vec::new()));
    };
    let sql = format!(
        "SELECT COUNT(*), COALESCE(SUM(f.bytes), 0) FROM files f
          WHERE {clause} AND f.index_state <> 'missing'"
    );
    let totals = conn.query_row(&sql, rusqlite::params_from_iter(values.iter()), |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
    })?;

    let preview_sql = format!(
        "SELECT f.thumb_path FROM files f
          WHERE {clause} AND f.index_state <> 'missing' AND f.thumb_path IS NOT NULL
          ORDER BY f.created_at DESC LIMIT 4"
    );
    let mut statement = conn.prepare(&preview_sql)?;
    let rows = statement.query_map(rusqlite::params_from_iter(values.iter()), |row| {
        row.get::<_, String>(0)
    })?;
    let preview = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok((totals.0, totals.1, preview))
}

fn previews_for(
    conn: &Connection,
    condition: &str,
    params: impl rusqlite::Params,
) -> Vec<String> {
    let sql = format!(
        "SELECT f.thumb_path FROM files f
          WHERE {condition} AND f.index_state <> 'missing' AND f.thumb_path IS NOT NULL
          ORDER BY f.created_at DESC LIMIT 4"
    );
    let Ok(mut statement) = conn.prepare(&sql) else {
        return Vec::new();
    };
    let Ok(rows) = statement.query_map(params, |row| row.get::<_, String>(0)) else {
        return Vec::new();
    };
    rows.filter_map(|row| row.ok()).collect()
}

/// The virtual collections every archive is given on first run.
///
/// Each is a rule, not a list: no membership row is written, no file is moved,
/// copied or renamed, and a file can be in as many of them as its own content
/// justifies. They fill in as analysis completes, and empty out again if a file
/// is deleted — the rule is the whole definition.
///
/// `(name, icon, surface, rule)`.
const BUILT_IN_COLLECTIONS: &[(&str, &str, &str, &str)] = &[
    (
        "Screenshots",
        "MonitorSmartphone",
        "blue",
        r#"{"kinds":["screenshot"]}"#,
    ),
    (
        "Code",
        "Braces",
        "lavender",
        r#"{"tags":["code","react","javascript","typescript","python","rust","java","sql","html","css","shell","terminal","error","dashboard","spreadsheet"]}"#,
    ),
    (
        "UI Designs",
        "Palette",
        "mint",
        r#"{"tags":["ui","design","dashboard","chart","logo"]}"#,
    ),
    (
        "Documents",
        "FileText",
        "peach",
        r#"{"kinds":["document"]}"#,
    ),
    (
        "Receipts",
        "Clipboard",
        "peach",
        r#"{"tags":["receipt","invoice","ticket"]}"#,
    ),
    (
        "Presentations",
        "Monitor",
        "blue",
        r#"{"tags":["presentation","slide"]}"#,
    ),
    (
        "Wallpapers",
        "Sun",
        "mint",
        r#"{"tags":["wallpaper"]}"#,
    ),
    (
        "People",
        "Users",
        "lavender",
        r#"{"tags":["person","portrait","selfie","group","baby","crowd"]}"#,
    ),
    (
        "Games",
        "Play",
        "lavender",
        r#"{"tags":["game"]}"#,
    ),
    (
        "Meme",
        "Smile",
        "peach",
        r#"{"tags":["meme"]}"#,
    ),
    (
        "Products",
        "Briefcase",
        "mint",
        r#"{"tags":["product"]}"#,
    ),
    (
        "Videos",
        "Film",
        "neutral",
        r#"{"kinds":["video"]}"#,
    ),
];

/// Create any built-in collection the archive does not have yet.
///
/// Safe to call on every start: a collection is matched by name, so one the user
/// renamed is left alone rather than recreated beside itself, and one the user
/// deleted stays deleted for the session it was deleted in only if they delete
/// it again — which is stated plainly here because it is a real trade-off. The
/// alternative is a hidden "dismissed" flag for something the user never asked
/// to keep in the first place.
pub fn seed_smart_collections(conn: &Connection) -> AppResult<usize> {
    let mut created = 0;
    for (name, icon, surface, rule) in BUILT_IN_COLLECTIONS {
        let exists: Option<String> = conn
            .query_row(
                "SELECT id FROM collections WHERE name = ?1 COLLATE NOCASE",
                params![name],
                |row| row.get(0),
            )
            .optional()?;
        if exists.is_some() {
            continue;
        }
        conn.execute(
            "INSERT INTO collections (id, name, kind, rule, surface, icon, created_at)
             VALUES (?1, ?2, 'smart', ?3, ?4, ?5, ?6)",
            params![format!("col-{}", uuid_like()), name, rule, surface, icon, now()],
        )?;
        created += 1;
    }
    Ok(created)
}

pub fn create_collection(conn: &Connection, name: &str, surface: &str, icon: &str) -> AppResult<ArchiveCollection> {
    let clean = name.trim();
    if clean.is_empty() {
        return Err(AppError::Config("A collection needs a name".into()));
    }
    let id = format!("col-{}", uuid_like());
    conn.execute(
        "INSERT INTO collections (id, name, kind, surface, icon, created_at)
         VALUES (?1, ?2, 'manual', ?3, ?4, ?5)",
        params![id, clean, surface, icon, now()],
    )?;
    Ok(ArchiveCollection {
        id,
        name: clean.to_string(),
        kind: "manual".into(),
        file_count: 0,
        size_bytes: 0,
        surface: surface.to_string(),
        icon: icon.to_string(),
        rule: None,
        preview: Vec::new(),
    })
}

pub fn delete_collection(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM collections WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn attach_collection(conn: &Connection, file_id: &str, collection_id: &str) -> AppResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO file_collections (file_id, collection_id) VALUES (?1, ?2)",
        params![file_id, collection_id],
    )?;
    Ok(())
}

pub fn detach_collection(conn: &Connection, file_id: &str, collection_id: &str) -> AppResult<()> {
    conn.execute(
        "DELETE FROM file_collections WHERE file_id = ?1 AND collection_id = ?2",
        params![file_id, collection_id],
    )?;
    Ok(())
}

/// Rename a collection.
///
/// Names are unique in the schema, so a clash is reported as a sentence rather
/// than surfacing SQLite's constraint error to the interface.
pub fn rename_collection(conn: &Connection, id: &str, name: &str) -> AppResult<()> {
    let clean = name.trim();
    if clean.is_empty() {
        return Err(AppError::Config("A collection needs a name".into()));
    }

    let taken: i64 = conn.query_row(
        "SELECT COUNT(*) FROM collections WHERE name = ?1 AND id <> ?2",
        params![clean, id],
        |row| row.get(0),
    )?;
    if taken > 0 {
        return Err(AppError::Config(format!(
            "There is already a collection called “{clean}”"
        )));
    }

    let changed = conn.execute(
        "UPDATE collections SET name = ?2 WHERE id = ?1",
        params![id, clean],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound("that collection is no longer here".into()));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Kept versions
// ---------------------------------------------------------------------------

const VERSION_COLUMNS: &str =
    "id, file_id, path, bytes, width, height, captured_at, content_at, source";

fn row_to_version(row: &rusqlite::Row<'_>) -> rusqlite::Result<FileVersion> {
    Ok(FileVersion {
        id: row.get(0)?,
        file_id: row.get(1)?,
        path: row.get(2)?,
        bytes: row.get(3)?,
        width: row.get(4)?,
        height: row.get(5)?,
        captured_at: row.get(6)?,
        content_at: row.get(7)?,
        source: row.get(8)?,
    })
}

pub fn insert_version(conn: &Connection, version: &FileVersion) -> AppResult<()> {
    conn.execute(
        "INSERT INTO file_versions
            (id, file_id, path, bytes, width, height, captured_at, content_at, source)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            version.id,
            version.file_id,
            version.path,
            version.bytes,
            version.width,
            version.height,
            version.captured_at,
            version.content_at,
            version.source,
        ],
    )?;
    Ok(())
}

/// Every kept copy of one file, newest content first.
pub fn list_versions(conn: &Connection, file_id: &str) -> AppResult<Vec<FileVersion>> {
    let mut statement = conn.prepare(&format!(
        "SELECT {VERSION_COLUMNS} FROM file_versions WHERE file_id = ?1
         ORDER BY content_at DESC, captured_at DESC"
    ))?;
    let rows = statement.query_map(params![file_id], row_to_version)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn version_by_id(conn: &Connection, id: &str) -> AppResult<Option<FileVersion>> {
    let mut statement = conn.prepare(&format!(
        "SELECT {VERSION_COLUMNS} FROM file_versions WHERE id = ?1"
    ))?;
    Ok(statement.query_row(params![id], row_to_version).optional()?)
}

pub fn delete_version(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM file_versions WHERE id = ?1", params![id])?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

pub fn list_projects(conn: &Connection) -> AppResult<Vec<Project>> {
    let mut statement = conn.prepare(
        "SELECT p.id, p.name, p.color, p.created_at, p.updated_at,
                (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id AND f.index_state <> 'missing')
         FROM projects p
         ORDER BY p.updated_at DESC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(Project {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
            file_count: row.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn create_project(conn: &Connection, name: &str, color: &str) -> AppResult<Project> {
    let clean = name.trim();
    if clean.is_empty() {
        return Err(AppError::Config("A project needs a name".into()));
    }
    let id = format!("prj-{}", uuid_like());
    let stamp = now();
    conn.execute(
        "INSERT INTO projects (id, name, color, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, clean, color, stamp],
    )?;
    Ok(Project {
        id,
        name: clean.to_string(),
        file_count: 0,
        color: color.to_string(),
        created_at: stamp.clone(),
        updated_at: stamp,
    })
}

pub fn delete_project(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("UPDATE files SET project_id = NULL WHERE project_id = ?1", params![id])?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn set_file_project(conn: &Connection, file_id: &str, project_id: Option<&str>) -> AppResult<()> {
    conn.execute(
        "UPDATE files SET project_id = ?2 WHERE id = ?1",
        params![file_id, project_id],
    )?;
    if let Some(project_id) = project_id {
        conn.execute(
            "UPDATE projects SET updated_at = ?2 WHERE id = ?1",
            params![project_id, now()],
        )?;
    }
    reindex_search_row(conn, file_id)?;
    Ok(())
}

pub fn set_favorite(conn: &Connection, file_id: &str, value: bool) -> AppResult<()> {
    conn.execute(
        "UPDATE files SET favorite = ?2 WHERE id = ?1",
        params![file_id, if value { 1 } else { 0 }],
    )?;
    Ok(())
}

pub fn set_file_name(conn: &Connection, file_id: &str, name: &str, path: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE files SET name = ?2, path = ?3, indexed_at = ?4 WHERE id = ?1",
        params![file_id, name, path, now()],
    )?;
    reindex_search_row(conn, file_id)?;
    Ok(())
}

/// A file that has been moved to another folder, by the organizer.
///
/// Distinct from `set_file_name` because a move also changes which folder the
/// file belongs to, and therefore which folder a search for a location finds it
/// through — the full-text row is rebuilt rather than patched, so searching the
/// archive by the folder it now lives in works immediately.
pub fn set_file_location(
    conn: &Connection,
    file_id: &str,
    name: &str,
    path: &str,
    folder_id: &str,
    folder_path: &str,
) -> AppResult<()> {
    conn.execute(
        "UPDATE files SET name = ?2, path = ?3, folder_id = ?4, folder_path = ?5, indexed_at = ?6 \
         WHERE id = ?1",
        params![file_id, name, path, folder_id, folder_path, now()],
    )?;
    reindex_search_row(conn, file_id)?;
    Ok(())
}

/// One file as the organizer sees it: where it is, what it is, and how the
/// archive has it grouped.
///
/// Collections come back alphabetically so "the first one" is a stable answer,
/// and only named people are included — an unnamed group of faces has no name to
/// give a folder.
pub struct OrganizeRow {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: String,
    pub bytes: i64,
    pub index_state: String,
    pub collections: Vec<String>,
    pub people: Vec<String>,
}

/// Field separator for the `group_concat` columns below. Unit separator: it
/// cannot occur in a filename on any platform this ships on.
const GROUP_SEPARATOR: char = '\u{1f}';

pub fn organize_rows(conn: &Connection) -> AppResult<Vec<OrganizeRow>> {
    let mut statement = conn.prepare(
        "SELECT f.id, f.name, f.path, f.kind, f.bytes, f.index_state, \
                (SELECT group_concat(c.name, char(31)) FROM file_collections fc \
                   JOIN collections c ON c.id = fc.collection_id \
                  WHERE fc.file_id = f.id ORDER BY c.name), \
                (SELECT group_concat(DISTINCT p.label, char(31)) FROM faces fa \
                   JOIN people p ON p.id = fa.person_id \
                  WHERE fa.file_id = f.id AND p.label IS NOT NULL AND p.label <> '' \
                    AND p.hidden = 0) \
           FROM files f",
    )?;

    let rows = statement.query_map([], |row| {
        let split = |value: Option<String>| -> Vec<String> {
            value
                .map(|text| {
                    text.split(GROUP_SEPARATOR)
                        .filter(|part| !part.trim().is_empty())
                        .map(|part| part.to_string())
                        .collect()
                })
                .unwrap_or_default()
        };

        Ok(OrganizeRow {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            kind: row.get(3)?,
            bytes: row.get(4)?,
            index_state: row.get(5)?,
            collections: split(row.get(6)?),
            people: split(row.get(7)?),
        })
    })?;

    Ok(rows.collect::<rusqlite::Result<Vec<OrganizeRow>>>()?)
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

pub fn push_activity(
    conn: &Connection,
    kind: &str,
    label: &str,
    detail: Option<&str>,
    file_id: Option<&str>,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO activity (kind, label, detail, file_id, at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![kind, label, detail, file_id, now()],
    )?;
    Ok(())
}

pub fn list_activity(conn: &Connection, limit: i64) -> AppResult<Vec<ActivityEntry>> {
    let mut statement = conn.prepare(
        "SELECT id, kind, label, detail, at, file_id FROM activity ORDER BY at DESC, id DESC LIMIT ?1",
    )?;
    let rows = statement.query_map(params![limit.clamp(1, 500)], |row| {
        Ok(ActivityEntry {
            id: row.get::<_, i64>(0)?.to_string(),
            kind: row.get(1)?,
            label: row.get(2)?,
            detail: row.get(3)?,
            at: row.get(4)?,
            file_id: row.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/// Full-text candidates, best first, as (file id, bm25 score).
pub fn search_fts(
    conn: &Connection,
    match_expression: &str,
    query: &FileQuery,
    limit: i64,
) -> AppResult<Vec<(String, f64)>> {
    let mut where_clause = String::from("WHERE file_search MATCH ?1 AND f.index_state <> 'missing'");
    let mut values: Vec<Value> = vec![Value::Text(match_expression.to_string())];

    if let Some(kinds) = query.kinds.as_ref().filter(|kinds| !kinds.is_empty()) {
        let list = std::iter::repeat("?").take(kinds.len()).collect::<Vec<_>>().join(", ");
        where_clause.push_str(&format!(" AND f.kind IN ({list})"));
        values.extend(kinds.iter().cloned().map(Value::Text));
    }
    if query.favorites_only.unwrap_or(false) {
        where_clause.push_str(" AND f.favorite = 1");
    }
    if let Some(days) = query.since_days {
        where_clause.push_str(" AND f.created_at >= ?");
        values.push(Value::Text(
            (Local::now() - Duration::days(days)).to_rfc3339_opts(SecondsFormat::Secs, false),
        ));
    }

    let sql = format!(
        "SELECT file_search.file_id, bm25(file_search) AS score
         FROM file_search JOIN files f ON f.id = file_search.file_id
         {where_clause}
         ORDER BY score LIMIT ?"
    );
    values.push(Value::Integer(limit));

    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params_from_iter(values.iter()), |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Files matching a substring of a name, path, title or person's name.
///
/// The safety net under token search. The index matches whole words and their
/// prefixes, which is what makes it fast; this catches the middle of a word
/// ("rror" inside "error"), a name typed with different spacing, and a person
/// whose name was added after their photographs were indexed. Deliberately not
/// the first thing tried: a substring scan is slower and less precise, so it
/// only runs when the index found nothing.
pub fn search_substring(conn: &Connection, needle: &str, limit: i64) -> AppResult<Vec<String>> {
    let lowered = needle.to_lowercase();
    let mut statement = conn.prepare(
        "SELECT f.id FROM files f
         WHERE f.index_state <> 'missing'
           AND (lower(f.name) LIKE ?1
                OR lower(f.folder_path) LIKE ?1
                OR lower(COALESCE(f.generated_title, '')) LIKE ?1
                OR lower(COALESCE(f.description, '')) LIKE ?1
                OR EXISTS (SELECT 1 FROM faces fa JOIN people pe ON pe.id = fa.person_id
                           WHERE fa.file_id = f.id
                             AND lower(COALESCE(pe.label, '')) LIKE ?1))
         LIMIT ?2",
    )?;
    let rows = statement.query_map(params![format!("%{lowered}%"), limit], |row| {
        row.get::<_, String>(0)
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<String>>>()?)
}

/// A candidate file for related-file scoring.
pub struct Candidate {
    pub id: String,
    pub created_at: String,
    pub folder_id: String,
    pub project_id: String,
    pub text: String,
}

/// Every indexed file, newest first, with the fields related-file scoring needs.
pub fn candidate_pool(conn: &Connection, limit: i64) -> AppResult<Vec<Candidate>> {
    let mut statement = conn.prepare(
        "SELECT f.id, f.created_at, f.folder_id, COALESCE(f.project_id, ''), COALESCE(o.text, '')
         FROM files f LEFT JOIN ocr_content o ON o.file_id = f.id
         WHERE f.index_state <> 'missing'
         ORDER BY f.created_at DESC LIMIT ?1",
    )?;
    let rows = statement.query_map(params![limit], |row| {
        Ok(Candidate {
            id: row.get(0)?,
            created_at: row.get(1)?,
            folder_id: row.get(2)?,
            project_id: row.get(3)?,
            text: row.get(4)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Tag names per file for the whole archive, in one query.
///
/// Related-file scoring compares a file against a few thousand others; doing
/// that with a query per candidate would be thousands of round trips.
pub fn tag_map(conn: &Connection) -> AppResult<HashMap<String, Vec<String>>> {
    let mut statement =
        conn.prepare("SELECT ft.file_id, t.name FROM file_tags ft JOIN tags t ON t.id = ft.tag_id")?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let (file_id, name) = row?;
        map.entry(file_id).or_default().push(name);
    }
    Ok(map)
}

pub fn tag_names(conn: &Connection, file_id: &str) -> AppResult<Vec<String>> {
    let mut statement =
        conn.prepare("SELECT t.name FROM file_tags ft JOIN tags t ON t.id = ft.tag_id WHERE ft.file_id = ?1")?;
    let rows = statement.query_map(params![file_id], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

pub fn get_setting(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM settings WHERE key = ?1", params![key], |row| {
            row.get::<_, String>(0)
        })
        .optional()?)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// A short random id, without pulling in a random-number crate.
pub fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let counter = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("{nanos:x}{:x}", counter)
}

static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

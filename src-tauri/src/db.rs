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

use chrono::{DateTime, Duration, Local, SecondsFormat};
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};

use crate::error::{AppError, AppResult};
use crate::models::{
    ActivityEntry, ArchiveCollection, ArchiveTotals, CollectionRule, FileQuery, FileRecord, Folder,
    Project, StorageStats, Tag,
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
     f.embedding_state, o.text";

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

pub fn migrate(conn: &Connection) -> AppResult<()> {
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

        CREATE TABLE IF NOT EXISTS file_tags (
            file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
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
            color      TEXT NOT NULL DEFAULT '#2F7773',
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

        CREATE INDEX IF NOT EXISTS idx_files_folder     ON files(folder_id);
        CREATE INDEX IF NOT EXISTS idx_files_kind       ON files(kind);
        CREATE INDEX IF NOT EXISTS idx_files_created    ON files(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_files_modified   ON files(modified_at DESC);
        CREATE INDEX IF NOT EXISTS idx_files_project    ON files(project_id);
        CREATE INDEX IF NOT EXISTS idx_files_state      ON files(index_state);
        CREATE INDEX IF NOT EXISTS idx_files_name       ON files(name);
        CREATE INDEX IF NOT EXISTS idx_file_tags_tag    ON file_tags(tag_id);
        CREATE INDEX IF NOT EXISTS idx_activity_at      ON activity(at DESC);

        -- One searchable document per file: name, generated title, description,
        -- labels, extracted text, folder, tags and project name. Rebuilt from
        -- the row whenever any of those change, so the index can never drift.
        CREATE VIRTUAL TABLE IF NOT EXISTS file_search USING fts5(
            file_id UNINDEXED,
            name,
            title,
            description,
            labels,
            text,
            folder,
            tags,
            project,
            tokenize = 'unicode61 remove_diacritics 2'
        );
        "#,
    )?;

    // Columns added after the first release. `CREATE TABLE IF NOT EXISTS` does
    // nothing to an existing database, so anything new arrives by ALTER.
    ensure_column(conn, "files", "preview_path", "TEXT")?;

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
        tag_ids: Vec::new(),
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
) -> AppResult<()> {
    conn.execute(
        "UPDATE files SET generated_title = ?2, description = ?3, labels = ?4 WHERE id = ?1",
        params![
            file_id,
            title,
            description,
            serde_json::to_string(labels).unwrap_or_else(|_| "[]".into())
        ],
    )?;
    Ok(())
}

/// Rebuild this file's row in the full-text index.
///
/// Called after any change to searchable content, so `file_search` is a
/// projection of the tables rather than a parallel truth that can drift.
pub fn reindex_search_row(conn: &Connection, file_id: &str) -> AppResult<()> {
    let row = conn
        .query_row(
            "SELECT f.name, COALESCE(f.generated_title, ''), COALESCE(f.description, ''),
                    f.labels, COALESCE(o.text, ''), f.folder_path, f.project_id,
                    COALESCE(p.name, '')
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
                ))
            },
        )
        .optional()?;

    conn.execute("DELETE FROM file_search WHERE file_id = ?1", params![file_id])?;
    let Some((name, title, description, labels, text, folder, project)) = row else {
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
        "INSERT INTO file_search (file_id, name, title, description, labels, text, folder, tags, project)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            file_id,
            name,
            title,
            description,
            labels_text,
            text,
            folder,
            tags,
            project
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
    {
        let sql = format!(
            "SELECT ft.file_id, ft.tag_id FROM file_tags ft WHERE ft.file_id IN ({placeholders})"
        );
        let mut statement = conn.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(ids.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (file_id, tag_id) = row?;
            tag_map.entry(file_id).or_default().push(tag_id);
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
        file.tag_ids = tag_map.remove(&file.id).unwrap_or_default();
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

fn row_to_collection(row: &rusqlite::Row<'_>) -> rusqlite::Result<ArchiveCollection> {
    let rule: Option<String> = row.get(4)?;
    Ok(ArchiveCollection {
        id: row.get(0)?,
        name: row.get(1)?,
        kind: row.get(2)?,
        surface: row.get(3)?,
        rule: rule.and_then(|raw| serde_json::from_str::<CollectionRule>(&raw).ok()),
        icon: row.get(5)?,
        file_count: row.get(6)?,
        size_bytes: row.get(7)?,
        preview: Vec::new(),
    })
}

pub fn list_collections(conn: &Connection) -> AppResult<Vec<ArchiveCollection>> {
    let mut statement = conn.prepare(
        "SELECT id, name, kind, surface, rule, icon,
                (SELECT COUNT(*) FROM file_collections fc WHERE fc.collection_id = collections.id),
                (SELECT COALESCE(SUM(f.bytes), 0) FROM file_collections fc
                   JOIN files f ON f.id = fc.file_id
                  WHERE fc.collection_id = collections.id AND f.index_state <> 'missing')
         FROM collections
         ORDER BY name COLLATE NOCASE",
    )?;
    let rows = statement.query_map([], row_to_collection)?;
    let mut collections = rows.collect::<rusqlite::Result<Vec<_>>>()?;

    for collection in collections.iter_mut() {
        let mut statement = conn.prepare(
            "SELECT f.thumb_path FROM file_collections fc JOIN files f ON f.id = fc.file_id
             WHERE fc.collection_id = ?1 AND f.thumb_path IS NOT NULL
             ORDER BY f.created_at DESC LIMIT 4",
        )?;
        let rows = statement.query_map(params![collection.id], |row| row.get::<_, String>(0))?;
        collection.preview = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    }

    Ok(collections)
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

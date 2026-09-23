//! Kept versions — the record behind before/after comparison.
//!
//! AfterImage never edits a picture, so a "version" here is not a project file
//! or a stack of layers. It is the archive's own 1600px presentation copy, kept
//! the moment the pipeline notices the file on disk has changed. Edits happen in
//! whatever application the user actually edits in; what this module does is
//! refuse to throw away what was there before one landed.
//!
//! Two decisions worth stating:
//!
//!   * **A version is a copy of a derivative, not of the original.** Keeping
//!     full-resolution copies of every photograph on every save would double the
//!     user's disk usage to serve a comparison view. The presentation copy is
//!     already written for every image, so keeping the one that is about to be
//!     overwritten costs a few hundred kilobytes and shows the change exactly.
//!   * **Copies live inside the thumbnail directory.** That is the one path
//!     Tauri's asset protocol is scoped to, so versions reach the webview
//!     without widening the security boundary by a single directory.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::db;
use crate::error::{AppError, AppResult};
use crate::models::FileVersion;
use crate::thumbs;

/// How many copies of one file are kept before the oldest are dropped.
///
/// A version costs a few hundred kilobytes, so this is a bound on how much of
/// the user's disk a picture's history may hold — not a limit on how often they
/// may edit. Everything past it would never be looked at anyway.
pub const MAX_VERSIONS: usize = 12;

/// The presentation copy the rest of the archive shows for a file.
pub fn preview_path(thumbnail_dir: &Path, file_id: &str) -> PathBuf {
    thumbnail_dir.join("previews").join(format!("{file_id}.jpg"))
}

/// Where one file's kept copies live.
pub fn version_dir(thumbnail_dir: &Path, file_id: &str) -> PathBuf {
    thumbnail_dir.join("versions").join(file_id)
}

/// The copy is on disk but is not yet a version: whether it becomes one depends
/// on whether the pipeline manages to write its replacement.
pub struct Pending {
    copy: PathBuf,
    directory: PathBuf,
    file_id: String,
    content_at: String,
}

impl Pending {
    /// Keep it: the copy becomes a version of the file.
    pub fn keep(self, conn: &Connection) -> AppResult<FileVersion> {
        let (width, height) = match thumbs::dimensions(&self.copy) {
            Some((width, height)) => (Some(width), Some(height)),
            None => (None, None),
        };
        let bytes = std::fs::metadata(&self.copy)
            .map(|metadata| metadata.len() as i64)
            .unwrap_or(0);

        let version = FileVersion {
            id: format!("ver-{}", db::uuid_like()),
            file_id: self.file_id,
            path: self.copy.to_string_lossy().to_string(),
            bytes,
            width,
            height,
            captured_at: db::now(),
            content_at: self.content_at,
            source: "change".to_string(),
        };
        db::insert_version(conn, &version)?;
        prune(conn, &self.directory, &version.file_id);
        Ok(version)
    }

    /// Nothing replaced it after all, so the copy is redundant.
    pub fn discard(self) {
        let _ = std::fs::remove_file(&self.copy);
    }
}

/// Take a copy of the presentation the file had before its last change.
///
/// `None` when the file has never changed (nothing to compare against), when no
/// presentation copy exists yet, or when the copy cannot be written — all of
/// which mean the same thing to the caller: there is no earlier version.
///
/// The "changed" flag is cleared here rather than after the copy is confirmed,
/// so a crash can never leave the archive copying the same preview for ever.
pub fn keep_previous_preview(
    conn: &Connection,
    thumbnail_dir: &Path,
    file_id: &str,
) -> Option<Pending> {
    let content_at = db::take_previous_content(conn, file_id).ok().flatten()?;

    let preview = preview_path(thumbnail_dir, file_id);
    if !preview.is_file() {
        return None;
    }

    let directory = version_dir(thumbnail_dir, file_id);
    std::fs::create_dir_all(&directory).ok()?;
    let copy = directory.join(format!("{}.jpg", db::uuid_like()));
    std::fs::copy(&preview, &copy).ok()?;

    Some(Pending {
        copy,
        directory,
        file_id: file_id.to_string(),
        content_at,
    })
}

/// Keep the presentation copy as it stands now, on the user's own instruction.
pub fn capture(
    conn: &Connection,
    thumbnail_dir: &Path,
    file_id: &str,
) -> AppResult<FileVersion> {
    let preview = preview_path(thumbnail_dir, file_id);
    if !preview.is_file() {
        return Err(AppError::NotFound(
            "There is no presentation copy of this file to keep".to_string(),
        ));
    }

    // The date that matters is the one the pixels were last written under, so it
    // comes from the row rather than from the wall clock.
    let content_at = conn
        .query_row(
            "SELECT modified_at FROM files WHERE id = ?1",
            rusqlite::params![file_id],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| db::now());

    let directory = version_dir(thumbnail_dir, file_id);
    std::fs::create_dir_all(&directory)?;
    let copy = directory.join(format!("{}.jpg", db::uuid_like()));
    std::fs::copy(&preview, &copy)?;

    let (width, height) = match thumbs::dimensions(&copy) {
        Some((width, height)) => (Some(width), Some(height)),
        None => (None, None),
    };
    let bytes = std::fs::metadata(&copy)
        .map(|metadata| metadata.len() as i64)
        .unwrap_or(0);

    let version = FileVersion {
        id: format!("ver-{}", db::uuid_like()),
        file_id: file_id.to_string(),
        path: copy.to_string_lossy().to_string(),
        bytes,
        width,
        height,
        captured_at: db::now(),
        content_at,
        source: "manual".to_string(),
    };
    db::insert_version(conn, &version)?;
    prune(conn, thumbnail_dir, file_id);
    Ok(version)
}

/// Drop the oldest copies once there are more than the archive keeps.
fn prune(conn: &Connection, thumbnail_dir: &Path, file_id: &str) {
    let Ok(versions) = db::list_versions(conn, file_id) else {
        return;
    };
    for version in versions.into_iter().skip(MAX_VERSIONS) {
        discard(&version.path);
        let _ = db::delete_version(conn, &version.id);
    }
    // Whatever the rows said, nothing else belongs in this file's directory.
    if let Ok(entries) = std::fs::read_dir(version_dir(thumbnail_dir, file_id)) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|value| value == "jpg") {
                continue;
            }
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Remove one kept copy from disk.
pub fn discard(path: &str) {
    let _ = std::fs::remove_file(path);
}

/// Drop every kept copy of a file that has left the archive.
pub fn remove(thumbnail_dir: &Path, file_id: &str) {
    let _ = std::fs::remove_dir_all(version_dir(thumbnail_dir, file_id));
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    struct Fixture {
        conn: Connection,
        dir: PathBuf,
        file_id: String,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    /// A database with one file, and the presentation copy the pipeline wrote
    /// for it before somebody edited the picture.
    fn fixture(tag: &str) -> Fixture {
        let conn = Connection::open_in_memory().expect("in-memory database");
        db::migrate(&conn).expect("schema");

        let dir = std::env::temp_dir().join(format!("afterimage-{tag}-{}", db::uuid_like()));
        let previews = dir.join("previews");
        std::fs::create_dir_all(&previews).expect("preview directory");

        let file_id = "file-1".to_string();
        conn.execute(
            "INSERT INTO folders (id, path, name, watched, added_at)
             VALUES ('folder-1', 'C:/Pictures', 'Pictures', 1, ?1)",
            params![db::now()],
        )
        .expect("folder row");
        conn.execute(
            "INSERT INTO files (id, path, name, ext, mime, kind, bytes, width, height, folder_id,
                                folder_path, created_at, modified_at, indexed_at, preview_path,
                                hash, previous_modified_at)
             VALUES (?1, 'C:/Pictures/a.jpg', 'a.jpg', 'jpg', 'image/jpeg', 'photo', 1024, 8, 8,
                     'folder-1', 'C:/Pictures', ?2, ?3, ?2, ?4, 'new-fingerprint', ?5)",
            params![
                file_id,
                "2026-09-19T09:34:00+02:00",
                "2026-09-20T11:00:00+02:00",
                previews.join(format!("{file_id}.jpg")).to_string_lossy().to_string(),
                "2026-09-12T08:00:00+02:00",
            ],
        )
        .expect("file row");

        image::RgbImage::from_pixel(8, 8, image::Rgb([40, 90, 140]))
            .save(previews.join(format!("{file_id}.jpg")))
            .expect("write the presentation copy");

        Fixture { conn, dir, file_id }
    }

    #[test]
    fn the_copy_from_before_a_change_is_kept_exactly_once() {
        let fixture = fixture("versions-keep");
        let Fixture { conn, dir, file_id } = &fixture;

        let pending = keep_previous_preview(conn, dir, file_id).expect("a copy to keep");
        // The flag is cleared when the copy is taken, so a crash cannot leave
        // the archive copying the same preview on every pass.
        assert!(db::take_previous_content(conn, file_id).unwrap().is_none());
        assert!(
            keep_previous_preview(conn, dir, file_id).is_none(),
            "nothing left to keep on the second pass"
        );

        let version = pending.keep(conn).expect("the version row");
        assert_eq!(version.content_at, "2026-09-12T08:00:00+02:00");
        assert_eq!(version.source, "change");
        assert_eq!((version.width, version.height), (Some(8), Some(8)));
        assert!(Path::new(&version.path).is_file(), "the copy is on disk");
        assert_eq!(db::list_versions(conn, file_id).unwrap().len(), 1);
    }

    #[test]
    fn a_copy_nobody_replaced_is_thrown_away() {
        let fixture = fixture("versions-discard");
        let Fixture { conn, dir, file_id } = &fixture;

        let pending = keep_previous_preview(conn, dir, file_id).expect("a copy to keep");
        let copy = pending.copy.clone();
        pending.discard();

        assert!(!copy.is_file(), "the redundant copy is gone");
        assert!(db::list_versions(conn, file_id).unwrap().is_empty());
    }

    #[test]
    fn history_is_capped_and_the_oldest_copies_go_first() {
        let fixture = fixture("versions-prune");
        let Fixture { conn, dir, file_id } = &fixture;

        for _ in 0..MAX_VERSIONS + 3 {
            capture(conn, dir, file_id).expect("a kept copy");
        }

        let versions = db::list_versions(conn, file_id).unwrap();
        assert_eq!(versions.len(), MAX_VERSIONS);
        // Every row the archive still lists has its file, and nothing else is
        // left behind in the directory.
        let kept: Vec<PathBuf> = versions.iter().map(|version| PathBuf::from(&version.path)).collect();
        for path in &kept {
            assert!(path.is_file(), "{} should still exist", path.display());
        }
        let on_disk = std::fs::read_dir(version_dir(dir, file_id))
            .expect("version directory")
            .flatten()
            .count();
        assert_eq!(on_disk, MAX_VERSIONS, "no orphans left in the directory");
    }

    #[test]
    fn a_file_that_never_changed_has_nothing_to_keep() {
        let fixture = fixture("versions-untouched");
        let Fixture { conn, dir, file_id } = &fixture;
        conn.execute(
            "UPDATE files SET previous_modified_at = NULL WHERE id = ?1",
            params![file_id],
        )
        .unwrap();

        assert!(keep_previous_preview(conn, dir, file_id).is_none());
        assert!(db::list_versions(conn, file_id).unwrap().is_empty());
    }
}

//! Scanning.
//!
//! Walking the folders the user granted, deciding what each file is, and writing
//! a row per file. This is the only place that touches the filesystem for
//! discovery, and it never writes to a user's file: reading metadata, nothing
//! more.
//!
//! Two decisions worth stating plainly, because both are visible in the
//! interface:
//!
//!   * **What gets processed.** Images, screenshots, PDFs, text-like documents
//!     and video files are indexed and enriched. Everything else still gets a
//!     row — with its real size and date — but is marked `unsupported`, so the
//!     counts are honest about what is on disk and what the pipeline can read.
//!   * **When to redo work.** Each row keeps a fingerprint of size and
//!     modification time. A rescan compares fingerprints and skips unchanged
//!     files, which is what keeps a second scan of a 40,000-file folder to a
//!     single directory walk.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use walkdir::WalkDir;

use crate::db::{self, ScanRow};
use crate::error::{AppError, AppResult};
use crate::models::Folder;

/// Directories that are never worth indexing and are often enormous.
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    ".svn",
    ".hg",
    "__pycache__",
    ".venv",
    "venv",
    ".next",
    ".cache",
    "dist",
    "build",
    "out",
    "vendor",
    "Pods",
    "DerivedData",
    "Library",
    "$RECYCLE.BIN",
    "System Volume Information",
    ".Trash",
    ".gradle",
    ".idea",
];

const IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif", "avif"];
const VIDEO_EXTS: &[&str] = &["mp4", "mov", "webm", "mkv", "avi", "m4v"];
const AUDIO_EXTS: &[&str] = &["mp3", "wav", "flac", "m4a", "ogg", "aac"];
const DOC_EXTS: &[&str] = &[
    "pdf", "txt", "md", "markdown", "rtf", "json", "csv", "log", "yaml", "yml", "toml", "xml",
    "doc", "docx", "odt", "pages", "tex",
];
const DESIGN_EXTS: &[&str] = &["psd", "ai", "fig", "sketch", "xd", "afdesign", "svg", "indd", "eps"];
const ARCHIVE_EXTS: &[&str] = &["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "dmg", "iso"];

/// Formats the pipeline can actually read text or pixel content from.
/// Everything else is indexed by metadata alone, and says so.
const PROCESSABLE_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif", "avif", "mp4", "mov",
    "webm", "mkv", "m4v", "pdf", "txt", "md", "markdown", "json", "csv", "log", "yaml", "yml",
    "toml", "xml", "rtf",
];

pub fn extension(path: &Path) -> String {
    path.extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// The bucket a file belongs in.
///
/// Screenshots are separated from photographs by name and folder, because that
/// distinction is the one users search by most: "the screenshot where the build
/// failed" is a different question from "the photo I took on holiday".
pub fn classify(name: &str, ext: &str, folder_name: &str) -> String {
    let lower = name.to_lowercase();
    let folder = folder_name.to_lowercase();
    let looks_like_capture = lower.starts_with("screenshot")
        || lower.starts_with("screen shot")
        || lower.starts_with("capture")
        || lower.starts_with("snip")
        || lower.starts_with("cleanshot")
        || lower.contains("screen capture")
        || folder.contains("screenshot")
        || folder.contains("capture");

    if IMAGE_EXTS.contains(&ext) {
        return if looks_like_capture { "screenshot" } else { "photo" }.to_string();
    }
    if VIDEO_EXTS.contains(&ext) {
        return "video".to_string();
    }
    if AUDIO_EXTS.contains(&ext) {
        return "audio".to_string();
    }
    if DOC_EXTS.contains(&ext) {
        return "document".to_string();
    }
    if DESIGN_EXTS.contains(&ext) {
        return "design".to_string();
    }
    if ARCHIVE_EXTS.contains(&ext) {
        return "archive".to_string();
    }
    "other".to_string()
}

pub fn mime_for(ext: &str) -> String {
    let mime = match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "heic" | "heif" => "image/heic",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "ogg" => "audio/ogg",
        "aac" => "audio/aac",
        "pdf" => "application/pdf",
        "txt" | "log" => "text/plain",
        "md" | "markdown" => "text/markdown",
        "json" => "application/json",
        "csv" => "text/csv",
        "yaml" | "yml" => "application/yaml",
        "toml" => "application/toml",
        "xml" => "application/xml",
        "rtf" => "application/rtf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "zip" => "application/zip",
        "rar" => "application/vnd.rar",
        "7z" => "application/x-7z-compressed",
        "tar" => "application/x-tar",
        "gz" => "application/gzip",
        "psd" => "image/vnd.adobe.photoshop",
        "ai" => "application/postscript",
        "fig" => "application/figma",
        "sketch" => "application/sketch",
        "dmg" => "application/x-apple-diskimage",
        "iso" => "application/x-iso9660-image",
        _ => "application/octet-stream",
    };
    mime.to_string()
}

pub fn kind_supports_text(kind: &str) -> bool {
    matches!(kind, "screenshot" | "document" | "photo" | "design")
}

#[derive(Debug, Default, Clone)]
pub struct ScanSummary {
    pub discovered: i64,
    pub added: i64,
    pub unchanged: i64,
    pub missing: i64,
    pub unsupported: i64,
    /// Rows that need the pipeline, in the order they should be processed.
    pub queued: Vec<(String, String, String)>,
}

fn walk(root: &Path) -> Vec<PathBuf> {
    WalkDir::new(root)
        .follow_links(false)
        .max_depth(24)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            if name.starts_with('.') {
                return false;
            }
            if entry.file_type().is_dir() {
                return !SKIP_DIRS.iter().any(|skip| name.eq_ignore_ascii_case(skip));
            }
            true
        })
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| entry.into_path())
        .collect()
}

/// Index one folder, comparing against what is already known.
///
/// Called for the first scan of a folder the user granted and for every
/// subsequent change the watcher reports. It is deliberately idempotent: running
/// it twice in a row does nothing the second time but a directory walk.
pub fn scan_folder(conn: &Connection, folder: &Folder) -> AppResult<ScanSummary> {
    let root = PathBuf::from(&folder.path);
    if !root.is_dir() {
        db::set_folder_status(conn, &folder.id, "missing", Some("The folder is not reachable"))?;
        return Err(AppError::NotFound(format!(
            "{} is no longer available",
            folder.path
        )));
    }

    db::set_folder_status(conn, &folder.id, "scanning", None)?;

    let known = db::folder_fingerprints(conn, &folder.id)?;
    let paths = walk(&root);
    let mut summary = ScanSummary::default();
    let mut seen: HashSet<String> = HashSet::with_capacity(paths.len());

    let transaction = conn.unchecked_transaction()?;

    for path in paths {
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };
        let path_string = path.to_string_lossy().to_string();
        let name = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| path_string.clone());
        let ext = extension(&path);
        // The containing folder name matters for classification: a file inside
        // a "Screenshots" directory is a capture even when it is named IMG_1.
        let parent_name = path
            .parent()
            .and_then(|parent| parent.file_name())
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| folder.name.clone());
        let kind = classify(&name, &ext, &parent_name);
        let bytes = metadata.len() as i64;
        let modified = metadata
            .modified()
            .map(db::timestamp)
            .unwrap_or_else(|_| db::now());
        let created = metadata
            .created()
            .map(db::timestamp)
            .unwrap_or_else(|_| modified.clone());
        // Size and modification time are enough to know a file changed, and
        // cost nothing compared with hashing every byte of every file.
        let fingerprint = format!("{:x}:{}", bytes, modified);

        summary.discovered += 1;

        if let Some((id, known_hash)) = known.get(&path_string) {
            seen.insert(id.clone());
            if known_hash == &fingerprint {
                summary.unchanged += 1;
                // Still mark it seen so the reconciliation pass leaves it alone.
                let _ = transaction.execute(
                    "UPDATE files SET seen_at = ?2, folder_id = ?3, folder_path = ?4 WHERE id = ?1",
                    rusqlite::params![id, db::now(), folder.id, folder.path],
                );
                continue;
            }
        }

        let supported = PROCESSABLE_EXTS.contains(&ext.as_str());
        if !supported {
            summary.unsupported += 1;
        }

        let id = known
            .get(&path_string)
            .map(|(id, _)| id.clone())
            .unwrap_or_else(|| format!("file-{}", db::uuid_like()));

        let row = ScanRow {
            id: id.clone(),
            path: path_string,
            name,
            ext,
            mime: mime_for(&extension(&path)),
            kind: kind.clone(),
            bytes,
            created_at: created,
            modified_at: modified,
            folder_id: folder.id.clone(),
            folder_path: folder.path.clone(),
            hash: fingerprint,
            supported,
        };

        db::upsert_scanned_file(&transaction, &row)?;
        summary.added += 1;

        if supported {
            summary.queued.push((id.clone(), row.path.clone(), kind));
        } else {
            db::set_index_state(&transaction, &id, db::STATE_UNSUPPORTED)?;
        }
    }

    let missing_names = db::mark_missing(&transaction, &folder.id, &seen)?;
    summary.missing = missing_names.len() as i64;

    for name in &missing_names {
        db::push_activity(
            &transaction,
            "deleted",
            "File is no longer on disk",
            Some(name),
            None,
        )?;
    }

    db::mark_folder_scanned(&transaction, &folder.id)?;
    transaction.commit()?;

    Ok(summary)
}

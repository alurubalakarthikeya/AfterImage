//! Organizing — writing the archive's own structure onto the disk.
//!
//! The archive is a view: a file's collection, its kind, the people in it are
//! rows in a database, and the folder it actually sits in is whatever folder the
//! user happened to save it to. That is the right default — nothing on disk moves
//! behind the user's back — but it means the disk never reflects the library, so
//! the same picture is in "Iceland 2019" here and `Downloads/IMG_4821.jpg` there.
//!
//! This module is the explicit, one-time answer: pick a destination, see exactly
//! what will go where, and let the app file the photographs the way it already
//! has them filed.
//!
//! Four rules, all of them about not losing anything:
//!
//!   * **Moving is a move.** Files are relocated on the user's disk, so the plan
//!     is shown before it is applied, the count and the bytes are stated, and a
//!     file that cannot be moved is reported with the reason rather than failed
//!     silently.
//!   * **A file has one home.** A photograph in three collections goes under the
//!     first one, alphabetically; copying it into three folders would triple the
//!     disk cost of the same pixels. The plan says which one it chose.
//!   * **Names are made safe, never clever.** Every segment is stripped of what
//!     the filesystem forbids, and nothing that could escape the destination
//!     survives. Existing files are never overwritten — a clash becomes `(2)`.
//!   * **The index follows the file.** The destination becomes a watched folder,
//!     so the archive keeps knowing about the files it just moved.
//!
//! What it does *not* do is touch a photograph's contents: no re-encode, no
//! rename beyond what is needed to be unique, no change to the file's mtime.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;

use crate::db;
use crate::error::{AppError, AppResult};

/// Where files the archive has not grouped go.
///
/// Named rather than empty: a folder called `Unfiled` is a fact, while a file
/// dropped directly beside its kind folder is an accident waiting to be sorted
/// again by hand.
pub const UNFILED: &str = "Unfiled";

/// The folder a kind lives in, matching the names the interface uses.
fn kind_folder(kind: &str) -> &'static str {
    match kind {
        "photo" => "Photos",
        "screenshot" => "Screenshots",
        "document" => "Documents",
        "video" => "Videos",
        "audio" => "Audio",
        "design" => "Design",
        "archive" => "Archives",
        _ => "Other",
    }
}

/// One planned move.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeMove {
    pub file_id: String,
    pub name: String,
    pub from: String,
    pub to: String,
    pub kind: String,
    /// The collection (or person) folder the file is being filed under.
    pub group: String,
    /// How many collections the file is in, so the interface can say that the
    /// plan picked one of several rather than pretending there was only one.
    pub collections: usize,
    pub bytes: i64,
}

/// A file the plan leaves alone, and why.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeSkip {
    pub file_id: String,
    pub name: String,
    pub from: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizePlan {
    pub root: String,
    pub moves: Vec<OrganizeMove>,
    pub skipped: Vec<OrganizeSkip>,
    /// Files already exactly where the plan would put them.
    pub settled: usize,
    /// Folders that will be created, relative to the destination.
    pub folders: Vec<String>,
    pub total_bytes: i64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeReport {
    pub moved: usize,
    pub skipped: Vec<OrganizeSkip>,
    pub failed: Vec<OrganizeSkip>,
    pub folders: Vec<String>,
    pub plan: OrganizePlan,
}

/// Characters no filesystem in the bundle accepts, plus the ones that would let
/// a folder name escape the destination. `/` and `\` are the important ones.
const FORBIDDEN: [char; 9] = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// Device names Windows reserves whatever the extension. A folder called `CON`
/// cannot be created there, and the failure would arrive a long way from here.
const RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Make one path segment safe, and readable.
///
/// Everything illegal is removed rather than replaced with an underscore: the
/// name a person typed is what they will look for, and `Iceland_2019` is nearer
/// to it than `Iceland__2019`. The result is never empty and never reserved, so
/// a caller can use it without checking anything.
pub fn safe_segment(raw: &str, fallback: &str) -> String {
    let scrubbed: String = raw
        .chars()
        .map(|character| {
            if FORBIDDEN.contains(&character) || character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect();

    // Dots are removed at every word boundary, not only at the two ends of the
    // string. `../../etc` scrubs to `.. .. etc`, and while that cannot escape
    // anything to a path that forbids no separators at all (the separators were
    // the first thing replaced), a folder called `.. .. etc` is a name that
    // looks like an attack and reads like a mistake. Dots *inside* a word are
    // kept: `IMG.v2 2019` is a filename somebody chose.
    let cleaned: String = scrubbed
        .split_whitespace()
        .map(|word| word.trim_matches('.'))
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    let mut cleaned = cleaned;
    if cleaned.chars().count() > 60 {
        cleaned = cleaned.chars().take(60).collect::<String>();
        cleaned = cleaned.trim_end().to_string();
    }

    if cleaned.is_empty() {
        return fallback.to_string();
    }

    let upper = cleaned.to_uppercase();
    let stem = upper.split('.').next().unwrap_or(&upper);
    if RESERVED.contains(&stem) {
        return format!("_{cleaned}");
    }

    cleaned
}

/// A filename that is not already taken in `directory`.
///
/// `IMG_4821.jpg` becomes `IMG_4821 (2).jpg` beside an existing copy. Nothing is
/// ever overwritten: the destination is the user's own folder and the archive
/// has no business deciding which of two pictures called `IMG_0001.jpg` survives.
///
/// `claimed` carries the targets planned earlier in the same run. Two rows can
/// want the same name in the same folder — the same photograph indexed from a
/// folder that has since been deleted, or a copy under a different id — and at
/// planning time neither file is on disk yet, so the filesystem alone cannot
/// tell them apart.
fn unique_name(directory: &Path, name: &str, claimed: &BTreeSet<PathBuf>) -> String {
    let free = |candidate: &str| {
        let path = directory.join(candidate);
        !path.exists() && !claimed.contains(&path)
    };

    if free(name) {
        return name.to_string();
    }

    let path = Path::new(name);
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| name.to_string());
    let extension = path
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();

    for suffix in 2..1000 {
        let candidate = format!("{stem} ({suffix}){extension}");
        if free(&candidate) {
            return candidate;
        }
    }

    // A thousand collisions in one folder is a pathological destination, and
    // returning the original name would silently overwrite something.
    format!("{stem}-{}{extension}", db::uuid_like())
}

/// Which group folder one file belongs in.
///
/// Collections win over people: a collection is something the user put the file
/// in on purpose, while a face is recognition, and recognition that turns out to
/// be wrong should not reorganize somebody's disk.
fn group_for(row: &db::OrganizeRow) -> (String, usize) {
    if let Some(name) = row.collections.first() {
        return (safe_segment(name, UNFILED), row.collections.len());
    }
    if row.people.len() == 1 {
        return (safe_segment(&row.people[0], UNFILED), 0);
    }
    (UNFILED.to_string(), 0)
}

/// Work out where every file would go, without touching anything.
///
/// The plan is the whole point of this feature: a move that cannot be undone has
/// to be visible before it happens, in the exact terms it will happen in.
pub fn plan(conn: &Connection, root: &Path) -> AppResult<OrganizePlan> {
    let rows = db::organize_rows(conn)?;
    let mut plan = OrganizePlan {
        root: root.to_string_lossy().to_string(),
        ..Default::default()
    };
    // Folder names are collected as they are planned, so the interface can list
    // what will be created even before anything is created.
    let mut folders: BTreeSet<String> = BTreeSet::new();
    let mut claimed: BTreeSet<PathBuf> = BTreeSet::new();

    for row in rows {
        let source = PathBuf::from(&row.path);
        let file_name = source
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| row.name.clone());

        if row.index_state == "missing" || !source.is_file() {
            plan.skipped.push(OrganizeSkip {
                file_id: row.id,
                name: file_name,
                from: row.path,
                reason: "not on disk where the index last saw it".to_string(),
            });
            continue;
        }

        let (group, collections) = group_for(&row);
        let kind = safe_segment(kind_folder(&row.kind), "Other");
        let directory = root.join(&kind).join(&group);
        let target = directory.join(&file_name);

        if target == source {
            plan.settled += 1;
            continue;
        }

        let name = unique_name(&directory, &file_name, &claimed);
        let target = directory.join(&name);
        claimed.insert(target.clone());

        folders.insert(format!("{kind}/{group}"));
        plan.total_bytes += row.bytes;
        plan.moves.push(OrganizeMove {
            file_id: row.id,
            name: file_name,
            from: row.path,
            to: target.to_string_lossy().to_string(),
            kind: row.kind,
            group,
            collections,
            bytes: row.bytes,
        });
    }

    plan.folders = folders.into_iter().collect();
    Ok(plan)
}

/// Move one file, falling back to copy-then-delete when it crosses a volume.
///
/// `std::fs::rename` fails with a link error across filesystems, which is the
/// normal case when the archive lives on `C:` and the user organizes onto an
/// external drive. The fallback copies the bytes and only then removes the
/// source, so an interrupted move leaves the original intact.
fn relocate(source: &Path, target: &Path) -> std::io::Result<()> {
    match std::fs::rename(source, target) {
        Ok(()) => Ok(()),
        Err(rename_error) => {
            std::fs::copy(source, target)?;
            std::fs::remove_file(source).map_err(|_| rename_error)
        }
    }
}

/// Apply a plan.
///
/// The plan is recomputed here rather than passed in, because the archive may
/// have changed since it was shown and a stale path is how a move lands in the
/// wrong place. Nothing outside the destination is created, and nothing that is
/// already there is replaced.
pub fn apply(conn: &Connection, root: &Path) -> AppResult<OrganizeReport> {
    let plan = plan(conn, root)?;

    if !root.is_dir() {
        std::fs::create_dir_all(root).map_err(|error| {
            AppError::Config(format!(
                "could not create {}: {error}",
                root.to_string_lossy()
            ))
        })?;
    }

    // Folders before files: a registered folder is what keeps the moved file in
    // the archive, and the index is only updated once the bytes are in place.
    for relative in &plan.folders {
        let directory = root.join(relative);
        if !directory.is_dir() {
            std::fs::create_dir_all(&directory).map_err(|error| {
                AppError::Config(format!(
                    "could not create {}: {error}",
                    directory.to_string_lossy()
                ))
            })?;
        }
        register_folder(conn, &directory)?;
    }
    register_folder(conn, root)?;

    let mut report = OrganizeReport {
        plan: plan.clone(),
        folders: plan.folders.clone(),
        ..Default::default()
    };

    for movement in &plan.moves {
        let source = PathBuf::from(&movement.from);
        let target = PathBuf::from(&movement.to);

        if !source.is_file() {
            report.skipped.push(OrganizeSkip {
                file_id: movement.file_id.clone(),
                name: movement.name.clone(),
                from: movement.from.clone(),
                reason: "moved or renamed while the plan was being applied".to_string(),
            });
            continue;
        }

        if let Some(parent) = target.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        if let Err(error) = relocate(&source, &target) {
            report.failed.push(OrganizeSkip {
                file_id: movement.file_id.clone(),
                name: movement.name.clone(),
                from: movement.from.clone(),
                reason: error.to_string(),
            });
            continue;
        }

        let (folder_id, folder_path) = match target.parent() {
            Some(parent) => {
                let path = parent.to_string_lossy().to_string();
                let id = register_folder(conn, parent)?;
                (id, path)
            }
            None => (String::new(), String::new()),
        };

        db::set_file_location(
            conn,
            &movement.file_id,
            &movement.name,
            &target.to_string_lossy(),
            &folder_id,
            &folder_path,
        )?;
        report.moved += 1;
    }

    Ok(report)
}

/// Make sure a folder the organizer wrote into is one the archive watches.
///
/// Returns its id. An existing row is left exactly as it is: the user may
/// already have granted this folder, with its own status and scan time, and the
/// organizer is not allowed to reset that.
fn register_folder(conn: &Connection, path: &Path) -> AppResult<String> {
    let path_string = path.to_string_lossy().to_string();
    if let Some(existing) = db::folder_by_path(conn, &path_string)? {
        return Ok(existing.id);
    }

    let id = format!("fld-{}", db::uuid_like());
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| path_string.clone());
    db::insert_folder(conn, &id, &path_string, &name)?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forbidden_characters_never_reach_a_path() {
        assert_eq!(safe_segment("Iceland 2019", "Unfiled"), "Iceland 2019");
        // A separator is the one thing that must not survive: a collection called
        // `../../etc` would otherwise write outside the destination.
        assert_eq!(safe_segment("../../etc", "Unfiled"), "etc");
        assert_eq!(safe_segment("a/b\\c:d*e?f", "Unfiled"), "a b c d e f");
        assert_eq!(safe_segment("Trip: 2024 <best>", "Unfiled"), "Trip 2024 best");
    }

    #[test]
    fn unusable_names_become_something_usable() {
        assert_eq!(safe_segment("", "Unfiled"), "Unfiled");
        assert_eq!(safe_segment("   ", "Unfiled"), "Unfiled");
        assert_eq!(safe_segment("...", "Unfiled"), "Unfiled");
        assert_eq!(safe_segment("CON", "Unfiled"), "_CON");
        // Reserved whatever the extension, which is why the stem is checked.
        assert_eq!(safe_segment("lpt1.txt", "Unfiled"), "_lpt1.txt");
    }

    #[test]
    fn long_names_are_cut_but_never_empty() {
        let long = "a".repeat(200);
        let cleaned = safe_segment(&long, "Unfiled");
        assert_eq!(cleaned.chars().count(), 60);
    }

    #[test]
    fn the_kind_folders_match_the_interface() {
        assert_eq!(kind_folder("photo"), "Photos");
        assert_eq!(kind_folder("screenshot"), "Screenshots");
        assert_eq!(kind_folder("document"), "Documents");
        // An unknown kind still gets a folder rather than a path of its own.
        assert_eq!(kind_folder("something-new"), "Other");
    }
}

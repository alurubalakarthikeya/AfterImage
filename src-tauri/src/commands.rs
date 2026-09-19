//! The command surface.
//!
//! Every command here is something the interface genuinely needs, and each one
//! reads or writes the local database rather than a copy held in the renderer.
//! Nothing in this file sends data anywhere: the only outbound request in the
//! whole application is to the indexing service on loopback.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};

use crate::db;
use crate::error::{AppError, AppResult};
use crate::index;
use crate::models::{
    ActivityEntry, ArchiveCollection, ArchiveSnapshot, ArchiveTotals, FilePage, FileQuery,
    FileRecord, Folder, IndexStatus, Project, SearchHit, SearchQuery, SearchResponse, StorageStats,
    Tag,
};
use crate::pipeline;
use crate::search::Retrieval;
use crate::service;
use crate::state::AppState;
use crate::thumbs;
use crate::watcher;

type SharedState<'a> = State<'a, Arc<AppState>>;

/// The shared state as an owned handle, for work that outlives the command.
fn shared(state: &SharedState<'_>) -> Arc<AppState> {
    state.inner().clone()
}

/// The capacity of the volume the archive lives on.
///
/// Reporting a made-up capacity would put a number on screen that means
/// nothing, so where the platform cannot be asked cheaply this returns zero and
/// the interface shows what is indexed instead of a fraction of the disk.
fn volume_capacity(_state: &AppState) -> i64 {
    0
}

fn folder_name(path: &Path) -> String {
    path.file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

fn status_of(state: &AppState) -> IndexStatus {
    let mut status = pipeline::status(state);
    if let Ok(conn) = state.db() {
        status.last_scan_at = db::last_scan_at(&conn).unwrap_or(None);
    }
    status
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn archive_snapshot(state: SharedState<'_>) -> AppResult<ArchiveSnapshot> {
    let conn = state.db()?;
    let (recent, _) = db::list_files(
        &conn,
        &FileQuery {
            limit: Some(60),
            ..FileQuery::default()
        },
    )?;

    Ok(ArchiveSnapshot {
        folders: db::list_folders(&conn)?,
        totals: db::totals(&conn)?,
        storage: db::storage_stats(&conn, volume_capacity(state.inner()))?,
        tags: db::list_tags(&conn)?,
        collections: db::list_collections(&conn)?,
        projects: db::list_projects(&conn)?,
        activity: db::list_activity(&conn, 30)?,
        recent,
        index: status_of(state.inner()),
    })
}

#[tauri::command]
pub fn list_files(state: SharedState<'_>, query: FileQuery) -> AppResult<FilePage> {
    let conn = state.db()?;
    let limit = query.limit.unwrap_or(120).clamp(1, 1000);
    let offset = query.offset.unwrap_or(0).max(0);
    let (files, total) = db::list_files(&conn, &query)?;
    Ok(FilePage {
        files,
        total,
        has_more: offset + limit < total,
    })
}

#[tauri::command]
pub fn files_by_ids(state: SharedState<'_>, ids: Vec<String>) -> AppResult<Vec<FileRecord>> {
    let conn = state.db()?;
    db::files_by_ids(&conn, &ids)
}

#[tauri::command]
pub fn file_detail(state: SharedState<'_>, file_id: String) -> AppResult<Option<FileRecord>> {
    let conn = state.db()?;
    db::file_by_id(&conn, &file_id)
}

#[tauri::command]
pub fn storage_stats(state: SharedState<'_>) -> AppResult<StorageStats> {
    let conn = state.db()?;
    db::storage_stats(&conn, volume_capacity(state.inner()))
}

#[tauri::command]
pub fn archive_totals(state: SharedState<'_>) -> AppResult<ArchiveTotals> {
    let conn = state.db()?;
    db::totals(&conn)
}

#[tauri::command]
pub fn index_status(state: SharedState<'_>) -> AppResult<IndexStatus> {
    Ok(status_of(state.inner()))
}

#[tauri::command]
pub fn list_tags(state: SharedState<'_>) -> AppResult<Vec<Tag>> {
    let conn = state.db()?;
    db::list_tags(&conn)
}

#[tauri::command]
pub fn list_collections(state: SharedState<'_>) -> AppResult<Vec<ArchiveCollection>> {
    let conn = state.db()?;
    db::list_collections(&conn)
}

#[tauri::command]
pub fn list_projects(state: SharedState<'_>) -> AppResult<Vec<Project>> {
    let conn = state.db()?;
    db::list_projects(&conn)
}

#[tauri::command]
pub fn list_activity(state: SharedState<'_>, limit: Option<i64>) -> AppResult<Vec<ActivityEntry>> {
    let conn = state.db()?;
    db::list_activity(&conn, limit.unwrap_or(30))
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn add_folder(
    app: AppHandle,
    state: SharedState<'_>,
    path: String,
) -> AppResult<Option<Folder>> {
    let root = PathBuf::from(shellexpand(&path));
    if !root.is_dir() {
        return Err(AppError::NotFound(format!(
            "{} is not a folder AfterImage can read",
            root.display()
        )));
    }

    let canonical = std::fs::canonicalize(&root).unwrap_or(root);
    let path_string = canonical.to_string_lossy().to_string();

    let folder = {
        let conn = state.db()?;
        if let Some(existing) = db::folder_by_path(&conn, &path_string)? {
            db::set_folder_watched(&conn, &existing.id, true)?;
            existing
        } else {
            let id = format!("fld-{}", db::uuid_like());
            let name = folder_name(&canonical);
            db::insert_folder(&conn, &id, &path_string, &name)?;
            db::push_activity(
                &conn,
                "folder-added",
                "Folder added to the archive",
                Some(&path_string),
                None,
            )?;
            db::folder_by_id(&conn, &id)?.ok_or_else(|| {
                AppError::Database("the folder could not be registered".into())
            })?
        }
    };

    restore_watchers(&app, state.inner())?;
    let _ = app.emit("archive://folders", ());
    let _ = app.emit("archive://changed", "folders");

    let state_handle = shared(&state);
    let app_handle = app.clone();
    let folder_handle = folder.clone();
    std::thread::spawn(move || {
        if let Err(error) = index::scan_folder(&app_handle, &state_handle, &folder_handle, "scan") {
            log::warn!("first scan of {} failed: {error}", folder_handle.path);
            let _ = app_handle.emit(
                "archive://notice",
                format!("warn|{} could not be scanned: {error}", folder_handle.name).as_str(),
            );
        }
    });

    Ok(Some(folder))
}

#[tauri::command]
pub fn remove_folder(app: AppHandle, state: SharedState<'_>, folder_id: String) -> AppResult<()> {
    {
        let conn = state.db()?;
        let folder = db::folder_by_id(&conn, &folder_id)?;
        db::delete_folder(&conn, &folder_id)?;
        if let Some(folder) = folder {
            db::push_activity(
                &conn,
                "folder-removed",
                "Folder removed from the archive",
                Some(&folder.path),
                None,
            )?;
        }
    }

    restore_watchers(&app, state.inner())?;
    let _ = app.emit("archive://folders", ());
    let _ = app.emit("archive://changed", "folders");
    Ok(())
}

#[tauri::command]
pub fn rescan_folder(app: AppHandle, state: SharedState<'_>, folder_id: String) -> AppResult<()> {
    let folder = {
        let conn = state.db()?;
        db::folder_by_id(&conn, &folder_id)?
    };
    let Some(folder) = folder else {
        return Err(AppError::NotFound("that folder is not in the archive".into()));
    };

    let state_handle = shared(&state);
    let app_handle = app.clone();
    std::thread::spawn(move || {
        if let Err(error) = index::rescan(&app_handle, &state_handle, &folder) {
            log::warn!("rescan of {} failed: {error}", folder.path);
        }
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// Pipeline control
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn pause_indexing(app: AppHandle, state: SharedState<'_>) -> AppResult<()> {
    state.paused.store(true, Ordering::SeqCst);
    pipeline::emit_status(&app, state.inner(), "paused");
    Ok(())
}

#[tauri::command]
pub fn resume_indexing(app: AppHandle, state: SharedState<'_>) -> AppResult<()> {
    state.paused.store(false, Ordering::SeqCst);
    pipeline::emit_status(&app, state.inner(), "indexing");
    Ok(())
}

/// Put failed files back in the queue so the pipeline can try again.
#[tauri::command]
pub fn clear_failures(app: AppHandle, state: SharedState<'_>) -> AppResult<()> {
    let jobs = {
        let conn = state.db()?;
        let mut statement = conn.prepare(
            "SELECT id, path, kind FROM files WHERE index_state = 'failed'",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(pipeline::Job {
                file_id: row.get(0)?,
                path: row.get(1)?,
                kind: row.get(2)?,
            })
        })?;
        let jobs: Vec<pipeline::Job> = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        conn.execute("UPDATE files SET index_state = 'pending' WHERE index_state = 'failed'", [])?;
        jobs
    };

    if jobs.is_empty() {
        return Ok(());
    }

    state.failed.store(0, Ordering::SeqCst);
    state.pending.fetch_add(jobs.len() as i64, Ordering::SeqCst);
    pipeline::enqueue(state.inner(), jobs);
    pipeline::emit_status(&app, state.inner(), "indexing");
    Ok(())
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/// Preferences that change how the pipeline behaves.
///
/// Stored in the archive's own database rather than in the webview, so the same
/// choices apply to the watcher and the pipeline, which never see the renderer.
#[tauri::command]
pub fn save_settings(state: SharedState<'_>, patch: serde_json::Value) -> AppResult<()> {
    {
        let conn = state.db()?;
        if let Some(value) = patch.get("semanticSearch").and_then(|value| value.as_bool()) {
            db::set_setting(&conn, "semantic_search", if value { "true" } else { "false" })?;
            state.semantic_enabled.store(value, Ordering::Relaxed);
        }
        if let Some(value) = patch.get("servicePort").and_then(|value| value.as_u64()) {
            db::set_setting(&conn, "service_port", &value.to_string())?;
            state.service_port.store(value as u16, Ordering::Relaxed);
        }
        if let Some(value) = patch.get("localProcessing").and_then(|value| value.as_bool()) {
            db::set_setting(&conn, "service_enabled", if value { "true" } else { "false" })?;
            state.service_enabled.store(value, Ordering::Relaxed);
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Indexing service health
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn service_health(state: SharedState<'_>) -> AppResult<serde_json::Value> {
    let port = state.service_port.load(Ordering::Relaxed);
    let enabled = state.service_enabled.load(Ordering::Relaxed);
    if !enabled {
        return Ok(serde_json::json!({
            "available": false,
            "reason": "local processing is turned off in settings",
        }));
    }
    match service::health(port) {
        Some(health) => Ok(serde_json::json!({
            "available": true,
            "port": port,
            "status": health.status,
            "models": health.models,
            "capabilities": health.capabilities,
        })),
        None => Ok(serde_json::json!({
            "available": false,
            "port": port,
            "reason": "the local indexing service is not running",
        })),
    }
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn search_archive(state: SharedState<'_>, query: SearchQuery) -> AppResult<SearchResponse> {
    let conn = state.db()?;
    let retrieval = Retrieval {
        conn: &conn,
        state: state.inner(),
    };
    retrieval.search(&query)
}

#[tauri::command]
pub fn similar_files(state: SharedState<'_>, file_id: String, limit: Option<i64>) -> AppResult<Vec<SearchHit>> {
    let conn = state.db()?;
    let retrieval = Retrieval {
        conn: &conn,
        state: state.inner(),
    };
    retrieval.similar(&file_id, limit.unwrap_or(12))
}

#[tauri::command]
pub fn related_files(state: SharedState<'_>, file_id: String, limit: Option<i64>) -> AppResult<Vec<SearchHit>> {
    let conn = state.db()?;
    let retrieval = Retrieval {
        conn: &conn,
        state: state.inner(),
    };
    retrieval.related(&file_id, limit.unwrap_or(3))
}

// ---------------------------------------------------------------------------
// Metadata mutations
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn set_favorite(state: SharedState<'_>, file_id: String, value: bool) -> AppResult<()> {
    {
        let conn = state.db()?;
        db::set_favorite(&conn, &file_id, value)?;
        if value {
            db::push_activity(
                &conn,
                "favorite",
                "File marked as a favourite",
                None,
                Some(&file_id),
            )?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn add_tag(state: SharedState<'_>, file_id: String, name: String) -> AppResult<Tag> {
    let conn = state.db()?;
    let tag = db::ensure_tag(&conn, &name)?;
    db::attach_tag(&conn, &file_id, &tag.id)?;
    db::push_activity(
        &conn,
        "tagged",
        &format!("File tagged with “{}”", tag.name),
        None,
        Some(&file_id),
    )?;
    db::list_tags(&conn)?
        .into_iter()
        .find(|item| item.id == tag.id)
        .ok_or_else(|| AppError::Database("the tag could not be created".into()))
}

#[tauri::command]
pub fn remove_tag(state: SharedState<'_>, file_id: String, tag_id: String) -> AppResult<()> {
    let conn = state.db()?;
    db::detach_tag(&conn, &file_id, &tag_id)
}

#[tauri::command]
pub fn create_collection(state: SharedState<'_>, name: String) -> AppResult<ArchiveCollection> {
    let palette = ["mint", "lavender", "peach", "blue"];
    let index = name.chars().count() % palette.len();
    let conn = state.db()?;
    let collection = db::create_collection(&conn, &name, palette[index], "Layers")?;
    db::push_activity(
        &conn,
        "collection",
        &format!("Collection “{}” created", collection.name),
        None,
        None,
    )?;
    Ok(collection)
}

#[tauri::command]
pub fn delete_collection(state: SharedState<'_>, collection_id: String) -> AppResult<()> {
    let conn = state.db()?;
    db::delete_collection(&conn, &collection_id)
}

#[tauri::command]
pub fn add_to_collection(state: SharedState<'_>, file_id: String, collection_id: String) -> AppResult<()> {
    let conn = state.db()?;
    db::attach_collection(&conn, &file_id, &collection_id)
}

#[tauri::command]
pub fn remove_from_collection(state: SharedState<'_>, file_id: String, collection_id: String) -> AppResult<()> {
    let conn = state.db()?;
    db::detach_collection(&conn, &file_id, &collection_id)
}

#[tauri::command]
pub fn create_project(state: SharedState<'_>, name: String) -> AppResult<Project> {
    let palette = ["#2F7773", "#7A6CC4", "#C08A64", "#5A7FC4", "#B4657C"];
    let index = name.chars().count() % palette.len();
    let conn = state.db()?;
    let project = db::create_project(&conn, &name, palette[index])?;
    db::push_activity(
        &conn,
        "project",
        &format!("Project “{}” created", project.name),
        None,
        None,
    )?;
    Ok(project)
}

#[tauri::command]
pub fn delete_project(state: SharedState<'_>, project_id: String) -> AppResult<()> {
    let conn = state.db()?;
    db::delete_project(&conn, &project_id)
}

#[tauri::command]
pub fn set_file_project(state: SharedState<'_>, file_id: String, project_id: Option<String>) -> AppResult<()> {
    let conn = state.db()?;
    db::set_file_project(&conn, &file_id, project_id.as_deref())
}

// ---------------------------------------------------------------------------
// File actions
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn open_path(path: String) -> AppResult<()> {
    let target = PathBuf::from(shellexpand(&path));
    if !target.exists() {
        return Err(AppError::NotFound(format!("{} no longer exists", target.display())));
    }
    open_with_system(&target)
}

#[tauri::command]
pub fn reveal_path(path: String) -> AppResult<()> {
    let target = PathBuf::from(shellexpand(&path));
    if !target.exists() {
        return Err(AppError::NotFound(format!("{} no longer exists", target.display())));
    }
    reveal_in_system(&target)
}

#[tauri::command]
pub fn trash_files(state: SharedState<'_>, file_ids: Vec<String>) -> AppResult<()> {
    let mut removed = 0usize;
    for file_id in &file_ids {
        let path = {
            let conn = state.db()?;
            db::file_path(&conn, file_id)?
        };
        let Some(path) = path else { continue };

        if Path::new(&path).exists() {
            // Trash, never delete: this is the one destructive action in the
            // application and it must stay reversible.
            trash::delete(&path).map_err(|error| AppError::Other(format!("could not trash {path}: {error}")))?;
        }

        let conn = state.db()?;
        db::set_index_state(&conn, file_id, db::STATE_MISSING)?;
        thumbs::remove(&state.thumbnail_dir, file_id);
        db::push_activity(&conn, "deleted", "Moved to trash", Some(&path), None)?;
        removed += 1;
    }

    if removed > 0 {
        log::info!("moved {removed} files to the trash");
    }
    Ok(())
}

#[tauri::command]
pub fn rename_file(state: SharedState<'_>, file_id: String, name: String) -> AppResult<()> {
    let clean = name.trim();
    if clean.is_empty() {
        return Err(AppError::Config("a file needs a name".into()));
    }
    if clean.contains('/') || clean.contains('\\') {
        return Err(AppError::Config("a name cannot contain a path separator".into()));
    }

    let (path, current) = {
        let conn = state.db()?;
        let Some(path) = db::file_path(&conn, &file_id)? else {
            return Err(AppError::NotFound("that file is not in the archive".into()));
        };
        let current = Path::new(&path)
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default();
        (path, current)
    };

    let source = Path::new(&path);
    // Keep the extension the file already has unless the user typed one.
    let extension = source
        .extension()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    let has_extension = Path::new(clean).extension().is_some();
    let final_name = if has_extension || extension.is_empty() {
        clean.to_string()
    } else {
        format!("{clean}.{extension}")
    };

    let target = source.with_file_name(&final_name);
    if target.exists() && target != source {
        return Err(AppError::Config(format!("{final_name} already exists here")));
    }

    std::fs::rename(source, &target)?;

    let conn = state.db()?;
    db::set_file_name(&conn, &file_id, &final_name, &target.to_string_lossy())?;
    db::push_activity(
        &conn,
        "indexed",
        &format!("Renamed from {current} to {final_name}"),
        None,
        Some(&file_id),
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Startup helpers, used by lib.rs
// ---------------------------------------------------------------------------

/// Rebuild the watch list from the database.
pub fn restore_watchers(app: &AppHandle, state: &Arc<AppState>) -> AppResult<()> {
    let folders = {
        let conn = state.db().map_err(|error| AppError::Other(error.to_string()))?;
        db::list_folders(&conn)?
    };
    let watched: Vec<(String, String)> = folders
        .iter()
        .filter(|folder| folder.watched)
        .map(|folder| (folder.id.clone(), folder.path.clone()))
        .collect();

    if watched.is_empty() {
        watcher::stop(state);
        return Ok(());
    }
    watcher::replace(app, state, &watched)
}

/// Apply persisted preferences to the running process.
pub fn apply_settings(state: &Arc<AppState>) {
    let settings = state.db().ok().map(|conn| {
        (
            db::get_setting(&conn, "service_port").ok().flatten(),
            db::get_setting(&conn, "service_enabled").ok().flatten(),
            db::get_setting(&conn, "semantic_search").ok().flatten(),
        )
    });

    let Some((port, enabled, semantic)) = settings else {
        return;
    };
    if let Some(port) = port.and_then(|value| value.parse::<u16>().ok()) {
        state.service_port.store(port, Ordering::Relaxed);
    }
    if let Some(enabled) = enabled {
        state.service_enabled.store(enabled != "false", Ordering::Relaxed);
    }
    if let Some(semantic) = semantic {
        state.semantic_enabled.store(semantic == "true", Ordering::Relaxed);
    }
}

// ---------------------------------------------------------------------------
// Small platform helpers
// ---------------------------------------------------------------------------

/// Expand `~` and environment variables in a user-typed path.
fn shellexpand(input: &str) -> String {
    let trimmed = input.trim();
    if let Some(rest) = trimmed.strip_prefix('~') {
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            let home = home.to_string_lossy().to_string();
            let suffix = rest.trim_start_matches(['/', '\\']);
            return if suffix.is_empty() {
                home
            } else {
                format!("{home}/{suffix}")
            };
        }
    }
    trimmed.to_string()
}

fn open_with_system(target: &Path) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("cmd")
        .args(["/C", "start", ""])
        .arg(target)
        .spawn();

    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(target).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(target).spawn();

    result
        .map(|_| ())
        .map_err(|error| AppError::Other(format!("could not open {}: {error}", target.display())))
}

fn reveal_in_system(target: &Path) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer")
        .arg(format!("/select,{}", target.display()))
        .spawn();

    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").args(["-R"]).arg(target).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = open_with_system(
        target
            .parent()
            .unwrap_or(target),
    );

    result
        .map(|_| ())
        .map_err(|error| AppError::Other(format!("could not reveal {}: {error}", target.display())))
}

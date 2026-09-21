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
    ActivityEntry, ArchiveCollection, ArchiveSnapshot, ArchiveTotals, FileFace, FilePage, FileQuery,
    FileRecord, Folder, IndexStatus, ModelBundle, ModelStatus, PeopleSnapshot, Person, Project,
    SearchHit, SearchQuery, SearchResponse, StorageStats, Tag,
};
use crate::people;
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
// Diagnostics
// ---------------------------------------------------------------------------

/// A last-resort channel from the renderer.
///
/// A packaged webview has no console anyone can open, so a failure while the
/// interface is starting is otherwise invisible — a blank window and nothing
/// else. The boot guard calls this so that failure lands in the application log
/// where it can actually be read and acted on.
#[tauri::command]
pub fn frontend_probe(message: String) {
    log::warn!("frontend: {message}");
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn archive_snapshot(state: SharedState<'_>) -> AppResult<ArchiveSnapshot> {
    // The database lock is taken exactly once, for the reads, and released before
    // `status_of` is called — because `status_of` takes it again, and a
    // `std::sync::Mutex` is not reentrant. Holding it across that call does not
    // return an error or block for a while: it deadlocks this thread for good,
    // which is why the interface used to sit on its boot screen forever.
    let (folders, totals, storage, tags, collections, projects, activity, recent) = {
        let conn = state.db()?;
        let (recent, _) = db::list_files(
            &conn,
            &FileQuery {
                limit: Some(60),
                ..FileQuery::default()
            },
        )?;
        (
            db::list_folders(&conn)?,
            db::totals(&conn)?,
            db::storage_stats(&conn, volume_capacity(state.inner()))?,
            db::list_tags(&conn)?,
            db::list_collections(&conn)?,
            db::list_projects(&conn)?,
            db::list_activity(&conn, 30)?,
            recent,
        )
    };

    let snapshot = ArchiveSnapshot {
        folders,
        totals,
        storage,
        tags,
        collections,
        projects,
        activity,
        recent,
        index: status_of(state.inner()),
    };
    Ok(snapshot)
}

#[tauri::command]
pub async fn list_files(state: SharedState<'_>, query: FileQuery) -> AppResult<FilePage> {
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
pub async fn files_by_ids(state: SharedState<'_>, ids: Vec<String>) -> AppResult<Vec<FileRecord>> {
    let conn = state.db()?;
    db::files_by_ids(&conn, &ids)
}

#[tauri::command]
pub async fn file_detail(state: SharedState<'_>, file_id: String) -> AppResult<Option<FileRecord>> {
    let conn = state.db()?;
    db::file_by_id(&conn, &file_id)
}

/// The photograph the Home hero shows, taken from the user's own library.
///
/// `None` is a normal answer: with no suitable photograph indexed the interface
/// renders its own neutral wash rather than a bundled image standing in for the
/// user's archive.
#[tauri::command]
pub async fn hero_image(state: SharedState<'_>) -> AppResult<Option<FileRecord>> {
    let conn = state.db()?;
    db::hero_candidate(&conn)
}

/// The local account, so the greeting on Home belongs to whoever is using the
/// machine instead of a name compiled into the application.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OsIdentity {
    pub user_name: Option<String>,
    pub home_dir: Option<String>,
}

#[tauri::command]
pub fn os_identity() -> OsIdentity {
    let user_name = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let home_dir = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .filter(|value| !value.trim().is_empty());

    OsIdentity {
        user_name,
        home_dir,
    }
}

#[tauri::command]
pub async fn storage_stats(state: SharedState<'_>) -> AppResult<StorageStats> {
    let conn = state.db()?;
    db::storage_stats(&conn, volume_capacity(state.inner()))
}

#[tauri::command]
pub async fn archive_totals(state: SharedState<'_>) -> AppResult<ArchiveTotals> {
    let conn = state.db()?;
    db::totals(&conn)
}

#[tauri::command]
pub async fn index_status(state: SharedState<'_>) -> AppResult<IndexStatus> {
    Ok(status_of(state.inner()))
}

#[tauri::command]
pub async fn list_tags(state: SharedState<'_>) -> AppResult<Vec<Tag>> {
    let conn = state.db()?;
    db::list_tags(&conn)
}

#[tauri::command]
pub async fn list_collections(state: SharedState<'_>) -> AppResult<Vec<ArchiveCollection>> {
    let conn = state.db()?;
    db::list_collections(&conn)
}

#[tauri::command]
pub async fn list_projects(state: SharedState<'_>) -> AppResult<Vec<Project>> {
    let conn = state.db()?;
    db::list_projects(&conn)
}

#[tauri::command]
pub async fn list_activity(state: SharedState<'_>, limit: Option<i64>) -> AppResult<Vec<ActivityEntry>> {
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
                faces_only: false,
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
        if let Some(value) = patch.get("llmEnabled").and_then(|value| value.as_bool()) {
            db::set_setting(&conn, "llm_enabled", if value { "true" } else { "false" })?;
            state.llm_enabled.store(value, Ordering::Relaxed);
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Indexing service health
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn service_health(state: SharedState<'_>) -> AppResult<serde_json::Value> {
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
pub async fn search_archive(state: SharedState<'_>, query: SearchQuery) -> AppResult<SearchResponse> {
    let conn = state.db()?;
    let retrieval = Retrieval {
        conn: &conn,
        state: state.inner(),
    };
    retrieval.search(&query)
}

#[tauri::command]
pub async fn similar_files(state: SharedState<'_>, file_id: String, limit: Option<i64>) -> AppResult<Vec<SearchHit>> {
    let conn = state.db()?;
    let retrieval = Retrieval {
        conn: &conn,
        state: state.inner(),
    };
    retrieval.similar(&file_id, limit.unwrap_or(12))
}

#[tauri::command]
pub async fn related_files(state: SharedState<'_>, file_id: String, limit: Option<i64>) -> AppResult<Vec<SearchHit>> {
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
    let palette = ["#0969da", "#8250df", "#1a7f37", "#bf8700", "#cf222e"];
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

/// Hand a file to the operating system's "open with" chooser.
///
/// Windows exposes the picker through `shell32.dll,OpenAs_RunDLL`; elsewhere the
/// system default handler is the closest equivalent, so that is what is used
/// rather than pretending a chooser exists.
#[tauri::command]
pub fn open_with(path: String) -> AppResult<()> {
    let target = PathBuf::from(shellexpand(&path));
    if !target.exists() {
        return Err(AppError::NotFound(format!("{} no longer exists", target.display())));
    }

    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32.exe")
        .arg("shell32.dll,OpenAs_RunDLL")
        .arg(&target)
        .spawn();

    #[cfg(not(target_os = "windows"))]
    let result = open_with_system(&target).map(|_| ());

    result.map_err(|error| {
        AppError::Other(format!("could not open {} with another app: {error}", target.display()))
    })?;
    Ok(())
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
            db::get_setting(&conn, "llm_enabled").ok().flatten(),
        )
    });

    let Some((port, enabled, semantic, llm)) = settings else {
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
    if let Some(llm) = llm {
        state.llm_enabled.store(llm == "true", Ordering::Relaxed);
    }
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/// Why face grouping cannot happen right now, or `None` when it can.
///
/// The two answers are deliberately distinct: a service that is not running is
/// a different problem from a service that is running without its models, and
/// only one of them can be fixed by downloading something.
fn faces_problem(state: &AppState) -> Option<String> {
    if !state.service_enabled.load(Ordering::Relaxed) {
        return Some("local processing is turned off in settings".into());
    }
    let port = state.service_port.load(Ordering::Relaxed);
    match service::health(port) {
        Some(health) => {
            let ready = health
                .capabilities
                .get("faces")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            if ready {
                None
            } else {
                Some("the face models are not installed yet".into())
            }
        }
        None => Some("the local indexing service is not running".into()),
    }
}

/// Every group of faces, with the numbers behind them.
#[tauri::command]
pub async fn people_snapshot(state: SharedState<'_>) -> AppResult<PeopleSnapshot> {
    let (groups, stats) = {
        let conn = state.db()?;
        // Both reads happen under the one lock, and neither calls back into
        // `state.db()` — the same self-deadlock the snapshot command once had.
        (people::list_people(&conn)?, people::stats(&conn)?)
    };
    let problem = faces_problem(state.inner());
    Ok(PeopleSnapshot {
        people: groups,
        stats,
        available: problem.is_none(),
        reason: problem,
    })
}

#[tauri::command]
pub async fn person(state: SharedState<'_>, person_id: String) -> AppResult<Option<Person>> {
    let conn = state.db()?;
    people::person_by_id(&conn, &person_id)
}

/// Every face in one file, for the inspector.
#[tauri::command]
pub async fn file_faces(state: SharedState<'_>, file_id: String) -> AppResult<Vec<FileFace>> {
    let conn = state.db()?;
    people::faces_for_file(&conn, &file_id)
}

#[tauri::command]
pub fn rename_person(
    state: SharedState<'_>,
    person_id: String,
    label: Option<String>,
) -> AppResult<()> {
    let conn = state.db()?;
    people::rename(&conn, &person_id, label.as_deref())
}

/// Fold one group into another — the correction for a wrong merge.
#[tauri::command]
pub fn merge_people(state: SharedState<'_>, from_id: String, into_id: String) -> AppResult<()> {
    let conn = state.db()?;
    people::merge(&conn, &from_id, &into_id)
}

#[tauri::command]
pub fn set_person_hidden(
    state: SharedState<'_>,
    person_id: String,
    hidden: bool,
) -> AppResult<()> {
    let conn = state.db()?;
    people::set_hidden(&conn, &person_id, hidden)
}

/// Delete a group, for the faces that were never a person.
///
/// Answers with how many faces went with it. No photograph is touched — only
/// the index rows and the aligned crops written beside it.
#[tauri::command]
pub fn forget_person(
    app: AppHandle,
    state: SharedState<'_>,
    person_id: String,
) -> AppResult<i64> {
    let faces = {
        let conn = state.db()?;
        people::forget(&conn, &person_id)? as i64
    };
    let _ = app.emit("archive://changed", "metadata");
    Ok(faces)
}

/// Regroup the whole library with the current threshold.
#[tauri::command]
pub async fn regroup_people(app: AppHandle, state: SharedState<'_>) -> AppResult<i64> {
    let groups = {
        let conn = state.db()?;
        people::recluster(&conn)? as i64
    };
    let _ = app.emit("archive://changed", "metadata");
    Ok(groups)
}

fn enqueue_face_jobs(app: &AppHandle, state: &Arc<AppState>) -> AppResult<i64> {
    let jobs = {
        let conn = state.db()?;
        people::files_needing_faces(&conn, 20_000)?
            .into_iter()
            .map(|(file_id, path, kind)| pipeline::Job {
                file_id,
                path,
                kind,
                faces_only: true,
            })
            .collect::<Vec<_>>()
    };
    let count = jobs.len() as i64;
    pipeline::enqueue(state, jobs);
    pipeline::emit_status(app, state, "indexing");
    Ok(count)
}

/// Look for faces in everything already indexed.
///
/// Answers with the number of files queued. A file whose photograph holds nobody
/// is recorded as looked-at, so pressing this twice does not repeat the work.
#[tauri::command]
pub fn scan_faces(app: AppHandle, state: SharedState<'_>) -> AppResult<i64> {
    if let Some(reason) = faces_problem(state.inner()) {
        return Err(AppError::Other(reason));
    }
    enqueue_face_jobs(&app, state.inner())
}

/// What the model store holds, and what it would cost to complete it.
#[tauri::command]
pub async fn model_status(state: SharedState<'_>) -> AppResult<ModelStatus> {
    let enabled = state.service_enabled.load(Ordering::Relaxed);
    if !enabled {
        return Ok(ModelStatus {
            bundles: Vec::new(),
            available: false,
            missing_megabytes: 0.0,
            directory: None,
            reason: Some("local processing is turned off in settings".into()),
        });
    }

    let port = state.service_port.load(Ordering::Relaxed);
    let Some(value) = service::model_status(port) else {
        return Ok(ModelStatus {
            bundles: Vec::new(),
            available: false,
            missing_megabytes: 0.0,
            directory: None,
            reason: Some("the local indexing service is not running".into()),
        });
    };

    let bundles = value
        .get("bundles")
        .and_then(|value| value.as_array())
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    Some(ModelBundle {
                        name: entry.get("name")?.as_str()?.to_string(),
                        ready: entry.get("ready").and_then(|v| v.as_bool()).unwrap_or(false),
                        megabytes: entry.get("megabytes").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(ModelStatus {
        bundles,
        available: true,
        missing_megabytes: value
            .get("missingMegabytes")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0),
        directory: value
            .get("directory")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        reason: None,
    })
}

/// Fetch model bundles in the background.
///
/// Tens of megabytes over a connection nobody controls, so this returns as soon
/// as the work is handed to a thread. A command that blocks for a minute is a
/// window that says "Not Responding" for a minute, and the download is not worth
/// freezing the interface over.
#[tauri::command]
pub fn install_models(
    app: AppHandle,
    state: SharedState<'_>,
    bundles: Vec<String>,
) -> AppResult<()> {
    if bundles.is_empty() {
        return Err(AppError::Other("no model bundle was named".into()));
    }
    let port = state.service_port.load(Ordering::Relaxed);
    let handle = shared(&state);
    let app_handle = app.clone();

    std::thread::Builder::new()
        .name("afterimage-models".into())
        .spawn(move || {
            match service::ensure_models(port, &bundles) {
                Some(value) => {
                    let ok = value.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
                    if ok {
                        let _ = app_handle.emit(
                            "archive://notice",
                            "info|Models installed — looking for faces in what is already indexed",
                        );
                        // The point of installing them is to use them, so the
                        // scan starts on its own rather than waiting to be asked.
                        match enqueue_face_jobs(&app_handle, &handle) {
                            Ok(_) => {}
                            Err(error) => log::warn!("could not queue the face pass: {error}"),
                        }
                    } else {
                        let _ = app_handle.emit(
                            "archive://notice",
                            "warn|Some model files could not be downloaded. Check the connection and try again.",
                        );
                    }
                }
                None => {
                    let _ = app_handle.emit(
                        "archive://notice",
                        "error|The local indexing service did not answer, so nothing was downloaded.",
                    );
                }
            }
            // Settings listens for this rather than polling.
            let _ = app_handle.emit("archive://models", "done");
        })
        .map_err(|error| AppError::Other(format!("could not start the download: {error}")))?;

    Ok(())
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

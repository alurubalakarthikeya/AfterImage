//! The command surface.
//!
//! Every command here is something the interface genuinely needs, and each one
//! reads or writes the local database rather than a copy held in the renderer.
//! Nothing in this file sends data anywhere: the only outbound request in the
//! whole application is to the indexing service on loopback.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::db;
use crate::dna;
use crate::error::{AppError, AppResult};
use crate::organize::{self, OrganizePlan, OrganizeReport};
use crate::index;
use crate::models::{
    ActivityEntry, AnalysisStatus, ArchiveCollection, ArchiveSnapshot, ArchiveTotals, BuildInfo,
    FileFace, FilePage, FileQuery, FileRecord, FileVersion, Folder, ImageDna, IndexStatus, MediaPages,
    ModelBundle, ModelStatus, PeopleSnapshot, Person, Project, SearchHit, SearchQuery, SearchResponse,
    StorageStats, Tag,
};
use crate::people;
use crate::pipeline;
use crate::search::Retrieval;
use crate::service;
use crate::state::AppState;
use crate::supervisor::{self, Supervisor};
use crate::thumbs;
use crate::versions;
use crate::watcher;

type SharedState<'a> = State<'a, Arc<AppState>>;

/// How many pages of one document are rendered for the reader.
///
/// Enough for a report somebody will actually read through, and far short of
/// the point where opening a 400-page scan writes a directory of thousands of
/// JPEGs for pages nobody scrolled to.
const DOCUMENT_PAGE_LIMIT: i64 = 40;

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
        if let Some(value) = patch.get("llmModel").and_then(|value| value.as_str()) {
            db::set_setting(&conn, "llm_model", value)?;
            if let Ok(mut slot) = state.llm_model.lock() {
                *slot = value.to_string();
            }
        }
        // Whether a new file is enough to start indexing on its own. This used
        // to be wired to `localProcessing`, which turned the whole local
        // pipeline off — including the models — under the name of a switch
        // about background watching. They are separate promises and are kept
        // separate here.
        if let Some(value) = patch.get("autoIndex").and_then(|value| value.as_bool()) {
            db::set_setting(&conn, "auto_index", if value { "true" } else { "false" })?;
            state.auto_index.store(value, Ordering::Relaxed);
        }
        if let Some(value) = patch
            .get("indexOnBattery")
            .and_then(|value| value.as_bool())
        {
            db::set_setting(
                &conn,
                "index_on_battery",
                if value { "true" } else { "false" },
            )?;
            state.index_on_battery.store(value, Ordering::Relaxed);
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

/// Rename a collection without touching a single file.
///
/// A collection is a view over the index, so this changes a label and nothing
/// else — the files inside it keep their names, their paths and their tags.
#[tauri::command]
pub fn rename_collection(
    state: SharedState<'_>,
    collection_id: String,
    name: String,
) -> AppResult<()> {
    let conn = state.db()?;
    db::rename_collection(&conn, &collection_id, &name)
}

/// What this machine can say about one picture.
///
/// The row's own facts come from the scan; everything else is measured from the
/// pixels here, on this machine, with no model and no network. A file that has
/// never changed has no versions and no history — and says so by returning an
/// empty list rather than an error.
#[tauri::command]
pub async fn image_dna(state: SharedState<'_>, file_id: String) -> AppResult<ImageDna> {
    let (record, stamp) = {
        let conn = state.db()?;
        let record = db::file_by_id(&conn, &file_id)?
            .ok_or_else(|| AppError::NotFound("that file is not in the archive".to_string()))?;
        // The fingerprint an edit moves. Measuring again after one is the point.
        let stamp = format!(
            "{}:{}",
            record.modified_at,
            record.hash.clone().unwrap_or_default()
        );
        if let Ok(cache) = state.dna_cache.lock() {
            if let Some((cached, dna)) = cache.get(&file_id) {
                if *cached == stamp {
                    return Ok(dna.clone());
                }
            }
        }
        (record, stamp)
    };

    // Prefer the file itself. A format this machine cannot decode — or a video,
    // which has no still to decode at all — still has the frame the pipeline
    // already wrote, and measuring that is honest as long as the answer says
    // which picture it came from.
    let mut reason = None;
    let analysis = match dna::analyse(Path::new(&record.path)) {
        Ok(analysis) => Some(analysis),
        Err(error) => {
            let fallback = record
                .preview_path
                .as_deref()
                .and_then(|path| dna::analyse(Path::new(path)).ok());
            reason = Some(if fallback.is_some() {
                "Measured from the indexed frame, not the original file".to_string()
            } else {
                error
            });
            fallback
        }
    };

    let aspect = match (record.width, record.height) {
        (Some(width), Some(height)) if height > 0 => {
            Some((width as f64 / height as f64 * 100.0).round() / 100.0)
        }
        _ => None,
    };
    let orientation = match (record.width, record.height) {
        (Some(width), Some(height)) if width > 0 && height > 0 => Some(
            if width > height {
                "landscape"
            } else if height > width {
                "portrait"
            } else {
                "square"
            }
            .to_string(),
        ),
        _ => None,
    };

    let dna = ImageDna {
        file_id: record.id.clone(),
        width: record.width,
        height: record.height,
        aspect,
        orientation,
        format: if record.ext.is_empty() {
            record.mime.clone()
        } else {
            record
                .ext
                .trim_start_matches('.')
                .to_uppercase()
        },
        bytes: record.bytes,
        created_at: record.created_at.clone(),
        modified_at: record.modified_at.clone(),
        decoded: analysis.is_some(),
        reason,
        palette: analysis
            .as_ref()
            .map(|measured| measured.palette.clone())
            .unwrap_or_default(),
        brightness: analysis.as_ref().map(|measured| measured.brightness),
        contrast: analysis.as_ref().map(|measured| measured.contrast),
        sharpness: analysis.as_ref().map(|measured| measured.sharpness),
        saturation: analysis.as_ref().map(|measured| measured.saturation),
        temperature: analysis
            .as_ref()
            .map(|measured| measured.temperature().to_string()),
        temperature_shift: analysis
            .as_ref()
            .map(|measured| measured.temperature_shift),
        objects: record.labels.clone(),
    };

    if let Ok(mut cache) = state.dna_cache.lock() {
        cache.insert(file_id, (stamp, dna.clone()));
    }
    Ok(dna)
}

/// Every kept copy of one file, newest content first.
#[tauri::command]
pub async fn file_versions(state: SharedState<'_>, file_id: String) -> AppResult<Vec<FileVersion>> {
    let conn = state.db()?;
    let versions = db::list_versions(&conn, &file_id)?;
    let mut live = Vec::with_capacity(versions.len());
    for version in versions {
        // A copy removed from the app-data folder by hand is not a version the
        // interface should offer to open, and leaving its row behind would grow
        // the table for ever.
        if Path::new(&version.path).is_file() {
            live.push(version);
        } else {
            db::delete_version(&conn, &version.id)?;
        }
    }
    Ok(live)
}

/// Keep the current presentation of a file as a version.
#[tauri::command]
pub async fn capture_version(
    state: SharedState<'_>,
    file_id: String,
) -> AppResult<FileVersion> {
    let conn = state.db()?;
    let version = versions::capture(&conn, &state.thumbnail_dir, &file_id)?;
    let name = conn
        .query_row(
            "SELECT name FROM files WHERE id = ?1",
            rusqlite::params![file_id],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "a file".to_string());
    db::push_activity(
        &conn,
        "collection",
        "Kept a version for comparison",
        Some(name.as_str()),
        Some(file_id.as_str()),
    )?;
    Ok(version)
}

/// Forget one kept copy, on disk and in the index.
#[tauri::command]
pub async fn delete_version(state: SharedState<'_>, version_id: String) -> AppResult<()> {
    let conn = state.db()?;
    let version = db::version_by_id(&conn, &version_id)?
        .ok_or_else(|| AppError::NotFound("that version is no longer kept".to_string()))?;
    versions::discard(&version.path);
    db::delete_version(&conn, &version_id)
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
            db::get_setting(&conn, "llm_model").ok().flatten(),
            db::get_setting(&conn, "auto_index").ok().flatten(),
            db::get_setting(&conn, "index_on_battery").ok().flatten(),
        )
    });

    let Some((port, enabled, semantic, llm, llm_model, auto_index, on_battery)) = settings else {
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
    if let Some(model) = llm_model {
        if let Ok(mut slot) = state.llm_model.lock() {
            *slot = model;
        }
    }
    if let Some(auto) = auto_index {
        state.auto_index.store(auto != "false", Ordering::Relaxed);
    }
    if let Some(battery) = on_battery {
        state.index_on_battery.store(battery == "true", Ordering::Relaxed);
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

fn enqueue_analysis_jobs(app: &AppHandle, state: &Arc<AppState>) -> AppResult<i64> {
    let jobs = {
        let conn = state.db()?;
        db::files_needing_analysis(&conn, 20_000)?
            .into_iter()
            .map(|(file_id, path, kind)| pipeline::Job {
                file_id,
                path,
                kind,
                faces_only: false,
            })
            .collect::<Vec<_>>()
    };
    let count = jobs.len() as i64;
    pipeline::enqueue(state, jobs);
    pipeline::emit_status(app, state, "indexing");
    Ok(count)
}

/// Analyse everything already indexed: tags, descriptions, embeddings.
///
/// This is the answer to "I installed the models after importing 8,000 files".
/// Nothing is re-imported, nothing is re-read from scratch: the pass walks the
/// files the models have not seen, in age order, through the ordinary pipeline —
/// which means it is the same background queue with the same progress, the same
/// battery pause and the same effect on the window (none).
#[tauri::command]
pub fn analyze_library(app: AppHandle, state: SharedState<'_>) -> AppResult<i64> {
    let enabled = state.service_enabled.load(Ordering::Relaxed);
    if !enabled {
        return Err(AppError::Other(
            "turn on local processing in settings first — tags come from the local models".into(),
        ));
    }
    enqueue_analysis_jobs(&app, state.inner())
}

/// How much of the library the models have looked at, and how much is left.
#[tauri::command]
pub fn analysis_status(state: SharedState<'_>) -> AppResult<AnalysisStatus> {
    let conn = state.db()?;
    let (analysed, total) = db::analysis_progress(&conn)?;
    let tags = db::analysis_tag_names(&conn)?.len() as i64;
    Ok(AnalysisStatus {
        analysed,
        total,
        remaining: (total - analysed).max(0),
        tags,
    })
}

fn media_pages_problem(state: &AppState) -> Option<String> {
    if !state.service_enabled.load(Ordering::Relaxed) {
        return Some("local processing is turned off, so pages cannot be laid out".into());
    }
    let port = state.service_port.load(Ordering::Relaxed);
    if !service::is_up(port) {
        return Some("the local indexing service is not running".into());
    }
    None
}

/// The pages of a document, rendered for the reader in the interface.
///
/// Rendered rather than handed over as a PDF on purpose. What a webview does
/// with a local PDF depends on a viewer plugin being installed and willing, and
/// "usually works" is not a good enough answer for the one panel the user
/// opened to read something. These are JPEGs in the thumbnail directory — the
/// only place the webview is allowed to read — so they behave exactly like every
/// other picture in the archive.
///
/// The result is cached on disk, so opening the same document twice costs one
/// render.
pub fn pages_work(file_id: &str, state: &AppState) -> AppResult<(String, Vec<String>)> {
    let (path, kind) = {
        let conn = state.db()?;
        let path = db::file_path(&conn, file_id)?
            .ok_or_else(|| AppError::NotFound("that file is not in the archive".into()))?;
        let kind = conn
            .query_row(
                "SELECT kind FROM files WHERE id = ?1",
                rusqlite::params![file_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap_or_else(|_| "document".into());
        (path, kind)
    };
    let _ = kind;

    let directory = state.thumbnail_dir.join("pages").join(file_id);
    // Already rendered: the directory holds the pages from last time.
    let mut cached: Vec<String> = match std::fs::read_dir(&directory) {
        Ok(entries) => {
            let mut found: Vec<(u32, String)> = entries
                .filter_map(|entry| entry.ok())
                .filter_map(|entry| {
                    let path = entry.path();
                    let index = path.file_stem()?.to_string_lossy().parse::<u32>().ok()?;
                    Some((index, path.to_string_lossy().to_string()))
                })
                .collect();
            found.sort_by_key(|(index, _)| *index);
            found.into_iter().map(|(_, path)| path).collect()
        }
        Err(_) => Vec::new(),
    };

    if cached.is_empty() {
        let port = state.service_port.load(Ordering::Relaxed);
        let target = state.thumbnail_dir.join("pages").to_string_lossy().to_string();
        let rendered = service::render_pages(port, &path, file_id, &target, DOCUMENT_PAGE_LIMIT)
            .ok_or_else(|| {
                AppError::Other("this document's pages could not be laid out".into())
            })?;
        cached = rendered.paths;
    }

    Ok((path, cached))
}

/// The renditions of one document, for the reader.
#[tauri::command]
pub fn media_pages(state: SharedState<'_>, file_id: String) -> AppResult<MediaPages> {
    if let Some(reason) = media_pages_problem(state.inner()) {
        return Err(AppError::Other(reason));
    }
    let (_, paths) = pages_work(&file_id, state.inner())?;
    let total = {
        let conn = state.db()?;
        conn.query_row(
            "SELECT COALESCE(pages, 0) FROM files WHERE id = ?1",
            rusqlite::params![file_id],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
    };
    let total = if total > 0 { total } else { paths.len() as i64 };
    Ok(MediaPages { paths, total })
}

/// What the model store holds, and what it would cost to complete it.
///
/// The three ways this can come back empty are kept apart, because they need
/// three different things from the person reading it: turn a setting on, press
/// a button, or install something. Folding them into "unavailable" is how a
/// download button ends up looking broken when the truth is that no service was
/// running to download into.
#[tauri::command]
pub async fn model_status(app: AppHandle, state: SharedState<'_>) -> AppResult<ModelStatus> {
    let enabled = state.service_enabled.load(Ordering::Relaxed);
    let on_battery = state.on_battery.load(Ordering::Relaxed);
    let can_start = supervisor::can_start(&app);

    if !enabled {
        return Ok(ModelStatus {
            bundles: Vec::new(),
            available: false,
            missing_megabytes: 0.0,
            directory: None,
            reason: Some("local processing is turned off in settings".into()),
            can_start: false,
            on_battery,
        });
    }

    let port = state.service_port.load(Ordering::Relaxed);
    let Some(value) = service::model_status(port) else {
        return Ok(ModelStatus {
            bundles: Vec::new(),
            available: false,
            missing_megabytes: 0.0,
            directory: None,
            reason: Some(if can_start {
                "the local indexing service is not running yet".into()
            } else {
                "no local indexer is installed on this machine".into()
            }),
            can_start,
            on_battery,
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
        can_start,
        on_battery,
    })
}

/// Start the local indexer now, and say what happened.
///
/// It is normally started in the background at launch, but that can lose a race
/// against a slow machine — and a person looking at "not running" deserves a
/// button rather than a wait. Blocking work, so it runs off the main thread.
#[tauri::command]
pub async fn start_service(app: AppHandle, state: SharedState<'_>) -> AppResult<String> {
    let supervisor = app
        .try_state::<Arc<Supervisor>>()
        .map(|value| value.inner().clone())
        .ok_or_else(|| AppError::Other("the indexer supervisor is not running".into()))?;
    let handle = shared(&state);
    let app_handle = app.clone();

    let outcome = tauri::async_runtime::spawn_blocking(move || {
        supervisor::ensure(&app_handle, &handle, &supervisor)
    })
    .await
    .map_err(|error| AppError::Other(format!("could not start the indexer: {error}")))?;

    if outcome.started {
        Ok(outcome.detail)
    } else {
        Err(AppError::Other(outcome.detail))
    }
}

/// Let the webview read one original file, so it can play or render it.
///
/// The asset protocol is scoped to the thumbnail folder, and that scope is a
/// security boundary: everything inside it can be read by the interface, and
/// everything outside it cannot. Photographs do not need more — the pipeline
/// already produced a preview — but a video has to be streamed and a PDF has to
/// be laid out, and neither is something a 1600px JPEG can stand in for.
///
/// So access is granted one file at a time, for the file the user actually
/// opened, and only after checking that the path is a file this archive knows
/// about. A directory is never added: a single grant is revoked by the end of
/// the process and cannot be walked to reach anything else.
#[tauri::command]
pub fn grant_file_access(
    app: AppHandle,
    state: SharedState<'_>,
    file_id: String,
) -> AppResult<String> {
    let path = {
        let conn = state.db()?;
        db::file_path(&conn, &file_id)?
            .ok_or_else(|| AppError::NotFound("that file is not in the archive".into()))?
    };

    let target = Path::new(&path);
    if !target.is_file() {
        return Err(AppError::NotFound(
            "that file is no longer where the index last saw it".into(),
        ));
    }

    app.asset_protocol_scope()
        .allow_file(target)
        .map_err(|error| AppError::Other(format!("could not open that file: {error}")))?;

    Ok(path)
}

/// Where every indexed file would go if the archive filed the disk its own way.
///
/// Read-only. The renderer shows this before offering to apply it, because the
/// operation moves the user's own files and a plan they have not seen is not a
/// plan, it is a surprise.
#[tauri::command]
pub fn organize_plan(state: SharedState<'_>, destination: String) -> AppResult<OrganizePlan> {
    let root = PathBuf::from(shellexpand(&destination));
    if root.as_os_str().is_empty() {
        return Err(AppError::Config("choose a folder to organize into".into()));
    }
    if root.is_file() {
        return Err(AppError::Config(format!(
            "{} is a file, not a folder",
            root.display()
        )));
    }

    let conn = state.db()?;
    organize::plan(&conn, &root)
}

/// Move the files. The one command here that changes the user's disk.
///
/// The folder the files land in becomes a watched folder, so the archive keeps
/// knowing about what it just moved instead of losing track of it — and the
/// watcher is rebuilt before the call returns, so a file edited a second later
/// is still seen.
#[tauri::command]
pub fn organize_apply(
    app: AppHandle,
    state: SharedState<'_>,
    destination: String,
) -> AppResult<OrganizeReport> {
    let root = PathBuf::from(shellexpand(&destination));
    if root.as_os_str().is_empty() {
        return Err(AppError::Config("choose a folder to organize into".into()));
    }

    let report = {
        let conn = state.db()?;
        let report = organize::apply(&conn, &root)?;
        if report.moved > 0 {
            db::push_activity(
                &conn,
                "organized",
                &format!(
                    "Filed {} files into {} as {} folder{}",
                    report.moved,
                    root.display(),
                    report.folders.len(),
                    if report.folders.len() == 1 { "" } else { "s" }
                ),
                Some(&root.to_string_lossy()),
                None,
            )?;
        }
        report
    };

    restore_watchers(&app, state.inner())?;
    let _ = app.emit("archive://folders", ());
    let _ = app.emit("archive://changed", "files");
    log::info!(
        "organized {} files into {} ({} could not be moved)",
        report.moved,
        root.display(),
        report.failed.len()
    );
    Ok(report)
}

/// Which build this is, and where it keeps everything.
///
/// Two installers of the same application look identical on screen, so the only
/// honest way to answer "did my new build install?" is to have the running
/// binary describe itself. Every value here is read from the executable or the
/// filesystem at call time.
#[tauri::command]
pub fn build_info(app: AppHandle, state: SharedState<'_>) -> AppResult<BuildInfo> {
    let executable = std::env::current_exe().ok();
    let built_at = executable
        .as_ref()
        .and_then(|path| std::fs::metadata(path).ok())
        .and_then(|meta| meta.modified().ok())
        .map(db::timestamp);

    let bundled_indexer = app
        .path()
        .resource_dir()
        .map(|dir| {
            let name = if cfg!(windows) {
                "afterimage-indexer.exe"
            } else {
                "afterimage-indexer"
            };
            dir.join("indexer").join(name).exists()
        })
        .unwrap_or(false);

    let data_dir = state.app_data.to_string_lossy().to_string();
    Ok(BuildInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        built_at,
        executable: executable.map(|path| path.to_string_lossy().to_string()),
        data_dir,
        thumbnails_dir: state.thumbnail_dir.to_string_lossy().to_string(),
        database: state
            .app_data
            .join("afterimage.sqlite")
            .to_string_lossy()
            .to_string(),
        bundled_indexer,
        on_battery: state.on_battery.load(Ordering::Relaxed),
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
    let supervisor = app.try_state::<Arc<Supervisor>>().map(|value| value.inner().clone());
    // Installing the vision models is what turns visual search on, and a library
    // that was indexed before they existed has none of their tags. The analysis
    // pass runs on its own so the feature is live when the download finishes
    // rather than waiting for somebody to find a button.
    let analyse_after = bundles
        .iter()
        .any(|bundle| bundle == "vision" || bundle == "text");

    std::thread::Builder::new()
        .name("afterimage-models".into())
        .spawn(move || {
            // A download without a service to download into is the failure this
            // command is most likely to hit, and the one the interface used to
            // report as "the service did not answer". Start it and try properly:
            // waiting for a background launch that may already have given up is
            // not something the person who pressed the button can see.
            if !service::is_up(port) {
                if let Some(supervisor) = &supervisor {
                    let _ = app_handle.emit(
                        "archive://notice",
                        "info|Starting the local indexing service before downloading…",
                    );
                    let outcome = supervisor::ensure(&app_handle, &handle, supervisor);
                    log::info!("indexer (on demand, for models): {}", outcome.detail);
                    if !outcome.started && !service::is_up(port) {
                        let _ = app_handle.emit(
                            "archive://notice",
                            format!("error|{}", outcome.detail),
                        );
                        let _ = app_handle.emit("archive://models", "done");
                        return;
                    }
                }
            }

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
                        if analyse_after {
                            match enqueue_analysis_jobs(&app_handle, &handle) {
                                Ok(queued) if queued > 0 => log::info!(
                                    "analysis: {queued} files queued for tags and descriptions"
                                ),
                                Ok(_) => {}
                                Err(error) => log::warn!("could not queue the analysis pass: {error}"),
                            }
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

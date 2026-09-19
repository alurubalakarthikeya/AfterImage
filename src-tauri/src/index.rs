//! Scanning orchestration.
//!
//! One function both the commands and the watcher call, so a folder indexed at
//! first run and a folder re-scanned because a screenshot landed in it go
//! through exactly the same path.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, Emitter};

use crate::db;
use crate::error::{AppError, AppResult};
use crate::models::Folder;
use crate::pipeline::{self, Job};
use crate::scan::{self, ScanSummary};
use crate::state::AppState;

/// Scan a folder, record what changed, and queue anything new for processing.
pub fn scan_folder(
    app: &AppHandle,
    state: &Arc<AppState>,
    folder: &Folder,
    reason: &str,
) -> AppResult<ScanSummary> {
    state.scanning.store(true, Ordering::SeqCst);
    if let Ok(mut slot) = state.current_folder.lock() {
        *slot = Some(folder.path.clone());
    }
    pipeline::emit_status(app, state, "scanning");

    let result = {
        let conn = state.db().map_err(|error| AppError::Other(error.to_string()))?;
        scan::scan_folder(&conn, folder)
    };

    state.scanning.store(false, Ordering::SeqCst);

    let summary = match result {
        Ok(summary) => summary,
        Err(error) => {
            state.set_issue(Some(format!(
                "“{}” could not be read: {error}",
                folder.name
            )));
            pipeline::emit_status(app, state, "idle");
            return Err(error);
        }
    };
    state.set_issue(None);

    // Rows for files that are queued go straight to the pipeline, so the grid
    // fills in while the enrichment stages are still running.
    let jobs: Vec<Job> = summary
        .queued
        .iter()
        .map(|(file_id, path, kind)| Job {
            file_id: file_id.clone(),
            path: path.clone(),
            kind: kind.clone(),
        })
        .collect();

    if !jobs.is_empty() {
        state.begin_run(state.pending.load(Ordering::SeqCst) + jobs.len() as i64);
        pipeline::enqueue(state, jobs);
    }

    if summary.added > 0 {
        let label = if summary.added == 1 {
            "1 new file indexed".to_string()
        } else {
            format!("{} new files indexed", summary.added)
        };
        if let Ok(conn) = state.db() {
            let _ = db::push_activity(
                &conn,
                "indexed",
                &label,
                Some(&folder.path),
                None,
            );
        }
    }

    if summary.missing > 0 {
        if let Ok(conn) = state.db() {
            let _ = db::push_activity(
                &conn,
                "folder-missing",
                if summary.missing == 1 {
                    "1 file is no longer on disk".to_string()
                } else {
                    format!("{} files are no longer on disk", summary.missing)
                }
                .as_str(),
                Some(&folder.path),
                None,
            );
        }
    }

    let _ = app.emit("archive://changed", reason);
    pipeline::emit_status(app, state, "indexing");
    Ok(summary)
}

/// Re-queue rows that were left mid-flight or failed, then scan a folder.
pub fn rescan(app: &AppHandle, state: &Arc<AppState>, folder: &Folder) -> AppResult<ScanSummary> {
    if let Ok(conn) = state.db() {
        let _ = db::set_folder_status(&conn, &folder.id, "scanning", None);
    }
    scan_folder(app, state, folder, "scan")
}

/// Pick up work from a previous session: rows left in `processing` are put back
/// in the queue, because a crash must not silently drop files from the index.
pub fn recover_pending(app: &AppHandle, state: &Arc<AppState>) -> AppResult<()> {
    let jobs = {
        let conn = state.db().map_err(|error| AppError::Other(error.to_string()))?;
        let rows = retryable(&conn)?;
        rows
    };

    if jobs.is_empty() {
        return Ok(());
    }

    log::info!("resuming {} files that were still queued", jobs.len());
    state.begin_run(jobs.len() as i64);
    state.pending.store(jobs.len() as i64, Ordering::SeqCst);
    pipeline::enqueue(state, jobs);
    pipeline::emit_status(app, state, "indexing");
    Ok(())
}

/// Rows the pipeline still owes work for, reset to `pending`.
pub fn retryable(conn: &rusqlite::Connection) -> AppResult<Vec<Job>> {
    let mut statement = conn.prepare(
        "SELECT id, path, kind FROM files
         WHERE index_state IN ('pending', 'processing')
         ORDER BY created_at DESC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(Job {
            file_id: row.get(0)?,
            path: row.get(1)?,
            kind: row.get(2)?,
        })
    })?;
    let jobs: Vec<Job> = rows.collect::<rusqlite::Result<Vec<_>>>()?;

    conn.execute(
        "UPDATE files SET index_state = 'pending' WHERE index_state = 'processing'",
        [],
    )?;

    Ok(jobs)
}

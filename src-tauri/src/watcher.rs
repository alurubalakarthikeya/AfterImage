//! Filesystem watching.
//!
//! `notify` with a debouncer in front of it: editors and downloaders write in
//! bursts, and a save-heavy second would otherwise trigger a dozen scans.
//!
//! The reaction to an event is deliberately coarse — rescan the folder the path
//! belongs to. A rescan compares size and modification time per file, so it
//! costs one directory walk and reprocesses only what actually changed. That one
//! path handles new files, edits, renames (which appear as a deletion plus a
//! creation) and deletions uniformly, and it is far harder to get subtly wrong
//! than patching the index event by event.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult};
use tauri::{AppHandle, Emitter};

use crate::db;
use crate::error::AppResult;
use crate::index::scan_folder;
use crate::state::AppState;

/// Replace the watcher with one following exactly `folders`.
///
/// Dropping the previous debouncer is what stops the old watches; `notify`
/// releases its OS handles on drop.
pub fn replace(app: &AppHandle, state: &Arc<AppState>, folders: &[(String, String)]) -> AppResult<()> {
    if let Ok(mut guard) = state.watcher.lock() {
        *guard = None;
    }

    if let Ok(mut guard) = state.watched.lock() {
        *guard = folders.iter().map(|(_, path)| path.clone()).collect();
    }

    let existing: Vec<(String, String)> = folders
        .iter()
        .filter(|(_, path)| Path::new(path).is_dir())
        .cloned()
        .collect();

    if existing.is_empty() {
        return Ok(());
    }

    let app_handle = app.clone();
    let state_handle = Arc::clone(state);

    let mut debouncer = new_debouncer(
        Duration::from_millis(1200),
        move |result: DebounceEventResult| {
            let Ok(events) = result else { return };
            let changed: Vec<PathBuf> = events.into_iter().map(|event| event.path).collect();
            if changed.is_empty() {
                return;
            }
            schedule_scan(&app_handle, &state_handle, changed);
        },
    )?;

    for (_, path) in &existing {
        debouncer
            .watcher()
            .watch(Path::new(path), RecursiveMode::Recursive)?;
        log::info!("watching {path}");
    }

    if let Ok(mut guard) = state.watcher.lock() {
        *guard = Some(debouncer);
    }
    Ok(())
}

/// Scan the folders an event batch touched.
///
/// Runs on its own thread: the watcher callback must return immediately, and a
/// scan of a large folder takes seconds. `state.scanning` keeps two batches from
/// scanning the same folder at the same time — the next event will simply find
/// nothing left to do.
fn schedule_scan(app: &AppHandle, state: &Arc<AppState>, changed: Vec<PathBuf>) {
    let folders = match state.db() {
        Ok(conn) => db::list_folders(&conn).unwrap_or_default(),
        Err(_) => return,
    };
    if folders.is_empty() {
        return;
    }

    let mut affected: Vec<crate::models::Folder> = Vec::new();
    for folder in folders {
        let root = Path::new(&folder.path);
        if changed.iter().any(|path| path.starts_with(root)) {
            affected.push(folder);
        }
    }
    if affected.is_empty() {
        return;
    }

    // One scan at a time. A second batch arriving mid-scan is not lost: the
    // running scan reads the directory fresh, so it already sees those changes.
    if state.scanning.swap(true, Ordering::SeqCst) {
        let _ = app.emit(
            "archive://notice",
            "info|New files detected — the scan already running will pick them up.",
        );
        return;
    }

    let app_handle = app.clone();
    let state_handle = Arc::clone(state);

    let spawned = std::thread::Builder::new()
        .name("afterimage-watch-scan".into())
        .spawn(move || {
            let _ = app_handle.emit(
                "archive://notice",
                "info|New files detected in a watched folder — indexing now.",
            );
            for folder in affected {
                if state_handle.stopping.load(Ordering::SeqCst) {
                    break;
                }
                if let Err(error) = scan_folder(&app_handle, &state_handle, &folder, "watch") {
                    log::warn!("watched rescan of {} failed: {error}", folder.path);
                    let _ = app_handle.emit(
                        "archive://notice",
                        format!("warn|{} could not be read: {error}", folder.name).as_str(),
                    );
                }
            }
            // Defensive: `scan_folder` clears this too, but a panic in between
            // must not leave the archive stuck thinking a scan is running.
            state_handle.scanning.store(false, Ordering::SeqCst);
        });

    if spawned.is_err() {
        log::warn!("could not start the watcher scan thread");
        state.scanning.store(false, Ordering::SeqCst);
    }
}

/// Stop watching everything (used when the last folder is removed).
pub fn stop(state: &Arc<AppState>) {
    if let Ok(mut guard) = state.watcher.lock() {
        *guard = None;
    }
    if let Ok(mut guard) = state.watched.lock() {
        guard.clear();
    }
}

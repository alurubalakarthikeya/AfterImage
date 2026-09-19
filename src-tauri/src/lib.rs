//! AfterImage desktop shell.
//!
//! Responsibilities, in order of how much they matter:
//!
//!   1. Own the local archive — one SQLite file with FTS5, opened once.
//!   2. Watch the folders the user chose and index what appears in them.
//!   3. Run the processing pipeline off the UI thread.
//!   4. Expose all of that to the renderer through a small command surface.
//!
//! There is no server, no account and no telemetry. The only outbound request in
//! the whole application is to the indexing service on loopback, and only when
//! it is running.

mod commands;
mod db;
mod error;
mod index;
mod models;
mod pipeline;
mod scan;
mod search;
mod service;
mod state;
mod supervisor;
mod thumbs;
mod watcher;

use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::Manager;

use crate::state::AppState;
use crate::supervisor::Supervisor;

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data)?;
            std::fs::create_dir_all(app_data.join("thumbnails"))?;

            let database_path = app_data.join("afterimage.sqlite");
            log::info!("archive database: {}", database_path.display());

            let connection = db::open(&database_path)?;
            db::migrate(&connection)?;

            let state = Arc::new(AppState::new(connection, app_data));

            // The pipeline exists before the watcher, because the watcher may
            // want to queue something the moment it starts.
            let sender = pipeline::spawn(app.handle().clone(), Arc::clone(&state));
            if let Ok(mut guard) = state.jobs.lock() {
                *guard = Some(sender);
            }

            // Persisted preferences decide how this session behaves.
            commands::apply_settings(&state);
            commands::restore_watchers(app.handle(), &state)?;

            // The indexing service is started for the user, in the background so
            // a cold start never delays the window. A machine with no indexer
            // installed gets a sentence explaining what is off, not a failure.
            let supervisor = Arc::new(Supervisor::new());
            app.manage(Arc::clone(&supervisor));
            {
                let app_handle = app.handle().clone();
                let state_handle = Arc::clone(&state);
                let supervisor_handle = Arc::clone(&supervisor);
                std::thread::spawn(move || {
                    let outcome = supervisor::ensure(&app_handle, &state_handle, &supervisor_handle);
                    log::info!("indexer: {}", outcome.detail);
                    // Only report a missing indexer as a problem when the user
                    // has asked for what needs it. An archive without models is
                    // a supported way to run AfterImage, not a fault.
                    let wants_models = state_handle
                        .semantic_enabled
                        .load(std::sync::atomic::Ordering::Relaxed);
                    if !outcome.started && wants_models {
                        state_handle.set_issue(Some(outcome.detail));
                    } else {
                        state_handle.set_issue(None);
                    }
                    pipeline::emit_status(&app_handle, &state_handle, "idle");
                });
            }

            // A first run has nothing to watch: the interface asks for a folder.
            let folders = {
                let conn = state.db()?;
                db::list_folders(&conn)?
            };
            if folders.is_empty() {
                log::info!("no watched folders yet — waiting for the user to choose one");
            } else {
                // Pick up anything left queued by a previous session.
                if let Err(error) = index::recover_pending(app.handle(), &state) {
                    log::warn!("could not resume the queue from last session: {error}");
                }
            }

            app.manage(Arc::clone(&state));

            // Tell the renderer where the pipeline stands, once, at boot.
            let app_handle = app.handle().clone();
            let state_handle = Arc::clone(&state);
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(400));
                pipeline::emit_status(&app_handle, &state_handle, "idle");
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::archive_snapshot,
            commands::archive_totals,
            commands::list_files,
            commands::files_by_ids,
            commands::file_detail,
            commands::hero_image,
            commands::os_identity,
            commands::storage_stats,
            commands::index_status,
            commands::list_tags,
            commands::list_collections,
            commands::list_projects,
            commands::list_activity,
            commands::add_folder,
            commands::remove_folder,
            commands::rescan_folder,
            commands::pause_indexing,
            commands::resume_indexing,
            commands::clear_failures,
            commands::save_settings,
            commands::service_health,
            commands::search_archive,
            commands::similar_files,
            commands::related_files,
            commands::set_favorite,
            commands::add_tag,
            commands::remove_tag,
            commands::create_collection,
            commands::delete_collection,
            commands::add_to_collection,
            commands::remove_from_collection,
            commands::create_project,
            commands::delete_project,
            commands::set_file_project,
            commands::open_path,
            commands::open_with,
            commands::reveal_path,
            commands::trash_files,
            commands::rename_file,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Stop watching and let the worker wind down before the process
                // exits, so no OS handles or half-written rows are left behind.
                if let Some(state) = window.app_handle().try_state::<Arc<AppState>>() {
                    state.stopping.store(true, Ordering::SeqCst);
                    watcher::stop(&state);
                }
                // The service is this process's child: stopping it here is what
                // keeps a Python process from outliving the window.
                if let Some(supervisor) = window.app_handle().try_state::<Arc<Supervisor>>() {
                    supervisor.stop();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("AfterImage failed to start");
}

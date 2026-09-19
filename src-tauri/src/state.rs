//! Shared application state.
//!
//! One SQLite connection behind a mutex, one pipeline queue, one watcher. The
//! watcher and the pipeline hold their own handles to the pieces they need, so
//! the UI thread only ever locks for the duration of a query.
//!
//! Every number the interface reads about indexing lives here as an atomic,
//! written by the worker thread and read on demand — never estimated.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU16, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Mutex;
use std::time::Instant;

use notify::RecommendedWatcher;
use notify_debouncer_mini::Debouncer;
use rusqlite::Connection;

use crate::pipeline::Job;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub app_data: PathBuf,
    pub thumbnail_dir: PathBuf,

    /// Local Python indexer port (FastAPI on loopback only).
    pub service_port: AtomicU16,
    /// Whether the pipeline is allowed to call the service at all.
    pub service_enabled: AtomicBool,
    /// Whether embeddings should be produced and searched.
    pub semantic_enabled: AtomicBool,

    // Queue counters, mirrored into `IndexStatus` on every change.
    pub queue_total: AtomicI64,
    pub pending: AtomicI64,
    pub processing: AtomicI64,
    pub processed: AtomicI64,
    pub failed: AtomicI64,
    pub per_minute: AtomicI64,
    pub paused: AtomicBool,
    pub scanning: AtomicBool,
    pub stopping: AtomicBool,

    pub current_file: Mutex<Option<String>>,
    pub current_folder: Mutex<Option<String>>,
    /// Why the pipeline cannot do its job, when it cannot.
    pub issue: Mutex<Option<String>>,

    pub jobs: Mutex<Option<Sender<Job>>>,
    pub watcher: Mutex<Option<Debouncer<RecommendedWatcher>>>,
    pub watched: Mutex<Vec<String>>,
    /// When the current run of work began, for the throughput figure.
    pub started_at: Mutex<Instant>,
}

impl AppState {
    pub fn new(db: Connection, app_data: PathBuf) -> Self {
        let thumbnail_dir = app_data.join("thumbnails");
        Self {
            db: Mutex::new(db),
            app_data,
            thumbnail_dir,
            service_port: AtomicU16::new(8765),
            service_enabled: AtomicBool::new(true),
            semantic_enabled: AtomicBool::new(false),
            queue_total: AtomicI64::new(0),
            pending: AtomicI64::new(0),
            processing: AtomicI64::new(0),
            processed: AtomicI64::new(0),
            failed: AtomicI64::new(0),
            per_minute: AtomicI64::new(0),
            paused: AtomicBool::new(false),
            scanning: AtomicBool::new(false),
            stopping: AtomicBool::new(false),
            current_file: Mutex::new(None),
            current_folder: Mutex::new(None),
            issue: Mutex::new(None),
            jobs: Mutex::new(None),
            watcher: Mutex::new(None),
            watched: Mutex::new(Vec::new()),
            started_at: Mutex::new(Instant::now()),
        }
    }

    /// Seconds since the current run began, never zero.
    pub fn elapsed_secs(&self) -> f64 {
        self.started_at
            .lock()
            .map(|start| start.elapsed().as_secs_f64())
            .unwrap_or(0.0)
            .max(0.001)
    }

    pub fn send(&self, job: Job) {
        if let Ok(guard) = self.jobs.lock() {
            if let Some(sender) = guard.as_ref() {
                let _ = sender.send(job);
            }
        }
    }

    pub fn set_issue(&self, message: Option<String>) {
        if let Ok(mut slot) = self.issue.lock() {
            *slot = message;
        }
    }

    /// What the interface should say about the pipeline's health.
    ///
    /// Returning `Some` here is a promise that the text explains a real
    /// limitation, not a placeholder.
    pub fn problem(&self) -> Option<String> {
        self.issue.lock().ok().and_then(|slot| slot.clone())
    }

    /// Reset the queue counters for a fresh run of work.
    pub fn begin_run(&self, count: i64) {
        self.queue_total.store(count, Ordering::SeqCst);
        self.processed.store(0, Ordering::SeqCst);
        if count > 0 {
            if let Ok(mut start) = self.started_at.lock() {
                *start = Instant::now();
            }
        }
    }
}

//! The processing pipeline.
//!
//! ```text
//!     watcher ─▶ scan ─▶ SQLite row (pending)
//!                          │
//!                          ▼
//!         thumbnail ─▶ text ─▶ title ─▶ embedding ─▶ faces ─▶ row (indexed)
//! ```
//!
//! One worker thread, one file at a time, with progress pushed to the interface
//! as events. Rows exist from the moment a file is discovered, so the grid fills
//! in immediately and gets richer as stages complete — the user never waits on a
//! spinner per file.
//!
//! Every stage is allowed to fail on its own. No thumbnail is a placeholder; no
//! text extraction is a note that says so; no embedding leaves the file fully
//! searchable by name, text, tag and folder.

use std::sync::atomic::Ordering;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::context;
use crate::db::{self, STATE_FAILED, STATE_INDEXED};
use crate::error::{AppError, AppResult};
use crate::models::IndexStatus;
use crate::people;
use crate::power;
use crate::scan::kind_supports_text;
use crate::service::{self, FaceOutcome, TextOutcome};
use crate::state::AppState;
use crate::thumbs;
use crate::versions;

/// Long edge of the still rendered for a video or a document.
///
/// The presentation size, not the thumbnail size: both derivatives the
/// interface needs are cut from this one picture, so asking for the smaller of
/// the two would leave the hero permanently soft.
const STILL_MAX_EDGE: i64 = 1600;

#[derive(Debug, Clone)]
pub struct Job {
    pub file_id: String,
    pub path: String,
    pub kind: String,
    /// Run the face stage and nothing else.
    ///
    /// Installing the face models must not mean re-reading every photograph for
    /// text and embeddings that are already in the index. A face-only pass is
    /// how "look for faces in what you have already indexed" stays cheap.
    pub faces_only: bool,
}

/// Hand jobs to the worker. Dropping the sender ends the thread.
pub fn spawn(app: AppHandle, state: Arc<AppState>) -> Sender<Job> {
    let (sender, receiver) = mpsc::channel::<Job>();
    let worker_state = Arc::clone(&state);
    thread::Builder::new()
        .name("afterimage-pipeline".into())
        .spawn(move || worker(app, worker_state, receiver))
        .expect("failed to start the indexing pipeline thread");
    sender
}

/// Queue a batch, counting it so the interface can show real progress.
pub fn enqueue(state: &AppState, jobs: Vec<Job>) {
    if jobs.is_empty() {
        return;
    }
    let count = jobs.len() as i64;
    state
        .queue_total
        .fetch_add(count, Ordering::SeqCst);
    state.pending.fetch_add(count, Ordering::SeqCst);
    for job in jobs {
        state.send(job);
    }
}

/// What the interface is told while the queue waits for mains power.
///
/// Written as the issue text because that is already the honest place for
/// "why is nothing happening" — and it is cleared by value, so a resume never
/// wipes out a different explanation.
const ON_BATTERY_ISSUE: &str = "Indexing is paused while this machine is on battery power. \
                                 Plug in, or turn on \"keep indexing on battery\" in Settings.";

/// How often the power state is re-read while the queue is held.
const POWER_POLL: Duration = Duration::from_secs(20);

fn worker(app: AppHandle, state: Arc<AppState>, receiver: Receiver<Job>) {
    // The battery is asked about at most once per `POWER_POLL`, so a queue of
    // thousands of files costs a handful of system calls rather than thousands.
    let mut power_check: Option<(Instant, bool)> = None;

    loop {
        // Held before the job is taken, not after: leaving it in the channel
        // keeps the counts the interface shows true, and nothing is ever
        // half-processed because the machine was unplugged mid-run.
        if !state.index_on_battery.load(Ordering::Relaxed) {
            let on_battery = measured_on_battery(&mut power_check);
            state.on_battery.store(on_battery, Ordering::Relaxed);
            if on_battery && hold_for_power(&app, &state, &mut power_check) {
                return;
            }
        }

        let job = match receiver.recv() {
            Ok(job) => job,
            Err(_) => return,
        };

        // Pausing holds the queue where it is: the file is counted as pending
        // until the worker is allowed to pick it up again.
        wait_while_paused(&state);

        if state.stopping.load(Ordering::SeqCst) {
            return;
        }

        state.processing.fetch_add(1, Ordering::SeqCst);
        state.current_file.lock().map(|mut slot| {
            *slot = Some(job.path.clone());
        }).ok();
        emit_status(&app, &state, "indexing");

        let started = Instant::now();
        let outcome = process(&state, &job);

        state.processing.fetch_sub(1, Ordering::SeqCst);
        state.pending.fetch_sub(1, Ordering::SeqCst);
        state.processed.fetch_add(1, Ordering::SeqCst);

        let finished = state.processed.load(Ordering::SeqCst) as f64;
        let per_minute = (finished / state.elapsed_secs() * 60.0).round() as i64;
        state.per_minute.store(per_minute, Ordering::SeqCst);

        if let Err(error) = outcome {
            log::warn!("pipeline: {} could not be processed: {error}", job.path);
            state.failed.fetch_add(1, Ordering::SeqCst);
            if let Ok(conn) = state.db.lock() {
                let _ = db::set_index_state(&conn, &job.file_id, STATE_FAILED);
            }
        }

        log::debug!(
            "pipeline: {} in {:?}",
            job.path,
            started.elapsed()
        );

        let state_name = if state.pending.load(Ordering::SeqCst) > 0 {
            "indexing"
        } else {
            "idle"
        };
        emit_status(&app, &state, state_name);
        if state_name == "idle" {
            // The queue draining is when a regroup becomes worth doing, and when
            // the interface should stop showing a half-built set of people.
            let _ = app.emit("archive://changed", "index");
            // And it is when the vector index is written to disk. The service
            // debounces its own saves, so this is what makes the last few
            // vectors durable rather than "probably saved".
            let port = state.service_port.load(Ordering::Relaxed);
            if port > 0 {
                service::flush_index(port);
            }
        }
    }
}

fn wait_while_paused(state: &Arc<AppState>) {
    while state.paused.load(Ordering::SeqCst) && !state.stopping.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(120));
    }
}

/// The power state, cached for `POWER_POLL`.
fn measured_on_battery(cache: &mut Option<(Instant, bool)>) -> bool {
    if let Some((at, value)) = cache {
        if at.elapsed() < POWER_POLL {
            return *value;
        }
    }
    let value = power::on_battery();
    *cache = Some((Instant::now(), value));
    value
}

/// Block the queue until mains power is restored, the setting changes, or the
/// application is closing. Returns true only when it should stop for good.
fn hold_for_power(
    app: &AppHandle,
    state: &Arc<AppState>,
    cache: &mut Option<(Instant, bool)>,
) -> bool {
    // Say it once, in the words the status line will keep showing.
    state.set_issue(Some(ON_BATTERY_ISSUE.to_string()));
    log::info!("pipeline: holding the queue while on battery power");
    emit_status(app, state, "paused");

    while !state.stopping.load(Ordering::SeqCst) {
        if state.index_on_battery.load(Ordering::Relaxed) {
            break;
        }
        thread::sleep(POWER_POLL);
        if !measured_on_battery(cache) {
            break;
        }
    }

    let stopping = state.stopping.load(Ordering::SeqCst);
    state.on_battery.store(false, Ordering::Relaxed);
    state.clear_issue_if(ON_BATTERY_ISSUE);
    if !stopping {
        emit_status(app, state, "idle");
    }
    stopping
}

/// Run every stage for one file.
fn process(state: &Arc<AppState>, job: &Job) -> AppResult<()> {
    let port = state.service_port.load(Ordering::Relaxed);
    let service_enabled = state.service_enabled.load(Ordering::Relaxed);
    let semantic_enabled = state.semantic_enabled.load(Ordering::Relaxed);

    if job.faces_only {
        return faces_stage(state, job, port, service_enabled);
    }

    {
        let conn = state.db()?;
        db::set_index_state(&conn, &job.file_id, db::STATE_PROCESSING)?;
    }

    // ---- 1. Dimensions, stills and thumbnails ------------------------------
    let source = std::path::Path::new(&job.path);
    let mut dimensions = thumbs::dimensions(source);

    // A video and a document are not pictures, so the shell cannot decode them
    // and used to leave both as a grey rectangle in a grid of images. The
    // service can: OpenCV's wheels carry their own video decoder, and PyMuPDF
    // is already the PDF engine. It renders one high-resolution still into the
    // media folder and reports the file's real duration or page count from the
    // same decode.
    //
    // Nothing is attempted when local processing is off: the file simply has no
    // thumbnail, which is the same state it was in before this existed.
    let mut still: Option<String> = None;
    let mut duration: Option<f64> = None;
    let mut pages: Option<i64> = None;
    if service_enabled && matches!(job.kind.as_str(), "video" | "document") {
        let media = thumbs::media_dir(&state.thumbnail_dir);
        if std::fs::create_dir_all(&media).is_ok() {
            if let Some(rendered) = service::extract_still(
                port,
                &job.path,
                &job.kind,
                &job.file_id,
                &media.to_string_lossy(),
                STILL_MAX_EDGE,
            ) {
                if dimensions.is_none() && rendered.width > 0 && rendered.height > 0 {
                    dimensions = Some((rendered.width, rendered.height));
                }
                duration = rendered.duration_sec;
                pages = rendered.pages;
                log::debug!(
                    "pipeline: {} still rendered by {} at {}x{}",
                    job.path,
                    rendered.engine,
                    rendered.width,
                    rendered.height
                );
                still = Some(rendered.path);
            }
        }
    }

    // A file whose bytes moved since the last pass was edited in some other
    // application. Save the presentation copy that is about to be replaced
    // before the new one is written: it is the only record of what the picture
    // looked like before, and what the before/after view compares against.
    let previous = {
        let conn = state.db()?;
        versions::keep_previous_preview(&conn, &state.thumbnail_dir, &job.file_id)
    };

    // The thumbnail and the presentation copy. A file the shell can decode goes
    // through the decoder; one it cannot goes through the still the service just
    // rendered, so both paths end with the same pair of files on disk.
    //
    // The bigger derivative is what the Home hero shows. It is generated here,
    // once, from the user's own file, so the hero is always a real photograph
    // from this library — never a bundled or borrowed image.
    let (thumbnail, preview) = match still.as_deref() {
        Some(rendered) => match thumbs::derive_from(
            &state.thumbnail_dir,
            &job.file_id,
            std::path::Path::new(rendered),
        ) {
            Some((thumbnail, preview)) => (Some(thumbnail), Some(preview)),
            None => {
                log::debug!("pipeline: the still of {} could not be read back", job.path);
                (None, None)
            }
        },
        None => (
            thumbs::generate(&state.thumbnail_dir, &job.file_id, &job.path, &job.kind),
            thumbs::generate_preview(&state.thumbnail_dir, &job.file_id, &job.path, &job.kind),
        ),
    };

    // The earlier copy is only worth keeping if something replaced it. When the
    // format cannot be decoded again the existing presentation stays on screen,
    // and a version of it would be a duplicate of what is already there.
    match (previous, preview.is_some()) {
        (Some(previous), true) => {
            let conn = state.db()?;
            match previous.keep(&conn) {
                Ok(version) => log::debug!(
                    "kept the version of {} from {}",
                    job.path,
                    version.content_at
                ),
                Err(error) => log::warn!(
                    "could not keep an earlier version of {}: {error}",
                    job.path
                ),
            }
        }
        (Some(previous), false) => previous.discard(),
        (None, _) => {}
    }

    {
        let conn = state.db()?;
        if let Some((width, height)) = dimensions {
            db::set_probe(&conn, &job.file_id, Some(width), Some(height), pages, duration)?;
        } else if pages.is_some() || duration.is_some() {
            db::set_probe(&conn, &job.file_id, None, None, pages, duration)?;
        }
        if let Some(path) = thumbnail.as_deref() {
            db::set_thumbnail(&conn, &job.file_id, path)?;
        }
        if let Some(path) = preview.as_deref() {
            db::set_preview(&conn, &job.file_id, path)?;
        }
    }

    // ---- 2. Text -----------------------------------------------------------
    let mut text: Option<String> = None;
    if service_enabled && kind_supports_text(&job.kind) {
        match service::extract_text(port, &job.path, &job.kind, &job.file_id) {
            TextOutcome::Text(extracted) => {
                let conn = state.db()?;
                db::save_text(
                    &conn,
                    &job.file_id,
                    &extracted.text,
                    extracted.confidence,
                    &extracted.engine,
                )?;
                db::reindex_search_row(&conn, &job.file_id)?;
                text = Some(extracted.text);
            }
            // The extractor ran and found nothing readable. That is a result,
            // not a failure, and it is recorded as one.
            TextOutcome::Empty => {
                let conn = state.db()?;
                db::set_ocr_state(&conn, &job.file_id, "extracted")?;
            }
            TextOutcome::Unavailable { reason } => {
                log::debug!("no text for {}: {reason}", job.path);
                let conn = state.db()?;
                db::set_ocr_state(&conn, &job.file_id, "unavailable")?;
            }
        }
    } else {
        let conn = state.db()?;
        db::set_ocr_state(&conn, &job.file_id, "none")?;
    }

    // ---- 3. Understanding: title, labels, tags and context -----------------
    //
    // Only the local vision model writes a title or a visual label. When it is
    // not installed the call returns empty and nothing is invented to fill the
    // gap — the file keeps its filename, its text and its metadata.
    //
    // The tags and the context line are computed either way, from whatever
    // evidence exists: the model's labels when there are any, the file's own
    // extracted text, and its name. That is what makes the feature work on a
    // machine with no model installed and keep working, better, once one is.
    let analysable = matches!(
        job.kind.as_str(),
        "photo" | "screenshot" | "design" | "document" | "video"
    );
    if service_enabled && analysable {
        let described = service::describe(
            port,
            &job.path,
            &job.kind,
            &job.file_id,
            text.as_deref(),
            still.as_deref(),
        );
        let labels = described
            .as_ref()
            .map(|value| value.labels.clone())
            .unwrap_or_default();

        let name = source
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| job.path.clone());
        let tags = context::derive_tags(&job.kind, &name, &labels, text.as_deref());
        let inferred = context::infer(&job.kind, &name, &labels, text.as_deref());

        {
            let conn = state.db()?;
            db::save_generated(
                &conn,
                &job.file_id,
                described.as_ref().and_then(|value| value.title.as_deref()),
                described
                    .as_ref()
                    .and_then(|value| value.description.as_deref()),
                &labels,
                inferred.as_deref(),
                &tags,
            )?;
            // The row is marked analysed even when every field above is empty:
            // "looked at, nothing to say" is a result, and recording it is what
            // stops a backfill from re-reading the same files forever.
            db::set_analysis_state(&conn, &job.file_id, "analysed")?;
            db::reindex_search_row(&conn, &job.file_id)?;
        }
    }

    // ---- 4. Embeddings ----------------------------------------------------
    if semantic_enabled {
        let indexed = service_enabled
            && service::embed(
                port,
                &job.path,
                &job.kind,
                &job.file_id,
                text.as_deref(),
                still.as_deref(),
            );
        let conn = state.db()?;
        db::set_embedding_state(&conn, &job.file_id, if indexed { "indexed" } else { "unavailable" })?;
    }

    // ---- 5. Faces ---------------------------------------------------------
    faces_stage(state, job, port, service_enabled)?;

    // Whatever happened above, the row is now as complete as this machine can
    // make it. `ocr_state` and `thumb_path` carry the nuance — whether there is
    // text, whether there is a picture — so "indexed" here means the pipeline
    // has finished with the file, not that every stage succeeded.
    let conn = state.db()?;
    db::set_index_state(&conn, &job.file_id, STATE_INDEXED)?;
    Ok(())
}

/**
 * Find the faces in one photograph and file them under somebody.
 *
 * Grouping happens in this process rather than in the service, next to the rows
 * it writes: a face that is detected but never assigned would be invisible to
 * the user for good, because nothing else in the application revisits a file
 * once it is indexed.
 */
fn faces_stage(state: &Arc<AppState>, job: &Job, port: u16, service_enabled: bool) -> AppResult<()> {
    if !state.faces_enabled.load(Ordering::Relaxed) || !service_enabled {
        return Ok(());
    }
    if !matches!(job.kind.as_str(), "photo" | "screenshot" | "design") {
        return Ok(());
    }
    if !state.faces_dir.exists() {
        std::fs::create_dir_all(&state.faces_dir).ok();
    }

    let faces_dir = state.faces_dir.to_string_lossy().to_string();
    match service::detect_faces(port, &job.path, &job.kind, &job.file_id, &faces_dir) {
        FaceOutcome::Faces(found) => {
            let detected: Vec<people::DetectedFace> = found
                .into_iter()
                .map(|face| people::DetectedFace {
                    left: face.left,
                    top: face.top,
                    width: face.width,
                    height: face.height,
                    score: face.score,
                    quality: face.quality,
                    embedding: face.embedding,
                    crop_path: face.crop_path,
                })
                .collect();
            let conn = state.db()?;
            people::store_file_faces(&conn, &job.file_id, &detected)?;
            // "scanned" deliberately does not mean "found faces": a photograph
            // of a landscape has been looked at, and looking again would cost the
            // same for the same answer.
            db::set_faces_state(&conn, &job.file_id, "scanned")?;
        }
        FaceOutcome::Empty => {
            let conn = state.db()?;
            people::clear_file_faces(&conn, &job.file_id)?;
            db::set_faces_state(&conn, &job.file_id, "scanned")?;
        }
        // No model installed. The file keeps `faces_state = 'none'`, so it is
        // picked up the moment one is.
        FaceOutcome::Unavailable { reason } => {
            log::debug!("no faces for {}: {reason}", job.path);
        }
    }
    Ok(())
}

pub fn status(state: &AppState) -> IndexStatus {
    let pending = state.pending.load(Ordering::SeqCst).max(0);
    let processing = state.processing.load(Ordering::SeqCst).max(0);
    let failed = state.failed.load(Ordering::SeqCst).max(0);
    let total = state.queue_total.load(Ordering::SeqCst).max(0);
    let done = state.processed.load(Ordering::SeqCst).max(0);

    let paused = state.paused.load(Ordering::SeqCst);
    let scanning = state.scanning.load(Ordering::SeqCst);

    IndexStatus {
        state: if paused {
            "paused"
        } else if scanning {
            "scanning"
        } else if pending + processing > 0 {
            "indexing"
        } else {
            "idle"
        }
        .into(),
        pending,
        processing,
        done,
        failed,
        total,
        per_minute: state.per_minute.load(Ordering::SeqCst),
        current_file: state.current_file.lock().ok().and_then(|slot| slot.clone()),
        current_folder: state.current_folder.lock().ok().and_then(|slot| slot.clone()),
        last_scan_at: None,
        problem: state.problem(),
    }
}

pub fn emit_status(app: &AppHandle, state: &AppState, _hint: &str) {
    let _ = app.emit("archive://index", status(state));
}

impl AppState {
    /// Lock the database, turning a poisoned mutex into a normal error.
    pub fn db(&self) -> AppResult<std::sync::MutexGuard<'_, rusqlite::Connection>> {
        self.db
            .lock()
            .map_err(|_| AppError::Other("the archive database is unavailable".into()))
    }
}


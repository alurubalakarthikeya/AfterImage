//! Starting the local indexer.
//!
//! The desktop application must not require the user to keep a terminal open
//! running `python -m uvicorn`. This module finds the service and starts it, in
//! this order:
//!
//!   1. a service already answering on the configured port — something the user
//!      started themselves, or a leftover from a previous run;
//!   2. a packaged indexer beside the application binary, i.e. the PyInstaller
//!      build produced by `npm run service:build` (see `services/indexer`), which
//!      is what a shipped installer carries;
//!   3. the development virtual environment at `services/indexer/.venv`, so a
//!      checkout runs with models after `npm run service:install`.
//!
//! If none of those exist the archive still works — metadata, thumbnails,
//! full-text search — and the reason is reported in the index status rather than
//! silently swallowed. Nothing here downloads anything, and the service is only
//! ever bound to loopback.
//!
//! The child is owned by this process: when the window closes, the service is
//! stopped with it, so there is never an orphaned Python process holding the
//! port.
//!
//! Everything the child prints goes to `indexer.log` in the application's own
//! folder. Nothing reads that file back: it exists because a service that fails
//! to start is the one thing here a user cannot diagnose by looking at the
//! window, and an empty log is a far worse answer than a loud one.

use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::service;
use crate::state::AppState;

pub struct Supervisor {
    child: Mutex<Option<Child>>,
}

impl Supervisor {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }

    fn remember(&self, child: Child) {
        if let Ok(mut slot) = self.child.lock() {
            *slot = Some(child);
        }
    }

    /// Stop a service this process started. Something the user launched is left
    /// alone, because this application did not start it.
    ///
    /// `child.wait()` runs on a background thread so the main thread (which
    /// drives the webview event loop) is never blocked.  On Windows a
    /// `wait()` after `kill()` can hang indefinitely if the child does not
    /// exit — spawning it off keeps the UI responsive during shutdown.
    pub fn stop(&self) {
        let taken = self.child.lock().ok().and_then(|mut slot| slot.take());
        if let Some(mut child) = taken {
            let _ = child.kill();
            std::thread::spawn(move || {
                // Give the child up to 3 seconds to exit gracefully after
                // the kill signal.  If it still hasn't exited we move on:
                // the OS will reclaim resources when this process ends.
                let deadline = std::time::Instant::now()
                    + std::time::Duration::from_secs(3);
                loop {
                    match child.try_wait() {
                        Ok(Some(_)) => break,
                        Ok(None) => {
                            if std::time::Instant::now() >= deadline {
                                break;
                            }
                            std::thread::sleep(std::time::Duration::from_millis(80));
                        }
                        Err(_) => break,
                    }
                }
            });
        }
    }
}

/// What happened, so the interface can say something true about it.
pub struct StartOutcome {
    pub started: bool,
    pub detail: String,
}

/// How long to give a cold service before calling it a failure.
///
/// Importing torch, onnxruntime and the OCR engine is the expensive part of a
/// first start, and on a cold page cache it comfortably outlasts the twenty
/// seconds this used to allow — which reported a failure for a service that was
/// three seconds away from answering.
const READY_TIMEOUT: Duration = Duration::from_secs(90);

/// Where the child's output goes.
fn log_path(app_data: &Path) -> PathBuf {
    app_data.join("indexer.log")
}

/// True when an indexer is available to run at all, without starting one.
///
/// The interface uses this to tell "nothing is installed" from "nothing is
/// running yet": only the second one is worth offering a button for.
pub fn can_start(app: &AppHandle) -> bool {
    launch_commands(app, 0)
        .into_iter()
        .any(|(program, _)| program.exists())
}

/// Ensure a service is answering, starting one if it has to.
pub fn ensure(app: &AppHandle, state: &AppState, supervisor: &Supervisor) -> StartOutcome {
    let port = state.service_port.load(std::sync::atomic::Ordering::Relaxed);

    if service::is_up(port) {
        return StartOutcome {
            started: false,
            detail: "The indexing service was already running.".into(),
        };
    }

    let candidates = launch_commands(app, port);
    if candidates.is_empty() {
        return StartOutcome {
            started: false,
            detail: "No local indexer is installed. Files are still indexed, thumbnailed and \
                     full-text searchable; OCR, generated titles and similarity search stay off \
                     until `npm run service:build` or `npm run service:install` has been run."
                .into(),
        };
    }

    let log = log_path(&state.app_data);
    let mut last_error = String::new();
    for (program, args) in candidates {
        if !program.exists() {
            continue;
        }
        match spawn(&program, &args, &log) {
            Ok(mut child) => match wait_until_ready(port, READY_TIMEOUT, &mut child) {
                Readiness::Ready => {
                    supervisor.remember(child);
                    return StartOutcome {
                        started: true,
                        detail: format!("Local indexer started ({})", program.display()),
                    };
                }
                Readiness::Exited(code) => {
                    let how = match code {
                        Some(code) => format!("exit code {code}"),
                        None => "a signal".to_string(),
                    };
                    last_error = format!(
                        "{} stopped with {how} before it answered; its output is in {}",
                        program.display(),
                        log.display()
                    );
                }
                Readiness::TimedOut => {
                    // Still running and still importing, most likely. Keep it:
                    // `stop()` must be able to end it when the window closes.
                    supervisor.remember(child);
                    last_error = format!(
                        "{} did not answer on port {port} within {} seconds; its output is in {}",
                        program.display(),
                        READY_TIMEOUT.as_secs(),
                        log.display()
                    );
                }
            },
            Err(error) => {
                last_error = format!("could not start {}: {error}", program.display());
            }
        }
    }

    StartOutcome {
        started: false,
        detail: if last_error.is_empty() {
            "No local indexer is installed on this machine. Files are still indexed, thumbnailed \
             and searchable; OCR, labels and faces need the Python service."
                .into()
        } else {
            format!("{last_error}. Files are still indexed and searchable by name and text.")
        },
    }
}

/// The service, in the order it should be tried.
fn launch_commands(app: &AppHandle, port: u16) -> Vec<(PathBuf, Vec<String>)> {
    let mut commands: Vec<(PathBuf, Vec<String>)> = Vec::new();

    // 1. Packaged beside the app binary.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let name = if cfg!(windows) {
                "afterimage-indexer.exe"
            } else {
                "afterimage-indexer"
            };
            commands.push((dir.join(name), serve_args(port)));
        }
    }

    // 2. Packaged as a bundled resource.
    if let Ok(resources) = app.path().resource_dir() {
        let name = if cfg!(windows) {
            "afterimage-indexer.exe"
        } else {
            "afterimage-indexer"
        };
        commands.push((resources.join("indexer").join(name), serve_args(port)));
    }

    // 3. A checkout's own virtual environment, which is what a development
    //    machine has after `npm run service:install`.
    for venv in dev_venv_interpreters() {
        let mut args = vec![
            "-m".to_string(),
            "uvicorn".to_string(),
            "app.main:app".to_string(),
            "--host".to_string(),
            "127.0.0.1".to_string(),
            "--port".to_string(),
            port.to_string(),
            "--app-dir".to_string(),
            service_dir().to_string_lossy().to_string(),
        ];
        args.shrink_to_fit();
        commands.push((venv, args));
    }

    commands
}

fn serve_args(port: u16) -> Vec<String> {
    vec![
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        port.to_string(),
    ]
}

/// `services/indexer` relative to this crate, which is where the Python lives.
fn service_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|root| root.join("services").join("indexer"))
        .unwrap_or_else(|| PathBuf::from("services/indexer"))
}

fn dev_venv_interpreters() -> Vec<PathBuf> {
    let venv = service_dir().join(".venv");
    let candidates = if cfg!(windows) {
        vec![venv.join("Scripts").join("python.exe")]
    } else {
        vec![venv.join("bin").join("python3"), venv.join("bin").join("python")]
    };
    candidates
}

/// How a service launch ended.
enum Readiness {
    Ready,
    /// The process ended on its own — a missing module, a taken port, a bad
    /// interpreter. The exit code is the only thing the window can honestly say
    /// about it, and the log holds the rest.
    Exited(Option<i32>),
    TimedOut,
}

/// A handle the child can write to: appended, never truncated.
///
/// Two runs in one session are more useful than one, and a truncated log at the
/// moment of a crash would be the cruellest possible time to lose it. Opened
/// per stream because a `Stdio` cannot be cloned, and because interleaving both
/// streams into one file is exactly what is wanted when reading it back.
fn log_sink(log: &Path) -> Stdio {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(log)
        .map(Stdio::from)
        .unwrap_or_else(|_| Stdio::null())
}

fn spawn(program: &Path, args: &[String], log: &Path) -> std::io::Result<Child> {
    Command::new(program)
        .args(args)
        .current_dir(service_dir())
        .stdin(Stdio::null())
        .stdout(log_sink(log))
        .stderr(log_sink(log))
        .spawn()
}

/// Poll the port until it answers, the child dies, or time runs out.
///
/// Watching the child matters as much as watching the port: a service that
/// exits in the first second should be reported in the first second, not ninety
/// seconds later with the same sentence an import-in-progress would produce.
fn wait_until_ready(port: u16, timeout: Duration, child: &mut Child) -> Readiness {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if service::is_up(port) {
            return Readiness::Ready;
        }
        match child.try_wait() {
            Ok(Some(status)) => return Readiness::Exited(status.code()),
            Ok(None) => {}
            Err(_) => {}
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    Readiness::TimedOut
}

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
    pub fn stop(&self) {
        let taken = self.child.lock().ok().and_then(|mut slot| slot.take());
        if let Some(mut child) = taken {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// What happened, so the interface can say something true about it.
pub struct StartOutcome {
    pub started: bool,
    pub detail: String,
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

    let mut last_error = String::new();
    for (program, args) in candidates {
        if !program.exists() {
            continue;
        }
        match spawn(&program, &args) {
            Ok(child) => {
                supervisor.remember(child);
                if wait_until_ready(port, Duration::from_secs(20)) {
                    return StartOutcome {
                        started: true,
                        detail: format!("Local indexer started ({})", program.display()),
                    };
                }
                last_error = format!(
                    "{} started but did not answer on port {port} within 20 seconds",
                    program.display()
                );
            }
            Err(error) => {
                last_error = format!("could not start {}: {error}", program.display());
            }
        }
    }

    StartOutcome {
        started: false,
        detail: if last_error.is_empty() {
            "No local indexer was found on this machine.".into()
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

fn spawn(program: &Path, args: &[String]) -> std::io::Result<Child> {
    Command::new(program)
        .args(args)
        .current_dir(service_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
}

fn wait_until_ready(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if service::is_up(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    false
}

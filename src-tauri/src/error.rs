//! Errors that cross the IPC boundary.
//!
//! Commands return `Result<T, AppError>`; Tauri serialises the error into the
//! rejected promise, so the renderer receives a readable string rather than a
//! panic or a silent no-op.

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Database(String),

    #[error("{0}")]
    Io(String),

    #[error("{0}")]
    Serialisation(String),

    #[error("{0}")]
    Network(String),

    #[error("{0}")]
    NotFound(String),

    #[error("{0}")]
    Config(String),

    #[error("{0}")]
    Other(String),
}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        AppError::Database(error.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        AppError::Io(error.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        AppError::Serialisation(error.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(error: tauri::Error) -> Self {
        AppError::Other(error.to_string())
    }
}

impl From<image::ImageError> for AppError {
    fn from(error: image::ImageError) -> Self {
        AppError::Other(format!("image: {error}"))
    }
}

impl From<ureq::Error> for AppError {
    fn from(error: ureq::Error) -> Self {
        AppError::Network(error.to_string())
    }
}

impl From<notify::Error> for AppError {
    fn from(error: notify::Error) -> Self {
        AppError::Other(format!("watcher: {error}"))
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

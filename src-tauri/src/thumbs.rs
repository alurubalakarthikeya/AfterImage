//! Thumbnails.
//!
//! Written next to the index as JPEGs and served to the webview through Tauri's
//! asset protocol, which is scoped to that one directory. Nothing here decodes
//! more than one image at a time, and every failure is a missing thumbnail
//! rather than a broken file: when a format cannot be decoded, the grid draws a
//! placeholder and the record keeps its real metadata.
//!
//! Video frames come from `ffmpeg` when it happens to be installed. If it is
//! not, video files are still indexed — they simply have no frame.

use std::path::Path;
use std::process::Command;

use image::ImageFormat;

/// Longest edge of a stored thumbnail. 640 keeps a full screen of tiles sharp on
/// a Retina display without holding large decodes in memory.
const MAX_EDGE: u32 = 640;

pub fn dimensions(path: &Path) -> Option<(i64, i64)> {
    image::image_dimensions(path)
        .ok()
        .map(|(width, height)| (width as i64, height as i64))
}

fn ffmpeg_available() -> bool {
    static CHECKED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *CHECKED.get_or_init(|| {
        Command::new("ffmpeg")
            .arg("-version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    })
}

/// Generate a thumbnail for one file, returning the written path.
///
/// `kind` decides the strategy: decode for still images, grab a frame for video.
/// Anything else returns `None` and the interface shows a kind-coloured
/// placeholder instead of an invented picture.
pub fn generate(dir: &Path, file_id: &str, path: &str, kind: &str) -> Option<String> {
    let source = Path::new(path);
    if !source.is_file() {
        return None;
    }
    std::fs::create_dir_all(dir).ok()?;
    let target = dir.join(format!("{file_id}.jpg"));

    match kind {
        "photo" | "screenshot" | "design" => write_still(source, &target)?,
        "video" => write_video_frame(source, &target)?,
        _ => return None,
    }

    Some(target.to_string_lossy().to_string())
}

fn write_still(source: &Path, target: &Path) -> Option<()> {
    let decoded = image::open(source).ok()?;
    let small = decoded.thumbnail(MAX_EDGE, MAX_EDGE);
    small.save_with_format(target, ImageFormat::Jpeg).ok()?;
    Some(())
}

fn write_video_frame(source: &Path, target: &Path) -> Option<()> {
    if !ffmpeg_available() {
        return None;
    }
    let status = Command::new("ffmpeg")
        .args(["-y", "-loglevel", "error", "-ss", "1", "-i"])
        .arg(source)
        .args([
            "-frames:v",
            "1",
            "-vf",
            &format!("scale={MAX_EDGE}:-2"),
        ])
        .arg(target)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .ok()?;

    if status.success() && target.is_file() {
        Some(())
    } else {
        None
    }
}

/// Remove a thumbnail that is no longer needed (file deleted from the index).
pub fn remove(dir: &Path, file_id: &str) {
    let _ = std::fs::remove_file(dir.join(format!("{file_id}.jpg")));
}

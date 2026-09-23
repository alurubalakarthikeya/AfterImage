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

/// Longest edge of the derivative written for the hero panel. Big enough to
/// cover a 1440-wide window on a high-density display, small enough that the
/// original never has to be decoded at full size on screen.
const PREVIEW_MAX_EDGE: u32 = 1600;

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
        "photo" | "screenshot" | "design" => write_still(source, &target, MAX_EDGE)?,
        "video" => write_video_frame(source, &target, MAX_EDGE)?,
        _ => return None,
    }

    Some(target.to_string_lossy().to_string())
}

/// The same picture at presentation size, for the Home hero.
///
/// Written into a `previews/` subfolder of the thumbnail directory, which is the
/// only path the webview is allowed to read through the asset protocol.
pub fn generate_preview(dir: &Path, file_id: &str, path: &str, kind: &str) -> Option<String> {
    let source = Path::new(path);
    if !source.is_file() {
        return None;
    }
    let previews = dir.join("previews");
    std::fs::create_dir_all(&previews).ok()?;
    let target = previews.join(format!("{file_id}.jpg"));

    match kind {
        "photo" | "screenshot" | "design" => write_still(source, &target, PREVIEW_MAX_EDGE)?,
        "video" => write_video_frame(source, &target, PREVIEW_MAX_EDGE)?,
        _ => return None,
    }

    Some(target.to_string_lossy().to_string())
}

fn write_still(source: &Path, target: &Path, max_edge: u32) -> Option<()> {
    let decoded = image::open(source).ok()?;
    let small = decoded.thumbnail(max_edge, max_edge);
    small.save_with_format(target, ImageFormat::Jpeg).ok()?;
    Some(())
}

fn write_video_frame(source: &Path, target: &Path, max_edge: u32) -> Option<()> {
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
            &format!("scale={max_edge}:-2"),
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

/// Remove the derivatives of a file that is no longer in the index.
pub fn remove(dir: &Path, file_id: &str) {
    let _ = std::fs::remove_file(dir.join(format!("{file_id}.jpg")));
    let _ = std::fs::remove_file(dir.join("previews").join(format!("{file_id}.jpg")));
    // Kept versions are copies of this file's own pixels, so they go with it.
    crate::versions::remove(dir, file_id);
}

//! The local indexing service.
//!
//! OCR, generated titles and embeddings all live in a Python process on
//! loopback, because that is where the models are. This module is the only
//! place in the desktop shell that speaks to it, and every call is written to
//! treat "service not running" as an ordinary state rather than an error: the
//! archive stays fully usable — metadata, thumbnails and full-text search — with
//! no model installed at all.

use std::time::Duration;

use serde_json::json;

const SHORT: Duration = Duration::from_secs(5);
const LONG: Duration = Duration::from_secs(120);

/// What the service can currently do, straight from its `/health` route.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct Health {
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub capabilities: serde_json::Value,
}

/// A file's text, however it was obtained.
pub struct ExtractedText {
    pub text: String,
    pub confidence: f64,
    pub engine: String,
}

/// The three honest answers to "what text does this file contain?".
///
/// The distinction matters to the interface: `Unavailable` means no engine is
/// installed, `Empty` means an engine looked and found nothing. Neither is ever
/// replaced with invented text.
pub enum TextOutcome {
    Text(ExtractedText),
    Empty,
    Unavailable { reason: String },
}

/// A model-written title and description, or the model's absence.
pub struct Description {
    pub title: Option<String>,
    pub description: Option<String>,
    pub labels: Vec<String>,
}

fn base(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

pub fn health(port: u16) -> Option<Health> {
    let response = ureq::get(&format!("{}/health", base(port)))
        .timeout(SHORT)
        .call()
        .ok()?;
    response.into_json::<Health>().ok()
}

/// True when a service is answering at all.
pub fn is_up(port: u16) -> bool {
    health(port).is_some()
}

pub fn extract_text(port: u16, path: &str, kind: &str, file_id: &str) -> TextOutcome {
    let response = ureq::post(&format!("{}/index/ocr", base(port)))
        .timeout(LONG)
        .send_json(json!({ "path": path, "kind": kind, "fileId": file_id }));

    let value: serde_json::Value = match response {
        Ok(response) => match response.into_json() {
            Ok(value) => value,
            Err(error) => {
                return TextOutcome::Unavailable {
                    reason: format!("the extractor sent back something unexpected: {error}"),
                }
            }
        },
        Err(error) => {
            return TextOutcome::Unavailable {
                reason: format!("the local extractor is not answering: {error}"),
            }
        }
    };

    let engine = value
        .get("engine")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown")
        .to_string();
    let text = value
        .get("text")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let confidence = value
        .get("confidence")
        .and_then(|value| value.as_f64())
        .unwrap_or(0.0);

    if engine == "unavailable" {
        return TextOutcome::Unavailable {
            reason: "no extraction engine is installed for this format".into(),
        };
    }
    if text.trim().is_empty() {
        return TextOutcome::Empty;
    }
    TextOutcome::Text(ExtractedText {
        text,
        confidence,
        engine,
    })
}

/// Ask the service to describe an image.
///
/// The service answers with an empty title when no vision model is installed.
/// That is passed through untouched: the renderer falls back to filename, OCR
/// text and metadata, and never displays a title nobody generated.
pub fn describe(port: u16, path: &str, kind: &str, file_id: &str, text: Option<&str>) -> Option<Description> {
    let response = ureq::post(&format!("{}/index/describe", base(port)))
        .timeout(LONG)
        .send_json(json!({
            "path": path,
            "kind": kind,
            "fileId": file_id,
            "text": text,
        }))
        .ok()?;
    let value: serde_json::Value = response.into_json().ok()?;

    Some(Description {
        title: value
            .get("title")
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string),
        description: value
            .get("description")
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string),
        labels: value
            .get("labels")
            .and_then(|value| value.as_array())
            .map(|values| {
                values
                    .iter()
                    .filter_map(|value| value.as_str())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
    })
}

/// Embed one file. Returns false when the service declined or is absent.
pub fn embed(port: u16, path: &str, kind: &str, file_id: &str, text: Option<&str>) -> bool {
    let response = ureq::post(&format!("{}/index/embed", base(port)))
        .timeout(LONG)
        .send_json(json!({
            "path": path,
            "kind": kind,
            "fileId": file_id,
            "text": text,
        }))
        .ok();

    let Some(response) = response else { return false };
    let Ok(value) = response.into_json::<serde_json::Value>() else {
        return false;
    };
    value
        .get("indexed")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

/// Nearest neighbours for a text query, as (file id, score).
pub fn semantic_search(port: u16, query: &str, limit: i64, kind: Option<&str>) -> Option<Vec<(String, f64)>> {
    let response = ureq::post(&format!("{}/search/semantic", base(port)))
        .timeout(LONG)
        .send_json(json!({ "query": query, "k": limit, "kind": kind }))
        .ok()?;
    let value: serde_json::Value = response.into_json().ok()?;
    if !value
        .get("available")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        return None;
    }
    Some(
        value
            .get("hits")
            .and_then(|value| value.as_array())
            .map(|hits| {
                hits.iter()
                    .filter_map(|hit| {
                        Some((
                            hit.get("fileId")?.as_str()?.to_string(),
                            hit.get("score").and_then(|value| value.as_f64()).unwrap_or(0.0),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default(),
    )
}

/// Nearest neighbours of a file that is already embedded, as (file id, score).
pub fn similar(port: u16, file_id: &str, limit: i64) -> Option<Vec<(String, f64)>> {
    let response = ureq::post(&format!("{}/search/similar", base(port)))
        .timeout(LONG)
        .send_json(json!({ "fileId": file_id, "k": limit }))
        .ok()?;
    let value: serde_json::Value = response.into_json().ok()?;
    if !value
        .get("available")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        return None;
    }
    Some(
        value
            .get("hits")
            .and_then(|value| value.as_array())
            .map(|hits| {
                hits.iter()
                    .filter_map(|hit| {
                        Some((
                            hit.get("fileId")?.as_str()?.to_string(),
                            hit.get("score").and_then(|value| value.as_f64()).unwrap_or(0.0),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default(),
    )
}

// ---------------------------------------------------------------------------
// Faces
// ---------------------------------------------------------------------------

/// One face, as the indexer found it.
pub struct DetectedFace {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
    pub score: f64,
    pub quality: f64,
    pub embedding: Vec<f32>,
    pub crop_path: Option<String>,
}

/// The three honest answers to "who is in this photograph?".
///
/// `Empty` means the detector ran and found nobody — a result worth recording,
/// because it stops the file from being looked at again. `Unavailable` means no
/// model is installed, so nothing was decided and the file stays on the list for
/// whenever one is.
pub enum FaceOutcome {
    Faces(Vec<DetectedFace>),
    Empty,
    Unavailable { reason: String },
}

/// Detect and embed every face in one image.
pub fn detect_faces(
    port: u16,
    path: &str,
    kind: &str,
    file_id: &str,
    faces_dir: &str,
) -> FaceOutcome {
    let response = ureq::post(&format!("{}/index/faces", base(port)))
        .timeout(LONG)
        .send_json(json!({
            "path": path,
            "kind": kind,
            "fileId": file_id,
            "faces_dir": faces_dir,
        }));

    let value: serde_json::Value = match response {
        Ok(response) => match response.into_json() {
            Ok(value) => value,
            Err(error) => {
                return FaceOutcome::Unavailable {
                    reason: format!("the face detector sent back something unexpected: {error}"),
                }
            }
        },
        Err(error) => {
            return FaceOutcome::Unavailable {
                reason: format!("the local face detector is not answering: {error}"),
            }
        }
    };

    if !value
        .get("available")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        return FaceOutcome::Unavailable {
            reason: value
                .get("reason")
                .and_then(|value| value.as_str())
                .unwrap_or("the face models are not installed")
                .to_string(),
        };
    }

    let faces: Vec<DetectedFace> = value
        .get("faces")
        .and_then(|value| value.as_array())
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    let embedding = entry
                        .get("embedding")
                        .and_then(|value| value.as_array())?
                        .iter()
                        .filter_map(|value| value.as_f64())
                        .map(|value| value as f32)
                        .collect::<Vec<f32>>();
                    if embedding.is_empty() {
                        return None;
                    }
                    let box_value = entry.get("box")?;
                    let number = |key: &str| {
                        box_value.get(key).and_then(|value| value.as_f64()).unwrap_or(0.0)
                    };
                    Some(DetectedFace {
                        left: number("x"),
                        top: number("y"),
                        width: number("width"),
                        height: number("height"),
                        score: entry.get("score").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        quality: entry.get("quality").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        embedding,
                        crop_path: entry
                            .get("cropPath")
                            .and_then(|value| value.as_str())
                            .map(str::to_string),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    if faces.is_empty() {
        FaceOutcome::Empty
    } else {
        FaceOutcome::Faces(faces)
    }
}

/// Fetch the named model bundles. Slow on purpose — this is a download.
pub fn ensure_models(port: u16, bundles: &[String]) -> Option<serde_json::Value> {
    let response = ureq::post(&format!("{}/models/ensure", base(port)))
        .timeout(Duration::from_secs(900))
        .send_json(json!({ "bundles": bundles }))
        .ok()?;
    response.into_json::<serde_json::Value>().ok()
}

/// What is installed, straight from the service's own model store.
pub fn model_status(port: u16) -> Option<serde_json::Value> {
    let response = ureq::get(&format!("{}/models", base(port)))
        .timeout(SHORT)
        .call()
        .ok()?;
    response.into_json::<serde_json::Value>().ok()
}

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

/// A parsed interpretation from the optional local model.
pub struct ModelQuery {
    pub terms: Vec<String>,
    pub kind: Option<String>,
    pub since_days: Option<i64>,
    pub favorites_only: Option<bool>,
    pub interpreted: Option<String>,
}

pub fn parse_query(port: u16, text: &str) -> Option<ModelQuery> {
    let response = ureq::post(&format!("{}/query/parse", base(port)))
        .timeout(Duration::from_secs(20))
        .send_json(json!({ "text": text }))
        .ok()?;
    let value: serde_json::Value = response.into_json().ok()?;

    Some(ModelQuery {
        terms: value
            .get("terms")
            .and_then(|value| value.as_array())
            .map(|terms| {
                terms
                    .iter()
                    .filter_map(|term| term.as_str())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        kind: value.get("kind").and_then(|value| value.as_str()).map(str::to_string),
        since_days: value.get("sinceDays").and_then(|value| value.as_i64()),
        favorites_only: value.get("favoritesOnly").and_then(|value| value.as_bool()),
        interpreted: value
            .get("interpreted")
            .and_then(|value| value.as_str())
            .map(str::to_string),
    })
}

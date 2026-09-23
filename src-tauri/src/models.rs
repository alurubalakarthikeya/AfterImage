//! Wire types.
//!
//! These mirror `src/types/index.ts` field for field, and the Python service's
//! `schemas.py` closely enough that the same vocabulary survives all three
//! layers unchanged. `rename_all = "camelCase"` is what keeps the IPC boundary
//! invisible: the renderer receives exactly the shapes its own types describe.
//!
//! Every field is filled from a real row in the local database. Nothing here is
//! sampled, generated or defaulted to make a screen look complete.

use serde::{Deserialize, Serialize};

/// A file as the renderer sees it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRecord {
    pub id: String,
    /// The name on disk. AfterImage never rewrites this on its own.
    pub name: String,
    pub path: String,
    pub kind: String,
    pub ext: String,
    pub mime: String,
    pub bytes: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_sec: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pages: Option<i64>,
    pub folder_id: String,
    pub folder_path: String,
    pub created_at: String,
    pub modified_at: String,
    pub indexed_at: String,
    pub favorite: bool,
    pub tag_ids: Vec<String>,
    pub collection_ids: Vec<String>,
    pub project_id: Option<String>,
    /// Absolute path to the generated thumbnail, when one exists.
    pub thumb_path: Option<String>,
    /// Absolute path to the larger derivative written for the hero panel.
    /// Only image-like files have one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_path: Option<String>,
    /// Title derived from the file's own content by a local model. Metadata
    /// only: the file on disk keeps its original name.
    pub generated_title: Option<String>,
    pub description: Option<String>,
    pub labels: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ocr_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ocr_confidence: Option<f64>,
    pub ocr_state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ocr_engine: Option<String>,
    pub index_state: String,
    pub hash: Option<String>,
    pub embedding_state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub path: String,
    pub name: String,
    pub watched: bool,
    pub file_count: i64,
    pub size_bytes: i64,
    pub last_scan_at: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub count: i64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub pinned: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionRule {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kinds: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub days: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favorites_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveCollection {
    pub id: String,
    pub name: String,
    /// `manual` collections hold an explicit list; `smart` ones resolve a rule.
    pub kind: String,
    pub file_count: i64,
    pub size_bytes: i64,
    pub surface: String,
    pub icon: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule: Option<CollectionRule>,
    /// Thumbnail paths of files actually in the collection.
    pub preview: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub file_count: i64,
    pub color: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEntry {
    pub id: String,
    pub kind: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveTotals {
    pub files: i64,
    pub new_today: i64,
    pub by_kind: std::collections::BTreeMap<String, i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStats {
    /// Bytes of the files themselves, summed from the database.
    pub used_bytes: i64,
    /// Capacity of the volume holding the archive, read from the OS.
    pub total_bytes: i64,
    pub indexed_files: i64,
    pub pending_files: i64,
    pub failed_files: i64,
    pub by_kind: std::collections::BTreeMap<String, i64>,
}

/// Live state of the indexing queue.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub state: String,
    pub pending: i64,
    pub processing: i64,
    pub done: i64,
    pub failed: i64,
    pub total: i64,
    pub per_minute: i64,
    pub current_file: Option<String>,
    pub current_folder: Option<String>,
    pub last_scan_at: Option<String>,
    pub problem: Option<String>,
}

impl Default for IndexStatus {
    fn default() -> Self {
        Self {
            state: "idle".into(),
            pending: 0,
            processing: 0,
            done: 0,
            failed: 0,
            total: 0,
            per_minute: 0,
            current_file: None,
            current_folder: None,
            last_scan_at: None,
            problem: None,
        }
    }
}

/// What the shell needs to render itself once, at boot.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSnapshot {
    pub folders: Vec<Folder>,
    pub totals: ArchiveTotals,
    pub storage: StorageStats,
    pub tags: Vec<Tag>,
    pub collections: Vec<ArchiveCollection>,
    pub projects: Vec<Project>,
    pub activity: Vec<ActivityEntry>,
    /// Newest files across the whole archive.
    pub recent: Vec<FileRecord>,
    pub index: IndexStatus,
}

/// A page request over the indexed files.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileQuery {
    #[serde(default)]
    pub kinds: Option<Vec<String>>,
    #[serde(default)]
    pub folder_id: Option<String>,
    /// Only files in which this person's face was detected. A virtual folder in
    /// the literal sense: the rows were never grouped on disk.
    #[serde(default)]
    pub person_id: Option<String>,
    #[serde(default)]
    pub tag_id: Option<String>,
    #[serde(default)]
    pub collection_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub favorites_only: Option<bool>,
    #[serde(default)]
    pub since_days: Option<i64>,
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePage {
    pub files: Vec<FileRecord>,
    /// Rows matching the query, not the size of this page.
    pub total: i64,
    pub has_more: bool,
}

/// Search intent, as the renderer sent it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    #[serde(default)]
    pub raw: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub tag_ids: Option<Vec<String>>,
    #[serde(default)]
    pub collection_id: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub favorites_only: Option<bool>,
    #[serde(default)]
    pub since_days: Option<i64>,
    #[serde(default)]
    pub folder_id: Option<String>,
}

/// What retrieval understood, echoed back for the results header.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryInterpretation {
    pub terms: Vec<String>,
    pub kinds: Vec<String>,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub since_days: Option<i64>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub favorites_only: bool,
    pub summary: String,
    pub refined_by_model: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub file: FileRecord,
    pub score: f64,
    /// Which index produced the hit: filename | text | tag | folder | project |
    /// collection | semantic.
    pub r#match: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
    /// True when only the vector index found it.
    pub semantic: bool,
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/// A group of faces believed to be one person — believed, never asserted.
/// `label` is whatever the user typed, and nothing else.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Faces detected in this person's group.
    pub face_count: i64,
    /// Distinct files containing them — the number the card shows.
    pub file_count: i64,
    pub hidden: bool,
    /// When the newest photograph in this group was taken. `None` for a group
    /// whose files have all been removed — the timeline view says so rather
    /// than filing it under today.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_seen_at: Option<String>,
    /// Absolute paths of up to four face crops, best first.
    pub samples: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// One detected face, as the inspector and the image overlay need it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileFace {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub person_id: Option<String>,
    /// Pixels in the original image's own coordinates.
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
    pub score: f64,
    pub quality: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crop_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// The group was hidden by the user, so the face is not linked anywhere.
    pub person_hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeopleStats {
    pub people: i64,
    pub faces: i64,
    /// Groups nobody has named yet — the queue the user actually works through.
    pub unnamed: i64,
    pub photos: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeopleSnapshot {
    pub people: Vec<Person>,
    pub stats: PeopleStats,
    /// False when the face models are not installed on this machine, which is a
    /// supported way to run AfterImage rather than a fault.
    pub available: bool,
    /// Why they are not installed, when they are not.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// One downloadable model bundle, with the cost of not having it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelBundle {
    pub name: String,
    pub ready: bool,
    pub megabytes: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub bundles: Vec<ModelBundle>,
    /// False when the indexing service is not answering at all.
    pub available: bool,
    pub missing_megabytes: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub directory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// True when this machine has an indexer that could be started but is not
    /// running yet. The difference between "not installed" and "not started" is
    /// the difference between a download and a button.
    pub can_start: bool,
    /// True when this machine is currently drawing from its battery.
    pub on_battery: bool,
}

/// Which build this is, and where it keeps its files.
///
/// Two builds of AfterImage look identical and install to the same place, so
/// the only way to tell an installed copy apart from a newer one is for the
/// application to say what it is. Everything here is read from the running
/// binary rather than written by hand, so it cannot drift.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    pub version: String,
    /// When the executable itself was written — i.e. when this build was made.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub built_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable: Option<String>,
    pub data_dir: String,
    pub thumbnails_dir: String,
    pub database: String,
    /// True when the installer carried its own indexer, rather than relying on
    /// a Python environment that happens to be on this machine.
    pub bundled_indexer: bool,
    pub on_battery: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub hits: Vec<SearchHit>,
    pub total: i64,
    pub interpretation: QueryInterpretation,
    pub semantic_available: bool,
    pub error: Option<String>,
}

/// One colour that actually covers part of a picture.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnaColor {
    pub hex: String,
    pub red: u8,
    pub green: u8,
    pub blue: u8,
    /// Share of the analysed pixels this colour accounts for, 0..1.
    pub share: f64,
}

/// What this machine can actually say about one picture.
///
/// Two kinds of fact live here and they are kept separate on purpose: what the
/// scan read from the file (size, dates, dimensions, format) and what `dna`
/// measured in the pixels. Every field that could not be determined is `None`,
/// so the interface omits the row rather than printing a plausible number.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageDna {
    pub file_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<i64>,
    /// Width ÷ height, to two decimals.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aspect: Option<f64>,
    /// `landscape`, `portrait` or `square`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orientation: Option<String>,
    pub format: String,
    pub bytes: i64,
    pub created_at: String,
    pub modified_at: String,
    /// False when the pixels could not be read here. The row still carries the
    /// facts the scan found; nothing is invented to fill the gap.
    pub decoded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub palette: Vec<DnaColor>,
    /// Mean luma, 0..1.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brightness: Option<f64>,
    /// Standard deviation of luma, 0..1.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contrast: Option<f64>,
    /// Edge energy, normalised 0..1. Higher is more detail in focus.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sharpness: Option<f64>,
    /// Mean chroma, 0..1.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saturation: Option<f64>,
    /// `warm`, `neutral` or `cool`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<String>,
    /// Red minus blue, -1..1. The number behind the word above.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature_shift: Option<f64>,
    /// Labels the local vision model put on the picture. Empty when no model is
    /// installed, which is a supported way to run AfterImage.
    pub objects: Vec<String>,
}

/// One kept copy of a picture, for before/after comparison.
///
/// A version is the archive's own 1600px presentation copy, taken the moment
/// the pipeline notices the file on disk has changed. That is the smallest copy
/// that can answer "what did this look like before I edited it" without keeping
/// a second copy of every original photograph.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileVersion {
    pub id: String,
    pub file_id: String,
    /// Absolute path to the kept copy, inside the thumbnail directory — the one
    /// place the webview is allowed to read from.
    pub path: String,
    pub bytes: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<i64>,
    /// When the copy was taken.
    pub captured_at: String,
    /// The modification time of the content this copy shows — the date that
    /// means something when two versions are compared.
    pub content_at: String,
    /// `change` (the file changed on disk) or `manual`.
    pub source: String,
}

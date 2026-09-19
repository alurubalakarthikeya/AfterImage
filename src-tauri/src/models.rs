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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub hits: Vec<SearchHit>,
    pub total: i64,
    pub interpretation: QueryInterpretation,
    pub semantic_available: bool,
    pub error: Option<String>,
}

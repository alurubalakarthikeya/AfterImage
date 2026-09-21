//! Retrieval.
//!
//! ```text
//!     query ─▶ parser ─▶ ┌ FTS5 over name, title, description, labels, text,
//!                        │ folder, tags, project
//!                        └ vector similarity (when the model is installed)
//!                              │
//!                              ▼
//!                          fusion + rerank ─▶ hits
//! ```
//!
//! Exact matches win where exactness is what the user means — filenames, error
//! strings, code identifiers. Similarity only fills in when the words are not
//! there. The optional local model never searches the archive: it rewrites the
//! question into criteria, and the criteria are what run.

use std::collections::{HashMap, HashSet};

use rusqlite::Connection;

use crate::db;
use crate::error::AppResult;
use crate::models::{FileQuery, FileRecord, QueryInterpretation, SearchHit, SearchQuery, SearchResponse};
use crate::service;
use crate::state::AppState;

/// How many full-text candidates to consider before ranking.
const CANDIDATES: i64 = 400;
/// How many vector neighbours to consider before ranking.
const NEIGHBOURS: i64 = 60;

#[derive(Debug, Clone, Default)]
pub struct Parsed {
    pub terms: Vec<String>,
    pub kinds: Vec<String>,
    pub tags: Vec<String>,
    pub since_days: Option<i64>,
    pub favorites_only: bool,
    pub summary: String,
    pub refined_by_model: bool,
}

const KNOWN_KINDS: &[&str] = &[
    "photo", "screenshot", "document", "video", "audio", "design", "archive", "other",
];

/// Split text into search tokens.
fn tokens(text: &str) -> Vec<String> {
    text.split(|character: char| !character.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(|token| token.to_lowercase())
        .collect()
}

/// Rules-based interpretation: everything expressible in a word or two.
///
/// `kind:screenshot`, `#react`, `is:fav`, `since:7`, plus quoted phrases and
/// bare words. This is the baseline that always runs, model or no model.
pub fn parse_rules(raw: &str) -> Parsed {
    let mut parsed = Parsed::default();
    let mut phrases: Vec<String> = Vec::new();
    let mut rest = String::new();
    let mut buffer = raw.to_string();

    // Pull quoted phrases out first, so their contents are never re-tokenised.
    while let Some(start) = buffer.find('"') {
        let after = &buffer[start + 1..];
        match after.find('"') {
            Some(end) => {
                let phrase = after[..end].to_string();
                if !phrase.trim().is_empty() {
                    phrases.push(phrase);
                }
                buffer = after[end + 1..].to_string();
            }
            None => break,
        }
    }
    rest.push_str(&buffer);

    for word in rest.split_whitespace() {
        let lower = word.to_lowercase();
        if let Some(value) = lower.strip_prefix("kind:") {
            let value = value.trim_end_matches(',');
            if KNOWN_KINDS.contains(&value) {
                parsed.kinds.push(value.to_string());
            }
            continue;
        }
        if let Some(value) = lower.strip_prefix("#") {
            let value = value.trim_start_matches('#').trim();
            if !value.is_empty() {
                parsed.tags.push(value.to_string());
            }
            continue;
        }
        if lower.starts_with("is:") {
            let value = &lower[3..];
            if value.starts_with("fav") || value.starts_with("star") {
                parsed.favorites_only = true;
            }
            continue;
        }
        if let Some(value) = lower.strip_prefix("since:") {
            if let Ok(days) = value.parse::<i64>() {
                parsed.since_days = Some(days);
            }
            continue;
        }
        if let Some(value) = lower.strip_prefix("last:") {
            if let Ok(days) = value.trim_end_matches('d').parse::<i64>() {
                parsed.since_days = Some(days);
            }
            continue;
        }
        parsed.terms.push(word.to_string());
    }

    for phrase in phrases {
        parsed.terms.push(phrase);
    }

    parsed.summary = summarise(&parsed, raw);
    parsed
}

fn summarise(parsed: &Parsed, raw: &str) -> String {
    let mut bits: Vec<String> = Vec::new();
    if !parsed.terms.is_empty() {
        bits.push(format!("“{}”", parsed.terms.join(" ")));
    }
    if !parsed.kinds.is_empty() {
        bits.push(parsed.kinds.join(", "));
    }
    if !parsed.tags.is_empty() {
        bits.push(format!("tagged {}", parsed.tags.join(", ")));
    }
    if parsed.favorites_only {
        bits.push("favourites".into());
    }
    if let Some(days) = parsed.since_days {
        bits.push(format!("added in the last {days} days"));
    }
    if bits.is_empty() {
        return if raw.trim().is_empty() {
            "everything".into()
        } else {
            raw.to_string()
        };
    }
    bits.join(" · ")
}

/// FTS5 match expression for a set of terms.
///
/// Every term is trimmed to alphanumeric tokens and OR-ed together, with the
/// final token left open for prefix matching so results appear while typing.
fn match_expression(terms: &[String]) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();

    for (index, term) in terms.iter().enumerate() {
        let term_tokens = tokens(term);
        if term_tokens.is_empty() {
            continue;
        }
        let is_last_term = index + 1 == terms.len();
        let mut expression = String::new();
        for (position, token) in term_tokens.iter().enumerate() {
            if !expression.is_empty() {
                expression.push_str(" AND ");
            }
            let is_last_token = position + 1 == term_tokens.len();
            if is_last_term && is_last_token {
                expression.push_str(&format!("\"{token}\"*"));
            } else if term_tokens.len() > 1 {
                expression.push_str(&format!("\"{token}\""));
            } else {
                expression.push_str(&format!("\"{token}\""));
            }
        }
        if !expression.is_empty() {
            parts.push(format!("({expression})"));
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" OR "))
    }
}

/// The sentence around a term, for the results list.
fn snippet_for(text: &str, terms: &[String], width: usize) -> Option<String> {
    if text.trim().is_empty() {
        return None;
    }
    let lowered = text.to_lowercase();
    let needle = terms.iter().find(|term| {
        let value = term.trim().to_lowercase();
        value.len() > 1 && lowered.contains(&value)
    })?;

    let position = lowered.find(&needle.to_lowercase())?;
    let start = position.saturating_sub(width / 2);
    let mut end = (position + needle.len() + width / 2).min(text.len());
    while end < text.len() && !text.is_char_boundary(end) {
        end += 1;
    }
    let mut start_byte = start;
    while start_byte > 0 && !text.is_char_boundary(start_byte) {
        start_byte -= 1;
    }

    let slice = text[start_byte..end].trim().replace('\n', " ");
    let trimmed = slice.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(format!(
        "{}{}{}",
        if start_byte > 0 { "…" } else { "" },
        trimmed,
        if end < text.len() { "…" } else { "" }
    ))
}

fn contains(value: &str, needle: &str) -> bool {
    !needle.is_empty() && value.to_lowercase().contains(&needle.to_lowercase())
}

/// Where a hit matched, in the vocabulary the results list uses.
fn classify_match(
    file: &FileRecord,
    terms: &[String],
    tag_names: &[String],
    folder_has: bool,
    project_has: bool,
    collection_has: bool,
) -> &'static str {
    if terms.iter().any(|term| contains(&file.name, term)) {
        return "filename";
    }
    if tag_names.iter().any(|tag| terms.iter().any(|term| contains(tag, term))) {
        return "tag";
    }
    if project_has {
        return "project";
    }
    if folder_has {
        return "folder";
    }
    if collection_has {
        return "collection";
    }
    if let Some(text) = &file.ocr_text {
        if terms.iter().any(|term| contains(text, term)) {
            return "text";
        }
    }
    if file
        .generated_title
        .as_deref()
        .is_some_and(|title| terms.iter().any(|term| contains(title, term)))
    {
        return "text";
    }
    "semantic"
}

pub struct Retrieval<'a> {
    pub conn: &'a Connection,
    pub state: &'a AppState,
}

impl<'a> Retrieval<'a> {
    /// Ask the local model to interpret the query, when one is enabled.
    ///
    /// Every merge below is guarded: terms are added rather than replaced, a
    /// kind or a date range only fills a gap the rules left, and a model that is
    /// not installed (or not answering) leaves the rules-only result untouched.
    fn refine_with_model(&self, query: &SearchQuery, parsed: &mut Parsed) {
        use std::sync::atomic::Ordering;

        if !self.state.llm_enabled.load(Ordering::Relaxed) || query.raw.trim().is_empty() {
            return;
        }
        let port = self.state.service_port.load(Ordering::Relaxed);
        let Some(service::ModelQuery {
            terms,
            kind,
            since_days,
            favorites_only,
            interpreted,
        }) = service::parse_query(port, &query.raw)
        else {
            return;
        };

        for term in terms {
            let term = term.trim().to_lowercase();
            if !term.is_empty() && !parsed.terms.contains(&term) {
                parsed.terms.push(term);
            }
        }
        if parsed.kinds.is_empty() {
            if let Some(kind) = kind {
                let kind = kind.to_lowercase();
                if KNOWN_KINDS.contains(&kind.as_str()) {
                    parsed.kinds = vec![kind];
                }
            }
        }
        if parsed.since_days.is_none() {
            parsed.since_days = since_days;
        }
        if !parsed.favorites_only {
            parsed.favorites_only = favorites_only.unwrap_or(false);
        }

        parsed.refined_by_model = true;
        // The model's own phrasing is what the results header shows when it has
        // one: it is a restatement of the question, never a claim about results.
        parsed.summary = interpreted
            .map(|text| text.trim().to_string())
            .filter(|text| !text.is_empty())
            .unwrap_or_else(|| summarise(parsed, &query.raw));
    }

    pub fn search(&self, query: &SearchQuery) -> AppResult<SearchResponse> {
        let mut parsed = parse_rules(&query.raw);

        // The renderer's explicit filters take precedence over parsed ones: a
        // chip the user clicked is a stronger statement than a word they typed.
        if let Some(kind) = &query.kind {
            parsed.kinds = vec![kind.clone()];
            parsed.summary = summarise(&parsed, &query.raw);
        }
        if let Some(days) = query.since_days {
            parsed.since_days = Some(days);
            parsed.summary = summarise(&parsed, &query.raw);
        }
        if query.favorites_only.unwrap_or(false) {
            parsed.favorites_only = true;
            parsed.summary = summarise(&parsed, &query.raw);
        }

        // The optional local model rewrites the sentence into criteria. It is
        // only asked when the user has turned it on, and it only *adds* to what
        // the rules already found — a filter the user clicked is never
        // overridden by a guess, and a query the model cannot improve is left
        // exactly as it was. Nothing here searches the archive.
        self.refine_with_model(query, &mut parsed);

        let tags = db::list_tags(self.conn)?;
        let tag_ids: Vec<String> = query
            .tag_ids
            .clone()
            .unwrap_or_else(|| {
                parsed
                    .tags
                    .iter()
                    .filter_map(|wanted| {
                        tags.iter()
                            .find(|tag| tag.name.eq_ignore_ascii_case(wanted))
                            .map(|tag| tag.id.clone())
                    })
                    .collect()
            });

        let filters = FileQuery {
            kinds: if parsed.kinds.is_empty() {
                None
            } else {
                Some(parsed.kinds.clone())
            },
            collection_id: query.collection_id.clone(),
            project_id: query.project_id.clone(),
            folder_id: query.folder_id.clone(),
            favorites_only: Some(parsed.favorites_only),
            since_days: parsed.since_days,
            ..FileQuery::default()
        };

        let expression = match_expression(&parsed.terms);
        let mut ranks: HashMap<String, f64> = HashMap::new();
        let mut semantic_hits: HashMap<String, f64> = HashMap::new();
        let mut semantic_available = false;

        if let Some(expression) = expression.as_deref() {
            let rows = db::search_fts(self.conn, expression, &filters, CANDIDATES)?;
            let best = rows.iter().map(|(_, score)| *score).fold(f64::INFINITY, f64::min);
            let worst = rows
                .iter()
                .map(|(_, score)| *score)
                .fold(f64::NEG_INFINITY, f64::max);
            let spread = (worst - best).abs().max(1e-6);
            for (file_id, score) in rows {
                // bm25 is negative and lower-is-better; flip and normalise.
                let normalised = ((worst - score) / spread).clamp(0.0, 1.0);
                ranks.insert(file_id, 0.45 + 0.5 * normalised);
            }
        }

        // Tag-only queries ("#react") have no text terms at all, so fetch the
        // members directly rather than returning nothing.
        if expression.is_none() && !tag_ids.is_empty() {
            for tag_id in &tag_ids {
                let page = db::list_files(
                    self.conn,
                    &FileQuery {
                        tag_id: Some(tag_id.clone()),
                        limit: Some(CANDIDATES),
                        ..filters.clone()
                    },
                )?;
                for file in page.0 {
                    ranks.entry(file.id).or_insert(0.6);
                }
            }
        }

        // Filters on their own are a legitimate search: "everything tagged
        // react" or "screenhots from last week" needs no text match.
        if expression.is_none() && tag_ids.is_empty() {
            let page = db::list_files(
                self.conn,
                &FileQuery {
                    limit: Some(CANDIDATES),
                    ..filters.clone()
                },
            )?;
            for file in page.0 {
                ranks.entry(file.id).or_insert(0.5);
            }
        }

        if self.state.semantic_enabled.load(std::sync::atomic::Ordering::Relaxed)
            && !query.raw.trim().is_empty()
        {
            let port = self.state.service_port.load(std::sync::atomic::Ordering::Relaxed);
            if let Some(neighbours) = service::semantic_search(
                port,
                &query.raw,
                NEIGHBOURS,
                parsed.kinds.first().map(String::as_str),
            ) {
                semantic_available = true;
                for (file_id, score) in neighbours {
                    semantic_hits.insert(file_id, score);
                }
            }
        }

        // Candidates: anything full text found, plus anything only the vector
        // index found. Files that merely match a filter still count, but rank
        // below a real match.
        let mut ids: Vec<String> = ranks.keys().cloned().collect();
        for file_id in semantic_hits.keys() {
            if !ranks.contains_key(file_id) {
                ids.push(file_id.clone());
            }
        }

        let files = db::files_by_ids(self.conn, &ids)?;
        let mut by_id: HashMap<String, FileRecord> = files
            .into_iter()
            .map(|file| (file.id.clone(), file))
            .collect();

        let folder_paths: HashMap<String, String> = by_id
            .iter()
            .map(|(id, file)| (id.clone(), file.folder_path.to_lowercase()))
            .collect();

        let project_names = self.project_names(&by_id)?;
        let collection_names = self.collection_names(&by_id)?;

        let mut hits: Vec<SearchHit> = Vec::with_capacity(ids.len());

        for file_id in ids {
            let Some(file) = by_id.remove(&file_id) else {
                continue;
            };

            // Tag names are only needed when the query has terms to compare
            // against, so a filter-only search skips this query entirely.
            let tag_names = if parsed.terms.is_empty() {
                Vec::new()
            } else {
                db::tag_names(self.conn, &file.id).unwrap_or_default()
            };
            let base = ranks.get(&file.id).copied();
            let semantic_score = semantic_hits.get(&file.id).copied();

            let (match_kind, semantic_only) = match (base, semantic_score) {
                (Some(_), _) => (
                    classify_match(
                        &file,
                        &parsed.terms,
                        &tag_names,
                        parsed
                            .terms
                            .iter()
                            .any(|term| folder_paths.get(&file.id).is_some_and(|path| contains(path, term))),
                        project_names
                            .get(&file.id)
                            .is_some_and(|name| parsed.terms.iter().any(|term| contains(name, term))),
                        collection_names
                            .get(&file.id)
                            .is_some_and(|name| parsed.terms.iter().any(|term| contains(name, term))),
                    ),
                    false,
                ),
                (None, Some(_)) => ("semantic", true),
                (None, None) => ("folder", false),
            };

            // Ranking: full-text relevance, plus the signals that make local
            // search feel right — a filename hit beats a mention deep in OCR
            // text, and something added today beats something from last year.
            let mut score = base.unwrap_or(0.35);
            if match_kind == "filename" {
                score += 0.18;
            }
            if match_kind == "tag" {
                score += 0.1;
            }
            if let Some(similarity) = semantic_score {
                score += 0.28 * similarity.clamp(0.0, 1.0);
            }
            if let Some(days) = days_since(&file.created_at) {
                if days < 1.0 {
                    score += 0.07;
                } else if days < 7.0 {
                    score += 0.035;
                } else if days > 365.0 {
                    score -= 0.04;
                }
            }

            let snippet = file
                .ocr_text
                .as_deref()
                .and_then(|text| snippet_for(text, &parsed.terms, 160))
                .or_else(|| snippet_for(&file.path, &parsed.terms, 120));

            hits.push(SearchHit {
                score: score.clamp(0.0, 1.0),
                r#match: match_kind.to_string(),
                snippet,
                semantic: semantic_only,
                file,
            });
        }

        hits.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let total = hits.len() as i64;
        hits.truncate(200);

        let interpretation = QueryInterpretation {
            terms: parsed.terms.clone(),
            kinds: parsed.kinds.clone(),
            tags: parsed.tags.clone(),
            since_days: parsed.since_days,
            favorites_only: parsed.favorites_only,
            summary: parsed.summary.clone(),
            refined_by_model: parsed.refined_by_model,
        };

        Ok(SearchResponse {
            hits,
            total,
            interpretation,
            semantic_available,
            error: None,
        })
    }

    fn project_names(&self, files: &HashMap<String, FileRecord>) -> AppResult<HashMap<String, String>> {
        let mut names = HashMap::new();
        for project in db::list_projects(self.conn)? {
            for (id, file) in files.iter() {
                if file.project_id.as_deref() == Some(project.id.as_str()) {
                    names.insert(id.clone(), project.name.clone());
                }
            }
        }
        Ok(names)
    }

    fn collection_names(
        &self,
        files: &HashMap<String, FileRecord>,
    ) -> AppResult<HashMap<String, String>> {
        let mut names = HashMap::new();
        for collection in db::list_collections(self.conn)? {
            for (id, file) in files.iter() {
                if file.collection_ids.contains(&collection.id) {
                    names.insert(id.clone(), collection.name.clone());
                }
            }
        }
        Ok(names)
    }

    /// Visually similar files, by image embedding.
    ///
    /// Returns an empty list — not an error — when no embedding model is
    /// installed, because "this machine cannot do that yet" is a normal state.
    pub fn similar(&self, file_id: &str, limit: i64) -> AppResult<Vec<SearchHit>> {
        let port = self.state.service_port.load(std::sync::atomic::Ordering::Relaxed);
        let Some(neighbours) = service::similar(port, file_id, limit + 1) else {
            return Ok(Vec::new());
        };

        let ids: Vec<String> = neighbours
            .iter()
            .filter(|(id, _)| id != file_id)
            .map(|(id, _)| id.clone())
            .collect();
        let scores: HashMap<String, f64> = neighbours.into_iter().collect();

        let files = db::files_by_ids(self.conn, &ids)?;
        let mut hits: Vec<SearchHit> = files
            .into_iter()
            .map(|file| SearchHit {
                score: scores.get(&file.id).copied().unwrap_or(0.5).clamp(0.0, 1.0),
                r#match: "semantic".into(),
                snippet: None,
                semantic: true,
                file,
            })
            .collect();

        hits.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        hits.truncate(limit.max(1) as usize);
        Ok(hits)
    }

    /// Related files.
    ///
    /// Scored from signals the index already holds — shared tags, shared words
    /// between extracted texts, the same folder, the same project, and how close
    /// they are in time. A candidate with a score of zero is not returned, which
    /// is what keeps this panel from filling with arbitrary files.
    pub fn related(&self, file_id: &str, limit: i64) -> AppResult<Vec<SearchHit>> {
        let Some(target) = db::file_by_id(self.conn, file_id)? else {
            return Ok(Vec::new());
        };

        let target_tags: HashSet<String> = db::tag_names(self.conn, file_id)?.into_iter().collect();
        let target_words: HashSet<String> = target
            .ocr_text
            .as_deref()
            .map(|text| {
                tokens(text)
                    .into_iter()
                    .filter(|token| token.len() > 3)
                    .collect()
            })
            .unwrap_or_default();

        let target_time = parse_time(&target.created_at);
        let pool = db::candidate_pool(self.conn, 3000)?;
        let tag_lookup = db::tag_map(self.conn)?;

        let mut scored: Vec<(f64, String, String, Option<String>)> = Vec::new();

        for candidate in pool {
            if candidate.id == file_id {
                continue;
            }
            let (id, created_at, text) = (candidate.id, candidate.created_at, candidate.text);
            let mut score = 0.0;
            let mut reason = "text";

            if !target_tags.is_empty() {
                let empty: Vec<String> = Vec::new();
                let other_tags: HashSet<String> = tag_lookup
                    .get(&id)
                    .unwrap_or(&empty)
                    .iter()
                    .cloned()
                    .collect();
                let shared = target_tags.intersection(&other_tags).count() as f64;
                if shared > 0.0 {
                    score += 0.45 * (shared / target_tags.len() as f64).min(1.0);
                    reason = "tag";
                }
            }

            if !target_words.is_empty() && !text.is_empty() {
                let other_words: HashSet<String> = tokens(&text)
                    .into_iter()
                    .filter(|token| token.len() > 3)
                    .collect();
                if !other_words.is_empty() {
                    let shared = target_words.intersection(&other_words).count() as f64;
                    let union = target_words.union(&other_words).count() as f64;
                    if shared > 0.0 {
                        score += 0.4 * (shared / union.max(1.0)).min(1.0);
                    }
                }
            }

            if candidate.folder_id == target.folder_id {
                score += 0.12;
                if reason == "text" {
                    reason = "folder";
                }
            }
            if !candidate.project_id.is_empty()
                && target.project_id.as_deref() == Some(candidate.project_id.as_str())
            {
                score += 0.18;
                reason = "project";
            }

            if let (Some(target_moment), Some(moment)) = (target_time, parse_time(&created_at)) {
                let days = (target_moment - moment).abs() / 86_400.0;
                if days < 1.0 {
                    score += 0.1;
                } else if days < 7.0 {
                    score += 0.04;
                }
            }

            if score > 0.05 {
                let snippet = snippet_for(&text, &target_words.iter().cloned().collect::<Vec<_>>(), 120);
                scored.push((score.min(1.0), id, reason.to_string(), snippet));
            }
        }

        scored.sort_by(|left, right| {
            right
                .0
                .partial_cmp(&left.0)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        scored.truncate(limit.max(1) as usize);

        let ids: Vec<String> = scored.iter().map(|(_, id, _, _)| id.clone()).collect();
        let files = db::files_by_ids(self.conn, &ids)?;
        let mut by_id: HashMap<String, FileRecord> = files
            .into_iter()
            .map(|file| (file.id.clone(), file))
            .collect();

        Ok(scored
            .into_iter()
            .filter_map(|(score, id, reason, snippet)| {
                by_id.remove(&id).map(|file| SearchHit {
                    file,
                    score,
                    r#match: reason,
                    snippet,
                    semantic: false,
                })
            })
            .collect())
    }
}

fn parse_time(value: &str) -> Option<f64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|moment| moment.timestamp() as f64)
}

fn days_since(value: &str) -> Option<f64> {
    let moment = parse_time(value)?;
    let now = chrono::Local::now().timestamp() as f64;
    Some((now - moment) / 86_400.0)
}

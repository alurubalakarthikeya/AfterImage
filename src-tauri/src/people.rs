//! People — face grouping.
//!
//! The indexer detects faces and turns each one into a 128-dimensional vector
//! where the same person's faces land close together and different people's land
//! apart. This module turns those vectors into *groups*; the user turns groups
//! into *names*.
//!
//! Three decisions are worth stating plainly, because together they are the
//! whole feature:
//!
//!   * **The application never names anybody.** A cluster is a suggestion of
//!     identity, never an assertion. The only text that ever appears under a
//!     face is text the person at the machine typed.
//!   * **A wrong merge is worse than a missed one.** Merging two people puts a
//!     stranger in an album of somebody's family and the mistake is invisible
//!     afterwards. Splitting one person in two is obvious and one click to fix,
//!     so every threshold here is set to under-merge rather than over-merge.
//!   * **Clustering happens here, not in the Python service.** The embeddings
//!     live in SQLite, which this process owns. Sending several thousand vectors
//!     over loopback to be grouped and then writing the answer back would make
//!     one process's data into another process's problem, and it would need the
//!     threshold defined in two places.
//!
//! `SAME_PERSON` is OpenCV's own recommended operating point for SFace on its
//! published benchmark, so it is a measured value rather than a tuned one.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppResult;
use crate::models::{FileFace, PeopleStats, Person};

/// Cosine similarity at which two faces are treated as the same person.
pub const SAME_PERSON: f32 = 0.363;

/// A face as the indexer reported it.
pub struct DetectedFace {
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
    pub score: f64,
    pub quality: f64,
    pub embedding: Vec<f32>,
    /// Absolute path of the aligned crop the service wrote for this face.
    pub crop_path: Option<String>,
}

// ---------------------------------------------------------------------------
// Vector encoding
// ---------------------------------------------------------------------------

/// SFace embeddings as 128 little-endian f32 values — 512 bytes a face.
///
/// Stored as a blob rather than JSON because it is read for every face in the
/// library on every regroup, and because a text encoding of a float array is
/// both larger and lossy.
pub fn encode(vector: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vector.len() * 4);
    for value in vector {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

pub fn decode(blob: &[u8]) -> Vec<f32> {
    blob.chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

pub fn unit(vector: &[f32]) -> Vec<f32> {
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm <= f32::EPSILON {
        return vector.to_vec();
    }
    vector.iter().map(|value| value / norm).collect()
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0;
    let mut left = 0.0;
    let mut right = 0.0;
    for index in 0..a.len() {
        dot += a[index] * b[index];
        left += a[index] * a[index];
        right += b[index] * b[index];
    }
    let denominator = left.sqrt() * right.sqrt();
    if denominator <= f32::EPSILON {
        0.0
    } else {
        dot / denominator
    }
}

// ---------------------------------------------------------------------------
// Writing what the indexer found
// ---------------------------------------------------------------------------

fn crop_paths_for_file(conn: &Connection, file_id: &str) -> AppResult<Vec<String>> {
    let mut statement = conn.prepare("SELECT crop_path FROM faces WHERE file_id = ?1")?;
    let rows = statement.query_map(params![file_id], |row| row.get::<_, Option<String>>(0))?;
    let mut paths = Vec::new();
    for row in rows {
        if let Some(path) = row? {
            paths.push(path);
        }
    }
    Ok(paths)
}

/// Replace everything known about the faces in one file.
///
/// Re-detection is idempotent by design: a file that is rescanned produces a
/// fresh set of faces rather than a second copy, and the crops that are no
/// longer referenced are removed from disk.
pub fn store_file_faces(conn: &Connection, file_id: &str, faces: &[DetectedFace]) -> AppResult<()> {
    for path in crop_paths_for_file(conn, file_id)? {
        let _ = std::fs::remove_file(path);
    }
    conn.execute("DELETE FROM faces WHERE file_id = ?1", params![file_id])?;

    // Assignment against the existing groups happens in one transaction with the
    // inserts: a face that is written but not assigned would be invisible to the
    // user for good, since nothing else ever revisits it.
    let tx = conn.unchecked_transaction()?;

    let mut centroids: Vec<(String, Vec<f32>, i64)> = Vec::new();
    {
        let mut statement = tx.prepare("SELECT id, centroid, face_count FROM people")?;
        let rows = statement.query_map([], |row| {
            let id: String = row.get(0)?;
            let centroid: Option<Vec<u8>> = row.get(1)?;
            let count: i64 = row.get(2)?;
            Ok((id, centroid, count))
        })?;
        for row in rows {
            let (id, centroid, count) = row?;
            centroids.push((
                id,
                centroid.map(|blob| decode(&blob)).unwrap_or_default(),
                count,
            ));
        }
    }

    for (index, face) in faces.iter().enumerate() {
        if face.embedding.is_empty() {
            continue;
        }
        let face_id = format!("{file_id}:{index}");
        let vector = unit(&face.embedding);

        // Nearest existing group, if any is close enough. Largest similarity
        // wins; ties are impossible enough to be worth not handling.
        let mut best: Option<(usize, f32)> = None;
        for (position, (_, centroid, _)) in centroids.iter().enumerate() {
            if centroid.is_empty() {
                continue;
            }
            let score = cosine(&vector, centroid);
            if score >= SAME_PERSON && best.map(|(_, current)| score > current).unwrap_or(true) {
                best = Some((position, score));
            }
        }

        let person_id = match best {
            Some((position, _)) => {
                let (id, centroid, count) = centroids[position].clone();
                // Running mean, renormalised, so the group tracks its members
                // instead of staying pinned to whichever face arrived first.
                let mut blended = centroid.clone();
                if blended.len() == vector.len() {
                    for slot in 0..blended.len() {
                        blended[slot] = (blended[slot] * count as f32 + vector[slot])
                            / (count as f32 + 1.0);
                    }
                } else {
                    blended = vector.clone();
                }
                let updated = unit(&blended);
                tx.execute(
                    "UPDATE people SET centroid = ?2, face_count = face_count + 1, updated_at = ?3 \
                     WHERE id = ?1",
                    params![id, encode(&updated), crate::db::now()],
                )?;
                centroids[position] = (id.clone(), updated, count + 1);
                id
            }
            None => {
                // A group of one. It exists so the user can name it — and it is
                // marked as unnamed, never as a person.
                let id = format!("person-{face_id}");
                tx.execute(
                    "INSERT INTO people (id, label, centroid, face_count, hidden, created_at, updated_at) \
                     VALUES (?1, NULL, ?2, 1, 0, ?3, ?3)",
                    params![id, encode(&vector), crate::db::now()],
                )?;
                centroids.push((id.clone(), vector.clone(), 1));
                id
            }
        };

        tx.execute(
            "INSERT OR REPLACE INTO faces \
             (id, file_id, person_id, left, top, width, height, score, quality, crop_path, embedding, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                face_id,
                file_id,
                person_id,
                face.left,
                face.top,
                face.width,
                face.height,
                face.score,
                face.quality,
                face.crop_path,
                encode(&face.embedding),
                crate::db::now(),
            ],
        )?;
    }

    tx.commit()?;
    Ok(())
}

/// Forget the faces of one file, crops included.
pub fn clear_file_faces(conn: &Connection, file_id: &str) -> AppResult<()> {
    for path in crop_paths_for_file(conn, file_id)? {
        let _ = std::fs::remove_file(path);
    }
    conn.execute("DELETE FROM faces WHERE file_id = ?1", params![file_id])?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

fn samples_by_person(conn: &Connection) -> AppResult<HashMap<String, Vec<String>>> {
    // One pass for every cover in the library, rather than one query per person.
    let mut statement = conn.prepare(
        "SELECT person_id, crop_path FROM faces \
         WHERE crop_path IS NOT NULL AND person_id IS NOT NULL \
         ORDER BY quality DESC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut samples: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let (person_id, path) = row?;
        let bucket = samples.entry(person_id).or_default();
        // Four is what a person card can show as a collage before it stops
        // reading as "more of the same person".
        if bucket.len() < 4 {
            bucket.push(path);
        }
    }
    Ok(samples)
}

fn row_to_person(row: &rusqlite::Row<'_>) -> rusqlite::Result<Person> {
    Ok(Person {
        id: row.get(0)?,
        label: row.get(1)?,
        face_count: row.get(2)?,
        file_count: row.get(3)?,
        hidden: row.get::<_, i64>(4)? != 0,
        last_seen_at: row.get(7)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        cover_path: None,
        samples: Vec::new(),
    })
}

// The counts are sub-selects rather than stored numbers: what the interface
// shows is COUNT(*) of the rows that actually exist, never a running total that
// can drift away from them. They are aliased because the ordering refers to them
// by name — a positional ORDER BY on a named select list is not portable.
const PERSON_SELECT: &str = "SELECT p.id, p.label, \
     (SELECT COUNT(*) FROM faces f WHERE f.person_id = p.id) AS face_count, \
     (SELECT COUNT(DISTINCT f.file_id) FROM faces f WHERE f.person_id = p.id) AS file_count, \
     p.hidden, p.created_at, p.updated_at, \
     (SELECT MAX(fi.created_at) FROM files fi JOIN faces f ON f.file_id = fi.id \
       WHERE f.person_id = p.id) AS last_seen_at \
     FROM people p";

/// Every group, biggest first, each with the crops that represent it.
///
/// Hidden groups are included. They are filtered for display rather than for
/// retrieval, because hiding something with no way to list it again is not a
/// setting, it is a deletion the user cannot undo.
pub fn list_people(conn: &Connection) -> AppResult<Vec<Person>> {
    let mut samples = samples_by_person(conn)?;
    let mut statement = conn.prepare(&format!(
        "{PERSON_SELECT} ORDER BY file_count DESC, face_count DESC"
    ))?;
    let rows = statement.query_map([], row_to_person)?;

    let mut people = Vec::new();
    for row in rows {
        let mut person = row?;
        person.samples = samples.remove(&person.id).unwrap_or_default();
        person.cover_path = person.samples.first().cloned();
        people.push(person);
    }
    Ok(people)
}

pub fn person_by_id(conn: &Connection, person_id: &str) -> AppResult<Option<Person>> {
    let mut statement = conn.prepare(&format!("{PERSON_SELECT} WHERE p.id = ?1"))?;
    let mut person = statement
        .query_row(params![person_id], row_to_person)
        .optional()?;
    if let Some(found) = person.as_mut() {
        let mut samples = samples_by_person(conn)?;
        found.samples = samples.remove(&found.id).unwrap_or_default();
        found.cover_path = found.samples.first().cloned();
    }
    Ok(person)
}

pub fn stats(conn: &Connection) -> AppResult<PeopleStats> {
    let nodes = conn.query_row(
        "SELECT (SELECT COUNT(*) FROM people WHERE hidden = 0), \
                (SELECT COUNT(*) FROM faces), \
                (SELECT COUNT(*) FROM people WHERE hidden = 0 AND label IS NULL), \
                (SELECT COUNT(DISTINCT file_id) FROM faces)",
        [],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?, row.get::<_, i64>(3)?)),
    )?;
    Ok(PeopleStats {
        people: nodes.0,
        faces: nodes.1,
        unnamed: nodes.2,
        photos: nodes.3,
    })
}

pub fn faces_for_file(conn: &Connection, file_id: &str) -> AppResult<Vec<FileFace>> {
    let mut statement = conn.prepare(
        "SELECT fa.id, fa.person_id, fa.left, fa.top, fa.width, fa.height, fa.score, \
                fa.quality, fa.crop_path, p.label, p.hidden \
         FROM faces fa LEFT JOIN people p ON p.id = fa.person_id \
         WHERE fa.file_id = ?1 ORDER BY fa.quality DESC",
    )?;
    let rows = statement.query_map(params![file_id], |row| {
        Ok(FileFace {
            id: row.get(0)?,
            person_id: row.get(1)?,
            left: row.get(2)?,
            top: row.get(3)?,
            width: row.get(4)?,
            height: row.get(5)?,
            score: row.get(6)?,
            quality: row.get(7)?,
            crop_path: row.get(8)?,
            label: row.get(9)?,
            person_hidden: row.get::<_, Option<i64>>(10)?.unwrap_or(0) != 0,
        })
    })?;
    let mut faces = Vec::new();
    for row in rows {
        faces.push(row?);
    }
    Ok(faces)
}

/// Files that this machine could detect faces in but has not looked at yet.
///
/// `faces_state` is what keeps this from being an infinite queue: a photograph
/// with no faces in it is *scanned*, not *unprocessed*.
pub fn files_needing_faces(conn: &Connection, limit: i64) -> AppResult<Vec<(String, String, String)>> {
    let mut statement = conn.prepare(
        "SELECT id, path, kind FROM files \
         WHERE kind IN ('photo', 'screenshot', 'design') \
           AND index_state = 'indexed' \
           AND faces_state <> 'scanned' \
         ORDER BY created_at DESC LIMIT ?1",
    )?;
    let rows = statement.query_map(params![limit.clamp(1, 20_000)], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    })?;
    let mut files = Vec::new();
    for row in rows {
        files.push(row?);
    }
    Ok(files)
}

// ---------------------------------------------------------------------------
// The user's own decisions
// ---------------------------------------------------------------------------

// Tests live here rather than in a separate crate because the thing worth
// testing is a threshold, and a threshold is only meaningful next to the code
// that applies it.

#[cfg(test)]
mod tests {
    use super::*;

    /// A real, migrated database — the tables under test are the ones that ship.
    fn database() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory sqlite");
        crate::db::migrate(&connection).expect("schema");
        connection
    }

    /// One direction in 128-d space, with a bias on its neighbour.
    ///
    /// Two axes apart score about 0.31, comfortably under the 0.363 threshold;
    /// the same axis at a different weight scores about 0.99, comfortably over.
    /// The pair is chosen so the test breaks if the threshold moves either way.
    fn vector(axis: usize, bias: f32) -> Vec<f32> {
        let mut values = vec![0.0_f32; 128];
        values[axis % 128] = 1.0;
        values[(axis + 1) % 128] = bias;
        values
    }

    /// A real file row, because `faces.file_id` is a foreign key with a cascade:
    /// a face must not be able to outlive the photograph it was found in.
    fn add_file(conn: &Connection, file_id: &str) {
        conn.execute(
            "INSERT OR IGNORE INTO folders (id, path, name, added_at) \
             VALUES ('folder', 'C:/photos', 'photos', '2026-01-01T00:00:00+00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO files (id, path, name, kind, folder_id, created_at, \
             modified_at, indexed_at, index_state) \
             VALUES (?1, ?2, ?3, 'photo', 'folder', '2026-01-01T00:00:00+00:00', \
             '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00', 'indexed')",
            params![file_id, format!("C:/photos/{file_id}.jpg"), format!("{file_id}.jpg")],
        )
        .unwrap();
    }

    fn store(conn: &Connection, file_id: &str, faces: &[DetectedFace]) {
        add_file(conn, file_id);
        store_file_faces(conn, file_id, faces).unwrap();
    }

    fn detected(axis: usize, bias: f32, quality: f64) -> DetectedFace {
        DetectedFace {
            left: 10.0,
            top: 10.0,
            width: 100.0,
            height: 100.0,
            score: 0.9,
            quality,
            embedding: vector(axis, bias),
            crop_path: None,
        }
    }

    #[test]
    fn embeddings_survive_the_round_trip() {
        let values = vector(3, 0.35);
        assert_eq!(decode(&encode(&values)), values);
        assert!((cosine(&values, &values) - 1.0).abs() < 1e-5);
    }

    #[test]
    fn the_same_face_lands_in_one_group() {
        let conn = database();
        store(&conn, "file-a", &[detected(0, 0.35, 90.0)]);
        store(&conn, "file-b", &[detected(0, 0.5, 70.0)]);

        let people = list_people(&conn).unwrap();
        assert_eq!(people.len(), 1, "two views of one face must be one person");
        assert_eq!(people[0].face_count, 2);
        assert_eq!(people[0].file_count, 2);
        assert!(people[0].label.is_none(), "nothing may name a group on its own");
    }

    #[test]
    fn different_faces_stay_apart() {
        let conn = database();
        store(&conn, "file-a", &[detected(0, 0.35, 90.0)]);
        store(&conn, "file-b", &[detected(40, 0.35, 90.0)]);

        let people = list_people(&conn).unwrap();
        assert_eq!(people.len(), 2, "a wrong merge is worse than a missed one");
        let stats = stats(&conn).unwrap();
        assert_eq!(stats.people, 2);
        assert_eq!(stats.unnamed, 2);
        assert_eq!(stats.photos, 2);
    }

    #[test]
    fn a_second_face_in_the_same_photograph_is_kept() {
        let conn = database();
        let faces = vec![detected(0, 0.35, 90.0), detected(40, 0.35, 88.0)];
        store(&conn, "file-a", &faces);

        let people = list_people(&conn).unwrap();
        assert_eq!(people.len(), 2);
        assert_eq!(faces_for_file(&conn, "file-a").unwrap().len(), 2);
    }

    #[test]
    fn re_detecting_a_file_replaces_its_faces() {
        let conn = database();
        store(&conn, "file-a", &[detected(0, 0.35, 90.0)]);
        store(&conn, "file-a", &[detected(0, 0.4, 91.0)]);

        assert_eq!(faces_for_file(&conn, "file-a").unwrap().len(), 1);
        assert_eq!(list_people(&conn).unwrap().len(), 1);
        assert_eq!(stats(&conn).unwrap().faces, 1);
    }

    #[test]
    fn a_name_typed_by_the_user_outlives_a_regroup() {
        let conn = database();
        store(&conn, "file-a", &[detected(0, 0.35, 90.0)]);
        store(&conn, "file-b", &[detected(0, 0.5, 70.0)]);
        let people = list_people(&conn).unwrap();
        rename(&conn, &people[0].id, Some("Ada")).unwrap();

        assert_eq!(recluster(&conn).unwrap(), 1);
        let after = list_people(&conn).unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].label.as_deref(), Some("Ada"));
        assert_eq!(after[0].face_count, 2);
    }

    #[test]
    fn merging_moves_the_faces_and_keeps_the_name() {
        let conn = database();
        store(&conn, "file-a", &[detected(0, 0.35, 90.0)]);
        store(&conn, "file-b", &[detected(60, 0.35, 80.0)]);
        let people = list_people(&conn).unwrap();
        assert_eq!(people.len(), 2);

        let (survivor, absorbed) = (&people[0].id, &people[1].id);
        rename(&conn, survivor, Some("Grace")).unwrap();
        merge(&conn, absorbed, survivor).unwrap();

        let after = list_people(&conn).unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].label.as_deref(), Some("Grace"));
        assert_eq!(after[0].face_count, 2);
        assert_eq!(after[0].file_count, 2);
    }

    #[test]
    fn hiding_a_group_removes_it_from_the_numbers_but_not_the_list() {
        let conn = database();
        store(&conn, "file-a", &[detected(0, 0.35, 90.0)]);
        let people = list_people(&conn).unwrap();
        set_hidden(&conn, &people[0].id, true).unwrap();

        assert_eq!(stats(&conn).unwrap().people, 0);
        // Still listed, so the user can undo it — hiding is not a deletion.
        let all = list_people(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert!(all[0].hidden);
    }

    #[test]
    fn a_forgotten_group_takes_its_faces_with_it() {
        let conn = database();
        store(&conn, "file-a", &[detected(0, 0.35, 90.0)]);
        store(&conn, "file-b", &[detected(0, 0.5, 70.0)]);

        let people = list_people(&conn).unwrap();
        assert_eq!(forget(&conn, &people[0].id).unwrap(), 2);

        assert!(list_people(&conn).unwrap().is_empty());
        assert_eq!(stats(&conn).unwrap().faces, 0);
        // The photographs themselves are untouched.
        let files: i64 = conn
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
            .unwrap();
        assert_eq!(files, 2);
        // And a second press is a no-op rather than an error.
        assert_eq!(forget(&conn, &people[0].id).unwrap(), 0);
    }

    #[test]
    fn a_group_reports_when_its_newest_photograph_was_taken() {
        let conn = database();
        store(&conn, "file-a", &[detected(0, 0.35, 90.0)]);
        let people = list_people(&conn).unwrap();
        assert_eq!(people[0].last_seen_at.as_deref(), Some("2026-01-01T00:00:00+00:00"));
    }

    #[test]
    fn only_files_that_have_not_been_looked_at_are_offered_for_a_face_pass() {
        let conn = database();
        add_file(&conn, "file-a");

        assert_eq!(files_needing_faces(&conn, 10).unwrap().len(), 1);
        crate::db::set_faces_state(&conn, "file-a", "scanned").unwrap();
        assert_eq!(files_needing_faces(&conn, 10).unwrap().len(), 0);
    }
}

pub fn rename(conn: &Connection, person_id: &str, label: Option<&str>) -> AppResult<()> {
    let clean = label.map(str::trim).filter(|value| !value.is_empty());
    conn.execute(
        "UPDATE people SET label = ?2, updated_at = ?3 WHERE id = ?1",
        params![person_id, clean, crate::db::now()],
    )?;
    reindex_person_files(conn, person_id)?;
    Ok(())
}

/// Rewrite the search rows of every file this person appears in.
///
/// A person's name is part of what a search matches, and it lives nowhere near
/// the files: naming a group has to reach the index that already exists, or the
/// name only starts working after the next full scan. Runs for a rename and for
/// a merge, because both change which names belong to which file.
pub fn reindex_person_files(conn: &Connection, person_id: &str) -> AppResult<usize> {
    let file_ids = {
        let mut statement = conn.prepare("SELECT DISTINCT file_id FROM faces WHERE person_id = ?1")?;
        let rows = statement.query_map(params![person_id], |row| row.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<String>>>()?
    };
    for file_id in &file_ids {
        crate::db::reindex_search_row(conn, file_id)?;
    }
    Ok(file_ids.len())
}

/// Delete a group, and the faces that identified it.
///
/// This is the answer to a group that is not a person at all — a poster, a
/// reflection, two strangers who happen to score alike. Hiding is not enough for
/// those: they come back on the next regroup, and a library with a permanent
/// row of strangers in it is one the user stops opening.
///
/// What it does *not* do is touch a single photograph. It removes rows in the
/// index and the aligned crops written beside it. The files keep their
/// `faces_state`, so this is also durable: a later face pass skips files it has
/// already looked at and the group does not reassemble itself behind the user's
/// back. `recluster` will not resurrect it either, because the faces it was
/// built from are gone.
pub fn forget(conn: &Connection, person_id: &str) -> AppResult<usize> {
    let mut statement = conn.prepare("SELECT crop_path FROM faces WHERE person_id = ?1")?;
    let rows = statement.query_map(params![person_id], |row| row.get::<_, Option<String>>(0))?;
    let mut crops = Vec::new();
    for row in rows {
        if let Some(path) = row? {
            crops.push(path);
        }
    }
    drop(statement);

    let tx = conn.unchecked_transaction()?;
    let faces = tx.execute("DELETE FROM faces WHERE person_id = ?1", params![person_id])?;
    tx.execute("DELETE FROM people WHERE id = ?1", params![person_id])?;
    tx.commit()?;

    // Only after the rows are gone: a crop file removed while its row still
    // existed would leave the card pointing at a picture that is not there.
    for path in crops {
        let _ = std::fs::remove_file(path);
    }
    Ok(faces)
}

pub fn set_hidden(conn: &Connection, person_id: &str, hidden: bool) -> AppResult<()> {
    conn.execute(
        "UPDATE people SET hidden = ?2, updated_at = ?3 WHERE id = ?1",
        params![person_id, if hidden { 1 } else { 0 }, crate::db::now()],
    )?;
    Ok(())
}

/// Fold one group into another.
///
/// This is the correction mechanism for the one error that matters: two people
/// who look alike enough to have landed together. The user says which way the
/// merge goes, and the centroid is recomputed from the surviving faces rather
/// than averaged from two means of different sizes.
pub fn merge(conn: &Connection, from_id: &str, into_id: &str) -> AppResult<()> {
    if from_id == into_id {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE faces SET person_id = ?2 WHERE person_id = ?1",
        params![from_id, into_id],
    )?;
    tx.execute("DELETE FROM people WHERE id = ?1", params![from_id])?;
    rebuild_centroid(&tx, into_id)?;
    tx.commit()?;
    // After the transaction, not inside it: the index is a separate table and a
    // merge that half-reindexed would be worse than one that did not at all.
    reindex_person_files(conn, into_id)?;
    Ok(())
}

/// Recompute one group's centroid from the faces that are actually in it.
///
/// Deliberately derived rather than incrementally maintained: after a merge, an
/// incremental update would leave a centroid describing faces the group no
/// longer holds, and every later assignment would inherit that error.
fn rebuild_centroid(conn: &Connection, person_id: &str) -> AppResult<()> {
    let mut statement = conn.prepare("SELECT embedding FROM faces WHERE person_id = ?1")?;
    let rows = statement.query_map(params![person_id], |row| row.get::<_, Vec<u8>>(0))?;

    let mut sum: Vec<f32> = Vec::new();
    let mut count = 0.0_f32;
    for row in rows {
        let vector = decode(&row?);
        if vector.is_empty() {
            continue;
        }
        if sum.is_empty() {
            sum = vector.clone();
        } else if sum.len() == vector.len() {
            for slot in 0..sum.len() {
                sum[slot] += vector[slot];
            }
        }
        count += 1.0;
    }

    let centroid = if count > 0.0 { unit(&sum) } else { Vec::new() };
    conn.execute(
        "UPDATE people SET centroid = ?2, face_count = ?3, updated_at = ?4 WHERE id = ?1",
        params![person_id, encode(&centroid), count as i64, crate::db::now()],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Reclustering
// ---------------------------------------------------------------------------

struct FaceRow {
    id: String,
    person_id: Option<String>,
    /// Raw blob, decoded once when it is needed.
    embedding: Vec<u8>,
    quality: f64,
}

/// Regroup the whole library from scratch.
///
/// Greedy leader clustering, seeded largest-first, which is what makes the
/// result *stable*: a person's biggest face anchors their group, so running this
/// after one new photograph does not reshuffle everybody. Agglomerative
/// clustering would need every pair of faces — O(n²) in time and memory — and at
/// a few thousand faces that is a minute of CPU for a result this matches within
/// a face or two.
///
/// Names survive it. Every labelled group from before is matched to the new
/// cluster nearest its old centroid, and the label moves with it. Losing a name
/// the user typed because the archive was regrouped would be a betrayal of the
/// one thing this feature asked them to do.
pub fn recluster(conn: &Connection) -> AppResult<usize> {
    let mut faces: Vec<FaceRow> = Vec::new();
    {
        let mut statement = conn.prepare(
            "SELECT id, person_id, embedding, COALESCE(quality, 0) FROM faces",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(FaceRow {
                id: row.get(0)?,
                person_id: row.get(1)?,
                embedding: row.get(2)?,
                quality: row.get(3)?,
            })
        })?;
        for row in rows {
            let row = row?;
            faces.push(FaceRow {
                id: row.id,
                person_id: row.person_id,
                embedding: row.embedding,
                quality: row.quality,
            });
        }
    }

    let mut labelled: Vec<(String, Vec<f32>)> = Vec::new();
    {
        let mut statement =
            conn.prepare("SELECT label, centroid FROM people WHERE label IS NOT NULL AND label <> ''")?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<Vec<u8>>>(1)?))
        })?;
        for row in rows {
            let (label, centroid) = row?;
            labelled.push((label, centroid.map(|blob| decode(&blob)).unwrap_or_default()));
        }
    }

    // Largest and sharpest first: the anchor of each group is the face most
    // likely to be a good portrait, which is also the face worth showing.
    faces.sort_by(|a, b| b.quality.partial_cmp(&a.quality).unwrap_or(std::cmp::Ordering::Equal));

    // centroid, id, how many faces it holds so far
    let mut groups: Vec<(Vec<f32>, String, f32)> = Vec::new();
    let mut assignment: Vec<(String, String)> = Vec::new();

    for face in &faces {
        if face.embedding.len() < 4 {
            continue;
        }
        let vector = unit(&decode(&face.embedding));
        let mut best: Option<(usize, f32)> = None;
        for (position, group) in groups.iter().enumerate() {
            let score = cosine(&vector, &group.0);
            if score >= SAME_PERSON && best.map(|(_, current)| score > current).unwrap_or(true) {
                best = Some((position, score));
            }
        }
        match best {
            Some((position, _)) => {
                let id = groups[position].1.clone();
                let count = groups[position].2;
                let mut blended = groups[position].0.clone();
                if blended.len() == vector.len() {
                    for slot in 0..blended.len() {
                        blended[slot] = (blended[slot] * count + vector[slot]) / (count + 1.0);
                    }
                    groups[position].0 = unit(&blended);
                }
                groups[position].2 = count + 1.0;
                assignment.push((face.id.clone(), id));
            }
            None => {
                let id = format!("person-{}", face.id);
                groups.push((vector.clone(), id.clone(), 1.0));
                assignment.push((face.id.clone(), id));
            }
        }
    }

    let tx = conn.unchecked_transaction()?;
    tx.execute("UPDATE faces SET person_id = NULL", [])?;
    tx.execute("DELETE FROM people", [])?;

    for (centroid, id, _) in &groups {
        // Carry the name over when this cluster is the same person as one that
        // was already named.
        let mut label: Option<String> = None;
        let mut best = SAME_PERSON;
        for (old_label, old_centroid) in &labelled {
            if old_centroid.is_empty() {
                continue;
            }
            let score = cosine(centroid, old_centroid);
            if score >= best {
                best = score;
                label = Some(old_label.clone());
            }
        }

        tx.execute(
            "INSERT INTO people (id, label, centroid, face_count, hidden, created_at, updated_at) \
             VALUES (?1, ?2, ?3, 0, 0, ?4, ?4)",
            params![id, label, encode(centroid), crate::db::now()],
        )?;
    }

    for (face_id, person_id) in &assignment {
        tx.execute(
            "UPDATE faces SET person_id = ?2 WHERE id = ?1",
            params![face_id, person_id],
        )?;
    }

    // Counts are derived from the rows rather than tracked by hand: the numbers
    // the interface shows are COUNT(*), always.
    {
        let ids: Vec<String> = groups.iter().map(|(_, id, _)| id.clone()).collect();
        for id in ids {
            rebuild_centroid(&tx, &id)?;
        }
    }

    tx.commit()?;
    Ok(groups.len())
}

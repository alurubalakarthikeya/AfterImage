//! What a file appears to be, and why somebody might have kept it.
//!
//! Two things come out of this module, and both are deliberately modest:
//!
//! * **Tags** — a handful, not a cloud. A screenshot of a failing React build
//!   should carry `react`, `code`, `error`, `screenshot` and stop. Thirty tags
//!   describing every object the model could name is not a better index; it is
//!   an index where nothing is distinctive.
//! * **A context line** — "Possible context: Programming / React debugging".
//!   Note the word *possible*, in the interface and in the field's own name. This
//!   is an inference from what the file contains, and the application never
//!   claims to know why a person saved something. When there is no evidence the
//!   line is absent rather than generic-and-confident.
//!
//! Where the evidence comes from, in order of strength:
//!
//!     1. the local vision model's labels (a real classifier's opinion)
//!     2. the file's own extracted text (OCR or a PDF text layer)
//!     3. the filename and the kind the scan already assigned
//!
//! Everything here is a lookup over text the pipeline already has, so it costs
//! nothing, works on a machine with no model installed, and — unlike a model —
//! cannot produce a sentence that is not grounded in the file. The vision
//! labels are what make it more than keyword matching; this layer is what makes
//! the feature work today, and what keeps working when the model is absent.
//!
//! Nothing here reads or writes the archive: it takes the pieces the pipeline
//! has already gathered and returns two values.

use std::collections::BTreeSet;

/// The ceiling on machine-generated tags for one file.
///
/// Eight is the top of the range the feature is specified at. Labels from the
/// model are kept in the order the model ranked them, and derived tags fill in
/// behind them, so the cap removes the weakest evidence rather than a random
/// subset.
const MAX_TAGS: usize = 8;

/// Text signals, each with the tag it justifies.
///
/// The needles are matched case-insensitively against the file's extracted text
/// and then against its filename. They are written long enough to be evidence:
/// `=>` and `const ` are signs of JavaScript in a way that the word `import` is
/// not, because `import` appears in half the languages there are.
const SIGNALS: &[(&str, &[&str])] = &[
    // Languages and frameworks.
    ("react", &["react", "usestate", "useeffect", "usememo", "jsx", "next.js", "nextjs"]),
    ("typescript", &["typescript", "tsx", ": string", ": number", ": boolean", "interface i"]),
    (
        "javascript",
        &["javascript", "console.log", "=>", "const ", "let ", "document.getelementbyid"],
    ),
    ("python", &["python", "traceback (most recent call last)", "def ", "self.", "__init__", "pip install"]),
    ("rust", &["cargo", "unwrap()", "impl ", "&str", "fn main", "rustc"]),
    ("java", &["public static void", "system.out.print", "import java"]),
    ("sql", &["select ", "insert into", "update set", "left join", "create table"]),
    ("css", &["display: flex", "border-radius", "background-color", "margin:", "font-size"]),
    ("html", &["<!doctype html", "<div", "<html", "&lt;div"]),
    ("shell", &["$ ", "npm run", "yarn ", "git commit", "sudo ", "chmod ", "powershell"]),
    // What the file is doing.
    ("error", &["error", "exception", "traceback", "failed", "failure", "syntaxerror", "undefined is not", "panic", "stack trace"]),
    ("terminal", &["command prompt", "powershell", "bash$", "c:\\users", "~$", "zsh"]),
    ("code", &["function ", "class ", "return ", "const ", "def ", "import ", "package ", "module "]),
    ("receipt", &["receipt", "invoice", "subtotal", "total due", "vat", "amount paid", "order #"]),
    ("invoice", &["invoice number", "invoice date", "bill to", "purchase order"]),
    ("chart", &["chart", "graph", "axis", "legend", "% of"]),
    ("dashboard", &["dashboard", "analytics", "overview", "metrics", "kpi"]),
    ("login", &["sign in", "log in", "password", "forgot password", "two-factor"]),
    ("form", &["submit", "required field", "please enter", "first name", "last name"]),
    // Interfaces and artefacts.
    ("ui", &["button", "toolbar", "sidebar", "dropdown", "modal", "menu bar"]),
    ("design", &["figma", "mockup", "wireframe", "artboard", "prototype"]),
    ("presentation", &["slide", "agenda", "keynote", "powerpoint"]),
    ("spreadsheet", &["budget", "spreadsheet", "sheet1", "pivot table"]),
    ("recipe", &["recipe", "ingredients", "preheat", "tablespoon", "bake"]),
    ("ticket", &["boarding pass", "seat ", "gate ", "admits one", "booking reference"]),
];

/// Kinds that are worth naming as a tag in their own right.
///
/// `photo` is not: on a machine full of photographs it distinguishes nothing,
/// and every photograph already knows what it is. `screenshot`, `document`,
/// `video` and `design` do distinguish, because they are the buckets people
/// actually search by.
fn kind_tag(kind: &str) -> Option<&'static str> {
    match kind {
        "screenshot" => Some("screenshot"),
        "document" => Some("document"),
        "video" => Some("video"),
        "audio" => Some("audio"),
        "design" => Some("design"),
        "archive" => Some("archive"),
        _ => None,
    }
}

fn contains(haystack: &str, needle: &str) -> bool {
    // Cheap case-insensitive substring search without allocating a lowercase
    // copy of a 400 KB text extraction per needle.
    if needle.is_ascii() {
        haystack
            .as_bytes()
            .windows(needle.len())
            .any(|window| window.eq_ignore_ascii_case(needle.as_bytes()))
    } else {
        haystack.to_lowercase().contains(&needle.to_lowercase())
    }
}

/// The tags that belong on this file.
///
/// `labels` come from the vision model and lead the list. `text` is the file's
/// own extracted text when there is any. The result is deduplicated, lowercased
/// and capped at [`MAX_TAGS`].
pub fn derive_tags(kind: &str, name: &str, labels: &[String], text: Option<&str>) -> Vec<String> {
    let mut ordered: Vec<String> = Vec::new();
    let mut seen: BTreeSet<String> = BTreeSet::new();

    let push = |raw: &str, ordered: &mut Vec<String>, seen: &mut BTreeSet<String>| {
        let clean = raw.trim().trim_start_matches('#').to_lowercase();
        // One-word-ish, printable, and not so long that it is a sentence.
        if clean.is_empty() || clean.len() > 24 || !clean.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
            return;
        }
        if seen.insert(clean.clone()) {
            ordered.push(clean);
        }
    };

    for label in labels {
        push(label, &mut ordered, &mut seen);
    }

    let haystack = text.unwrap_or_default();
    // Text first: a stack trace is stronger evidence than a filename.
    for (tag, needles) in SIGNALS {
        if needles.iter().any(|needle| contains(haystack, needle)) {
            push(tag, &mut ordered, &mut seen);
        }
    }
    // Then the name, which is weaker but always available — a file called
    // `receipt-march.pdf` has said what it is even when nothing was extracted.
    let haystack = name;
    for (tag, needles) in SIGNALS {
        if needles.iter().any(|needle| contains(haystack, needle)) {
            push(tag, &mut ordered, &mut seen);
        }
    }

    if let Some(tag) = kind_tag(kind) {
        push(tag, &mut ordered, &mut seen);
    }

    ordered.truncate(MAX_TAGS);
    ordered
}

/// A short phrase for what this file appears to be for, or nothing.
///
/// Written as `Domain / detail`, which is how a person would say it out loud.
/// The interface prefixes it with "Possible context:", so the wording here is
/// descriptive rather than a claim.
pub fn infer(kind: &str, name: &str, labels: &[String], text: Option<&str>) -> Option<String> {
    let tags = derive_tags(kind, name, labels, text);
    if tags.is_empty() {
        return None;
    }

    let has = |wanted: &str| tags.iter().any(|tag| tag == wanted);

    // Programming is the case worth getting right, because it is the one where
    // the evidence is specific: a traceback names the domain and the situation.
    let language = [
        "react", "typescript", "javascript", "python", "rust", "java", "sql", "css", "html", "shell",
    ]
    .iter()
    .find(|tag| has(tag))
    .copied();

    let programming = has("code") || has("terminal") || has("error") || language.is_some();
    if programming {
        let detail = if has("error") && language.is_some() {
            format!("{} debugging", titlecase(language.unwrap_or_default()))
        } else if has("error") {
            "debugging".to_string()
        } else if language.is_some() {
            titlecase(language.unwrap_or_default())
        } else if has("terminal") {
            "terminal work".to_string()
        } else {
            "source code".to_string()
        };
        return Some(format!("Programming / {detail}"));
    }

    if has("receipt") || has("invoice") {
        return Some("Documents / Receipts and invoices".into());
    }
    if has("design") || (has("ui") && has("screenshot")) {
        return Some("Design / Interface references".into());
    }
    if has("presentation") {
        return Some("Documents / Presentations".into());
    }
    if has("spreadsheet") {
        return Some("Documents / Spreadsheets".into());
    }
    if has("recipe") {
        return Some("Reference / Recipes".into());
    }
    if has("ticket") {
        return Some("Documents / Travel and tickets".into());
    }

    // People, when the model named one. Grouped here rather than guessed at:
    // the face pipeline already knows which photographs have people in them,
    // and this line never claims to know *who*.
    if has("person") || has("portrait") || has("selfie") || has("group") {
        return Some("People / Photographs".into());
    }

    if has("chart") || has("dashboard") {
        return Some("Work / Charts and dashboards".into());
    }

    // Games are a bucket people search by name, and the model's own label is
    // what puts a file here.
    if has("game") {
        return Some(
            if kind == "screenshot" {
                "Games / Screenshots"
            } else {
                "Games / Captures"
            }
            .into(),
        );
    }

    // Subjects the model named, grouped the way somebody would describe them.
    if has("food") || has("drink") {
        return Some("Photographs / Food and drink".into());
    }
    if has("animal") || has("dog") || has("cat") || has("bird") {
        return Some("Photographs / Animals".into());
    }
    if has("outdoors")
        || has("nature")
        || has("beach")
        || has("mountain")
        || has("city")
        || has("sky")
        || has("night")
        || has("plant")
        || has("sports")
    {
        return Some("Photographs / Outdoors and travel".into());
    }
    if has("vehicle") || has("building") || has("furniture") || has("clothing") || has("product") {
        return Some("Photographs / Objects".into());
    }
    if has("art") || has("logo") {
        return Some("Design / Artwork".into());
    }
    if has("text") {
        return Some("Documents / Text".into());
    }

    // Nothing specific beyond the kind. A generic true statement is worth more
    // than a specific guess, and for a photograph even that is not worth
    // printing — "Photographs" tells the user nothing the tile has not already.
    match kind_tag(kind) {
        Some("screenshot") => Some("Screenshots".into()),
        Some("document") => Some("Documents".into()),
        Some("video") => Some("Video".into()),
        Some("audio") => Some("Audio".into()),
        Some("design") => Some("Design / Interface references".into()),
        _ => None,
    }
}

fn titlecase(value: &str) -> String {
    let mut characters = value.chars();
    match characters.next() {
        Some(first) => format!("{}{}", first.to_uppercase(), characters.as_str()),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(items: &[&str]) -> Vec<String> {
        items.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn a_traceback_reads_as_python_debugging() {
        let text = "Traceback (most recent call last):\n  File \"app.py\", line 42\nValueError: bad input";
        let tags = derive_tags("screenshot", "Screenshot_2026-09-21.png", &[], Some(text));
        assert!(tags.contains(&"python".to_string()), "{tags:?}");
        assert!(tags.contains(&"error".to_string()), "{tags:?}");
        assert!(tags.contains(&"screenshot".to_string()), "{tags:?}");
        assert_eq!(
            infer("screenshot", "Screenshot_2026-09-21.png", &[], Some(text)).as_deref(),
            Some("Programming / Python debugging")
        );
    }

    #[test]
    fn the_models_labels_lead_and_the_cap_is_respected() {
        let labels = labels(&[
            "code", "terminal", "error", "screenshot", "ui", "design", "chart", "page", "extra",
        ]);
        let tags = derive_tags("screenshot", "shot.png", &labels, None);
        assert_eq!(tags.len(), MAX_TAGS, "{tags:?}");
        // The model's own ranking survives the cap.
        assert_eq!(tags[0], "code");
    }

    #[test]
    fn a_filename_alone_can_justify_a_tag() {
        let tags = derive_tags("document", "receipt-march.pdf", &[], None);
        assert!(tags.contains(&"receipt".to_string()), "{tags:?}");
        assert!(tags.contains(&"document".to_string()), "{tags:?}");
        assert_eq!(
            infer("document", "receipt-march.pdf", &[], None).as_deref(),
            Some("Documents / Receipts and invoices")
        );
    }

    #[test]
    fn a_plain_photograph_gets_a_kind_and_no_invented_reason() {
        // No labels, no text, an unremarkable name: the honest answer is that
        // nothing can be said about why it was kept.
        let tags = derive_tags("photo", "IMG_4021.jpg", &[], None);
        assert!(tags.is_empty(), "{tags:?}");
        assert_eq!(infer("photo", "IMG_4021.jpg", &[], None), None);
    }

    #[test]
    fn a_photograph_the_model_recognised_gets_its_labels_and_no_traceback() {
        let labels = labels(&["dog", "outdoors", "nature"]);
        let tags = derive_tags("photo", "IMG_4021.jpg", &labels, None);
        assert_eq!(tags, vec!["dog", "outdoors", "nature"]);
        assert_eq!(
            infer("photo", "IMG_4021.jpg", &labels, None).as_deref(),
            Some("Photographs / Animals"),
        );
    }

    #[test]
    fn a_game_screenshot_is_filed_as_one() {
        let labels = labels(&["game", "screenshot"]);
        assert_eq!(
            infer("screenshot", "shot.png", &labels, None).as_deref(),
            Some("Games / Screenshots"),
        );
    }

    #[test]
    fn tags_are_never_sentences_or_punctuation() {
        let labels = labels(&["A very long descriptive label that is a sentence", "", "#React", "!!!"]);
        let tags = derive_tags("photo", "x.jpg", &labels, None);
        assert_eq!(tags, vec!["react".to_string()], "{tags:?}");
    }
}

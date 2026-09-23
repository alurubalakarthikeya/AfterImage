//! Image DNA.
//!
//! What a picture is made of, measured on this machine from its own pixels:
//! the colours that cover it, how bright and how contrasty it is, how much
//! detail is in focus, and whether it leans warm or cool.
//!
//! Two rules, both inherited from the rest of the archive:
//!
//!   * Everything here is computed from the file the user owns. No model is
//!     consulted, nothing leaves the process, and a machine with no indexer
//!     installed gets exactly the same answers as one with every model.
//!   * A number that cannot be measured is not reported. A picture that will
//!     not decode yields an error, and the interface shows the facts the scan
//!     already knew rather than a row of plausible-looking defaults.
//!
//! The measurement runs on one decode at a reduced size — 320px on the longest
//! edge — because a palette and a contrast figure are properties of the picture,
//! not of its resolution, and decoding a 12 MP original to learn them would cost
//! a second of CPU on every open.

use std::collections::HashMap;
use std::path::Path;

use image::{DynamicImage, GenericImageView};

use crate::models::DnaColor;

/// Longest edge the measurement is taken at.
const ANALYSIS_EDGE: u32 = 320;

/// How many colours the palette may hold.
pub const PALETTE_SIZE: usize = 6;

/// Two candidate colours closer than this in RGB distance are the same colour
/// and are merged, which is what keeps a gradient from filling the palette.
const MERGE_DISTANCE: f64 = 72.0;

/// Largest buckets examined when seeding the palette, biggest first.
const CANDIDATES: usize = 400;

/// A colour has to cover this much of the picture to be worth a slot.
const MINIMUM_SHARE: f64 = 0.005;

/// Laplacian variance that counts as "visibly crisp". Laplacian variance is
/// unbounded, so it is mapped through this reference to land on 0..1.
const SHARPNESS_REFERENCE: f64 = 600.0;

/// Chroma above this reads as warm rather than neutral, and below the negative
/// of it as cool. Roughly the point where a person would name the cast.
const TEMPERATURE_THRESHOLD: f64 = 0.04;

#[derive(Debug, Clone)]
pub struct Analysis {
    pub palette: Vec<DnaColor>,
    /// Mean luma, 0..1.
    pub brightness: f64,
    /// Standard deviation of luma, 0..1.
    pub contrast: f64,
    /// Edge energy, normalised 0..1.
    pub sharpness: f64,
    /// Mean chroma, 0..1.
    pub saturation: f64,
    /// Red minus blue, -1..1.
    pub temperature_shift: f64,
}

impl Analysis {
    /// The word for the colour cast, when the number is far enough from centre
    /// to name. `None` in the middle band, where neither word is true.
    pub fn temperature(&self) -> &'static str {
        if self.temperature_shift > TEMPERATURE_THRESHOLD {
            "warm"
        } else if self.temperature_shift < -TEMPERATURE_THRESHOLD {
            "cool"
        } else {
            "neutral"
        }
    }
}

/// Measure one picture from disk.
///
/// The error is a sentence for the interface, not a panic and not a default.
pub fn analyse(path: &Path) -> Result<Analysis, String> {
    let decoded = image::open(path).map_err(|error| describe(&error))?;
    Ok(measure(&decoded))
}

fn describe(error: &image::ImageError) -> String {
    use image::ImageError;
    match error {
        ImageError::Unsupported(_) => "This format cannot be decoded on this machine".to_string(),
        ImageError::Decoding(_) => "The picture could not be decoded".to_string(),
        ImageError::IoError(io) if io.kind() == std::io::ErrorKind::NotFound => {
            "The file is no longer on disk".to_string()
        }
        _ => "The picture could not be read".to_string(),
    }
}

/// A small copy to measure, shrunk only when there is something to shrink.
///
/// `thumbnail` is a downscaler: asked to fit a picture *smaller* than the box
/// it pads what it did not read, which would put black into the palette and
/// contrast into a flat photograph. A picture that is already small is measured
/// as it is.
fn downsample(decoded: &DynamicImage) -> DynamicImage {
    let (width, height) = decoded.dimensions();
    if width <= ANALYSIS_EDGE && height <= ANALYSIS_EDGE {
        return decoded.clone();
    }
    decoded.resize_exact(
        ANALYSIS_EDGE.min(width),
        ANALYSIS_EDGE.min(height),
        image::imageops::FilterType::Triangle,
    )
}

/// Measure an already-decoded picture.
pub fn measure(decoded: &DynamicImage) -> Analysis {
    let small = downsample(decoded);
    let pixels: Vec<[u8; 3]> = small.to_rgb8().pixels().map(|pixel| pixel.0).collect();
    let total = pixels.len().max(1) as f64;

    let mut sum_luma = 0.0;
    let mut sum_chroma = 0.0;
    let mut sum_shift = 0.0;
    let mut luma: Vec<f64> = Vec::with_capacity(pixels.len());

    for pixel in &pixels {
        let [red, green, blue] = *pixel;
        // Rec. 709 luma: what the eye actually takes from a colour.
        let value = 0.2126 * red as f64 + 0.7152 * green as f64 + 0.0722 * blue as f64;
        luma.push(value);
        sum_luma += value;

        let high = red.max(green).max(blue) as f64;
        let low = red.min(green).min(blue) as f64;
        sum_chroma += if high > 0.0 { (high - low) / high } else { 0.0 };
        sum_shift += red as f64 - blue as f64;
    }

    let mean = sum_luma / total;
    let variance = luma
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / total;

    Analysis {
        palette: palette_from(&pixels),
        brightness: (mean / 255.0).clamp(0.0, 1.0),
        contrast: (variance.sqrt() / 255.0).clamp(0.0, 1.0),
        sharpness: sharpness(&small),
        saturation: (sum_chroma / total).clamp(0.0, 1.0),
        temperature_shift: (sum_shift / total / 255.0).clamp(-1.0, 1.0),
    }
}

/// The colours that cover the picture, most-covered first.
///
/// Seeded from a coarse histogram and finished with one k-means step, so the
/// colour reported is the true average of the pixels behind it rather than the
/// middle of a quantisation bucket — which is the difference between a swatch
/// that matches the photograph and one that is visibly a few percent off.
fn palette_from(pixels: &[[u8; 3]]) -> Vec<DnaColor> {
    if pixels.is_empty() {
        return Vec::new();
    }

    let mut histogram: HashMap<u16, u32> = HashMap::new();
    for pixel in pixels {
        *histogram.entry(bucket_key(*pixel)).or_insert(0) += 1;
    }

    let mut buckets: Vec<(u16, u32)> = histogram.into_iter().collect();
    buckets.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));

    let mut centres: Vec<[f64; 3]> = Vec::with_capacity(PALETTE_SIZE);
    for (key, _) in buckets.into_iter().take(CANDIDATES) {
        let centre = bucket_centre(key);
        if centres
            .iter()
            .any(|taken| distance(*taken, centre) < MERGE_DISTANCE)
        {
            continue;
        }
        centres.push(centre);
        if centres.len() == PALETTE_SIZE {
            break;
        }
    }
    if centres.is_empty() {
        return Vec::new();
    }

    // One assignment pass, then the real mean of each cluster.
    let mut sums = vec![[0.0f64; 3]; centres.len()];
    let mut counts = vec![0.0f64; centres.len()];
    for pixel in pixels {
        let point = [pixel[0] as f64, pixel[1] as f64, pixel[2] as f64];
        let mut best = 0usize;
        let mut best_distance = f64::MAX;
        for (index, centre) in centres.iter().enumerate() {
            let candidate = distance(*centre, point);
            if candidate < best_distance {
                best_distance = candidate;
                best = index;
            }
        }
        for channel in 0..3 {
            sums[best][channel] += point[channel];
        }
        counts[best] += 1.0;
    }

    let total = pixels.len() as f64;
    let mut palette: Vec<DnaColor> = sums
        .iter()
        .zip(counts.iter())
        .filter(|(_, count)| **count > 0.0)
        .map(|(sum, count)| {
            let red = (sum[0] / count).round().clamp(0.0, 255.0) as u8;
            let green = (sum[1] / count).round().clamp(0.0, 255.0) as u8;
            let blue = (sum[2] / count).round().clamp(0.0, 255.0) as u8;
            DnaColor {
                hex: format!("#{red:02X}{green:02X}{blue:02X}"),
                red,
                green,
                blue,
                share: count / total,
            }
        })
        .filter(|color| color.share >= MINIMUM_SHARE && color.share <= 1.0)
        .collect();

    palette.sort_by(|a, b| {
        b.share
            .partial_cmp(&a.share)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    palette
}

/// Detail in focus, from the variance of the Laplacian response.
///
/// This is the standard blur metric: a sharp edge leaves a large response, a
/// blurred one leaves almost none, and the variance of those responses over the
/// picture separates the two without needing a reference image.
fn sharpness(image: &DynamicImage) -> f64 {
    let gray = image.to_luma8();
    let (width, height) = gray.dimensions();
    if width < 3 || height < 3 {
        return 0.0;
    }

    let mut sum = 0.0;
    let mut sum_squares = 0.0;
    let mut count = 0.0;
    for y in 1..height - 1 {
        for x in 1..width - 1 {
            let centre = gray.get_pixel(x, y)[0] as f64;
            let neighbours = gray.get_pixel(x - 1, y)[0] as f64
                + gray.get_pixel(x + 1, y)[0] as f64
                + gray.get_pixel(x, y - 1)[0] as f64
                + gray.get_pixel(x, y + 1)[0] as f64;
            let response = 4.0 * centre - neighbours;
            sum += response;
            sum_squares += response * response;
            count += 1.0;
        }
    }
    if count == 0.0 {
        return 0.0;
    }

    let mean = sum / count;
    let variance = (sum_squares / count - mean * mean).max(0.0);
    (1.0 - (-variance / SHARPNESS_REFERENCE).exp()).clamp(0.0, 1.0)
}

/// Four bits per channel: 4096 buckets.
fn bucket_key(pixel: [u8; 3]) -> u16 {
    (((pixel[0] >> 4) as u16) << 8) | (((pixel[1] >> 4) as u16) << 4) | ((pixel[2] >> 4) as u16)
}

fn bucket_centre(key: u16) -> [f64; 3] {
    [
        (((key >> 8) & 0xF) as f64) * 17.0,
        (((key >> 4) & 0xF) as f64) * 17.0,
        ((key & 0xF) as f64) * 17.0,
    ]
}

fn distance(a: [f64; 3], b: [f64; 3]) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, Rgb, RgbImage};

    fn bands(colours: &[[u8; 3]]) -> DynamicImage {
        let width = 96u32;
        let height = 96u32;
        let band = width / colours.len() as u32;
        let mut image = RgbImage::new(width, height);
        for (index, colour) in colours.iter().enumerate() {
            for x in index as u32 * band..(index as u32 + 1) * band {
                for y in 0..height {
                    image.put_pixel(x, y, Rgb(*colour));
                }
            }
        }
        DynamicImage::ImageRgb8(image)
    }

    #[test]
    fn a_flat_grey_picture_reports_one_colour_and_no_contrast() {
        let gray = DynamicImage::ImageRgb8(RgbImage::from_pixel(96, 96, Rgb([128, 128, 128])));
        let analysis = measure(&gray);

        assert!(analysis.contrast.abs() < 1e-6, "flat picture has no contrast");
        assert!(analysis.saturation.abs() < 1e-6, "grey has no chroma");
        assert!(analysis.temperature_shift.abs() < 1e-6, "grey has no cast");
        assert!((analysis.brightness - 0.502).abs() < 0.01);
        assert!(analysis.sharpness < 0.01, "a flat picture has no detail");

        assert_eq!(analysis.palette.len(), 1);
        // The exact mean of the pixels, not the middle of a quantisation bucket.
        assert_eq!(analysis.palette[0].hex, "#808080");
        assert!((analysis.palette[0].share - 1.0).abs() < 1e-9);
        assert_eq!(analysis.temperature(), "neutral");
    }

    #[test]
    fn three_bands_become_three_colours_of_equal_share() {
        let image = bands(&[[255, 0, 0], [0, 255, 0], [0, 0, 255]]);
        let analysis = measure(&image);

        assert_eq!(analysis.palette.len(), 3);
        for color in &analysis.palette {
            assert!(
                (color.share - 1.0 / 3.0).abs() < 0.02,
                "each band covers a third, got {}",
                color.share
            );
        }

        let hexes: Vec<&str> = analysis.palette.iter().map(|color| color.hex.as_str()).collect();
        assert!(hexes.contains(&"#FF0000"), "red band missing from {hexes:?}");
        assert!(hexes.contains(&"#00FF00"), "green band missing from {hexes:?}");
        assert!(hexes.contains(&"#0000FF"), "blue band missing from {hexes:?}");
    }

    #[test]
    fn a_red_cast_reads_warm_and_a_blue_one_reads_cool() {
        let warm = measure(&DynamicImage::ImageRgb8(RgbImage::from_pixel(
            48,
            48,
            Rgb([180, 90, 70]),
        )));
        let cool = measure(&DynamicImage::ImageRgb8(RgbImage::from_pixel(
            48,
            48,
            Rgb([70, 90, 180]),
        )));

        assert_eq!(warm.temperature(), "warm");
        assert!((warm.temperature_shift - (180.0 - 70.0) / 255.0).abs() < 1e-6);
        assert_eq!(cool.temperature(), "cool");
    }

    #[test]
    fn hard_edges_score_higher_than_a_blurred_picture() {
        let sharp = bands(&[[0, 0, 0], [255, 255, 255]]);
        let blurred = measure(&sharp).sharpness;
        let flat = measure(&DynamicImage::ImageRgb8(RgbImage::from_pixel(
            96,
            96,
            Rgb([120, 120, 120]),
        )))
        .sharpness;

        assert!(blurred > flat);
        assert!(blurred > 0.05, "an edge should register detail, got {blurred}");
    }
}

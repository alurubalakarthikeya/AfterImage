"""Measure what the tagging pipeline actually produces.

Run it against a folder of pictures to answer the questions a tag list is
supposed to answer:

  * Are two unrelated pictures given the same tags?
  * How many files come back with nothing?
  * How much of each label list is a container word with no retrieval value?
  * What does one file cost in time?

It prints aggregates only — never filenames or descriptions — so a run against a
personal photo library is safe to paste into a report.

    python eval_tags.py --dir "C:/path/to/pictures" --limit 40

Exit status is 1 when the sample looks unhealthy (most files sharing one tag set,
or a large share of empty results), so it can be used as a release gate.
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
import time
from pathlib import Path

from app import describe, tagging

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"}


def collect(root: Path, limit: int) -> list[Path]:
    files: list[Path] = []
    for path in sorted(root.rglob("*")):
        if path.suffix.lower() in IMAGE_SUFFIXES and path.is_file():
            files.append(path)
            if len(files) >= limit:
                break
    return files


def evaluate(paths: list[Path]) -> dict[str, object]:
    tag_sets: list[tuple[str, ...]] = []
    counts: collections.Counter[str] = collections.Counter()
    times: list[float] = []
    empty = 0

    for path in paths:
        started = time.perf_counter()
        labels, _scores, _category = describe.classify_labels(str(path), "photo")
        times.append((time.perf_counter() - started) * 1000)
        if not labels:
            empty += 1
        tag_sets.append(tuple(labels))
        counts.update(labels)

    total = max(len(paths), 1)
    identical = collections.Counter(tag_sets).most_common(1)
    generic = sum(1 for labels in tag_sets if labels and set(labels) <= tagging.GENERIC)
    return {
        "files": len(paths),
        "empty": empty,
        "empty_share": round(empty / total, 3),
        "distinct_sets": len(set(tag_sets)),
        "distinct_share": round(len(set(tag_sets)) / total, 3),
        "unique_tags": len(counts),
        "mean_labels": round(sum(len(labels) for labels in tag_sets) / total, 2),
        "generic_only": generic,
        "most_common_set": list(identical[0][0]) if identical else [],
        "most_common_count": identical[0][1] if identical else 0,
        "top_tags": counts.most_common(10),
        "latency_ms": {
            "mean": round(sum(times) / total),
            "median": round(sorted(times)[len(times) // 2]),
            "max": round(max(times)),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", required=True, help="folder of pictures to evaluate")
    parser.add_argument("--limit", type=int, default=40)
    parser.add_argument("--json", action="store_true", help="print the report as JSON")
    arguments = parser.parse_args()

    root = Path(arguments.dir).expanduser()
    if not root.is_dir():
        print(f"not a folder: {root}", file=sys.stderr)
        return 2

    paths = collect(root, arguments.limit)
    if not paths:
        print("no images found", file=sys.stderr)
        return 2

    report = evaluate(paths)
    if arguments.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"files                 {report['files']}")
        print(f"no tags               {report['empty']} ({report['empty_share']:.0%})")
        print(f"distinct tag sets     {report['distinct_sets']} ({report['distinct_share']:.0%})")
        print(f"unique tags           {report['unique_tags']}")
        print(f"labels per file       {report['mean_labels']}")
        print(f"generic-only results  {report['generic_only']}")
        print(f"most common set       {report['most_common_set']} x {report['most_common_count']}")
        print(f"top tags              {report['top_tags']}")
        print(f"latency               {report['latency_ms']}")

    # The failure this suite exists to catch: a library where the same words
    # land on everything. A single tag set covering most of the sample, or more
    # than a third of files with nothing, is not a working classifier.
    unhealthy = (
        report["most_common_count"] > max(4, report["files"] // 2)
        or report["empty_share"] > 0.34
        or report["distinct_share"] < 0.4
    )
    return 1 if unhealthy else 0


if __name__ == "__main__":
    raise SystemExit(main())

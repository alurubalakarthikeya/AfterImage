"""Packaged entry point for the local indexer.

`npm run service:dev` runs the FastAPI app through uvicorn directly. This module
exists for the packaged case: PyInstaller freezes it into a single executable
(`afterimage-indexer`) that the desktop application starts and stops itself, so
nobody has to have Python, pip or a virtual environment installed to use OCR and
similarity search.

    afterimage-indexer --host 127.0.0.1 --port 8765

Everything it serves is still loopback-only; the desktop shell is the only
client, and the shell is what starts it.
"""

from __future__ import annotations

import argparse
import sys


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="afterimage-indexer")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--log-level", default="info")
    parser.add_argument("--diagnose", action="store_true")
    parser.add_argument("--diagnose-image", default=None)
    return parser.parse_args(argv)


def diagnose(image: str | None) -> int:
    """Report, step by step, whether the frozen bundle can run inference.

    A segfault in a packaged build leaves no traceback, so the only way to find
    which native library is responsible is to print a line before each step and
    see which one is the last. This runs the same code the routes run, in the
    same process, and exits — no server, no port.
    """
    print("1/4 importing the application", flush=True)
    from app import vision

    print("2/4 checking model bundles", flush=True)
    print(f"    vision available: {vision.available()}", flush=True)
    if not image:
        print("3/4 skipped (no --diagnose-image)", flush=True)
        print("4/4 done", flush=True)
        return 0

    print("3/4 encoding the image through ONNX Runtime", flush=True)
    vector = vision.encode_image(image)
    print(f"    vector: {'none' if vector is None else len(vector)}", flush=True)

    print("4/4 encoding text and classifying", flush=True)
    scores = vision.classify(image, {"logo": "a logo or icon", "photo": "a photograph"})
    print(f"    scores: {scores}", flush=True)
    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(list(sys.argv[1:] if argv is None else argv))

    if args.diagnose:
        return diagnose(args.diagnose_image)

    import uvicorn

    from app.main import app

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level=args.log_level,
        access_log=False,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

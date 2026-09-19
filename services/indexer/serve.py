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
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(list(sys.argv[1:] if argv is None else argv))

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

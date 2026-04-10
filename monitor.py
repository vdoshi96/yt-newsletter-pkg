"""
Compatibility entrypoint from the repo root (`python monitor.py …`).
Prefer: pip install -e . && yt-newsletter …
"""

from pathlib import Path
import sys

_SRC = Path(__file__).resolve().parent / "src"
if _SRC.is_dir():
    sys.path.insert(0, str(_SRC))

from yt_newsletter.monitor import main  # noqa: E402

if __name__ == "__main__":
    main()

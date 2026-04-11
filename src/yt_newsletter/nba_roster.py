"""
Fetch active NBA player → team abbreviations from stats.nba.com (official NBA Stats API).
Cached in-process for several hours to avoid hammering the API.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

_CACHE: dict[str, object | None] = {"text": None, "exp": 0.0}
_TTL = 6 * 3600.0

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.nba.com/",
    "Origin": "https://www.nba.com",
}


def nba_season_id(when: datetime | None = None) -> str:
    """e.g. April 2026 -> 2025-26."""
    when = when or datetime.now(timezone.utc)
    y, m = when.year, when.month
    start = y if m >= 10 else y - 1
    yy = str(start + 1)[-2:]
    return f"{start}-{yy}"


def _parse_roster_text(payload: dict) -> str | None:
    try:
        rs = payload["resultSets"][0]
        headers = rs["headers"]
        rows = rs["rowSet"]
    except (KeyError, IndexError, TypeError):
        return None
    try:
        name_i = headers.index("DISPLAY_FIRST_LAST")
        team_i = headers.index("TEAM_ABBREVIATION")
    except ValueError:
        return None
    lines: list[str] = []
    for row in rows:
        if not isinstance(row, (list, tuple)) or len(row) <= max(name_i, team_i):
            continue
        name = row[name_i]
        team = row[team_i]
        if not isinstance(name, str) or not name.strip():
            continue
        abbr = team.strip() if isinstance(team, str) and team.strip() else "—"
        lines.append(f"{name} — {abbr}")
    lines.sort()
    return "\n".join(lines)


def fetch_nba_roster_lines(log) -> str | None:
    """Return roster text for the prompt, or None if skipped/failed."""
    if os.environ.get("SKIP_NBA_ROSTER", "").strip() == "1":
        return None

    now = time.time()
    if _CACHE["text"] is not None and now < float(_CACHE["exp"]):
        return str(_CACHE["text"])

    season = os.environ.get("NBA_SEASON_ID", "").strip() or nba_season_id()
    url = (
        "https://stats.nba.com/stats/commonallplayers?"
        f"LeagueID=00&Season={season}&IsOnlyCurrentSeason=1"
    )
    req = urllib.request.Request(url, headers=_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            payload = json.loads(resp.read().decode())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        log.warning("NBA roster fetch failed: %s", e)
        return None

    text = _parse_roster_text(payload)
    if not text:
        log.warning("NBA roster parse returned empty")
        return None

    _CACHE["text"] = text
    _CACHE["exp"] = now + _TTL
    return text


def roster_prompt_section(lines: str | None) -> str:
    if not lines:
        return (
            "[Official NBA roster list unavailable — assign teams from the transcript only; "
            "use TBD if unclear.]"
        )
    return lines

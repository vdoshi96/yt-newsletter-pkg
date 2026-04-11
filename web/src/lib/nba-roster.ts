/**
 * Active player → team abbreviations from the official NBA Stats API
 * (stats.nba.com — same data NBA.com uses). Cached in-memory to limit requests.
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let cache: { text: string; expires: number } | null = null;

/** e.g. April 2026 → 2025-26 (season spans Oct–Jun). */
export function nbaSeasonId(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const startYear = m >= 10 ? y : y - 1;
  const yy = String(startYear + 1).slice(-2);
  return `${startYear}-${yy}`;
}

const NBA_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
};

type CommonAllPlayersJson = {
  resultSets?: Array<{
    headers?: string[];
    rowSet?: unknown[][];
  }>;
};

function parseRosterText(data: CommonAllPlayersJson): string | null {
  const rs = data.resultSets?.[0];
  if (!rs?.headers || !rs.rowSet?.length) return null;
  const headers = rs.headers;
  const nameIdx = headers.indexOf("DISPLAY_FIRST_LAST");
  const teamIdx = headers.indexOf("TEAM_ABBREVIATION");
  if (nameIdx < 0 || teamIdx < 0) return null;

  const lines: string[] = [];
  for (const row of rs.rowSet) {
    if (!Array.isArray(row)) continue;
    const name = row[nameIdx];
    const team = row[teamIdx];
    if (typeof name !== "string" || !name.trim()) continue;
    const abbr =
      typeof team === "string" && team.trim() ? team.trim() : "—";
    lines.push(`${name} — ${abbr}`);
  }
  lines.sort((a, b) => a.localeCompare(b));
  return lines.join("\n");
}

/**
 * Returns a large text block suitable for the Gemini prompt, or null if skipped/failed.
 */
export async function fetchNbaRosterLinesForPrompt(): Promise<string | null> {
  if (process.env.SKIP_NBA_ROSTER === "1") return null;

  const now = Date.now();
  if (cache && now < cache.expires) {
    return cache.text;
  }

  const season = process.env.NBA_SEASON_ID?.trim() || nbaSeasonId();
  const url = `https://stats.nba.com/stats/commonallplayers?LeagueID=00&Season=${encodeURIComponent(
    season
  )}&IsOnlyCurrentSeason=1`;

  try {
    const res = await fetch(url, { headers: NBA_HEADERS, next: { revalidate: 0 } });
    if (!res.ok) return null;
    const data = (await res.json()) as CommonAllPlayersJson;
    const text = parseRosterText(data);
    if (!text) return null;
    cache = { text, expires: now + CACHE_TTL_MS };
    return text;
  } catch {
    return null;
  }
}

export function rosterPromptSection(lines: string | null): string {
  if (!lines || !lines.trim()) {
    return "[Official NBA roster list unavailable — assign teams from the transcript only; use TBD if unclear.]";
  }
  return lines;
}

import { GoogleGenerativeAI } from "@google/generative-ai";
import nodemailer from "nodemailer";
import { YoutubeTranscript } from "youtube-transcript";
import { prisma } from "@/lib/prisma";

export const ANALYSIS_PROMPT = `You are a fantasy basketball analyst. Analyze this YouTube video transcript and extract every NBA player mentioned with a recommendation.

For each player, determine the SINGLE best category:
- MUST ADD: Drop everything, pick this player up immediately
- STREAM: Worth streaming for the next few games
- WATCH: Not actionable yet but monitor closely  
- BUY LOW: Trade for this player while their value is depressed
- SELL HIGH: Trade this player away while their value is inflated
- HOLD: Keep if you have them, don't chase
- DROP: Cut this player

Respond ONLY with valid JSON in this exact format, no markdown fences:
{
  "video_title": "title from context",
  "players": [
    {
      "name": "Player Name",
      "team": "NBA Team Abbreviation",
      "category": "MUST ADD",
      "reason": "One sentence why"
    }
  ],
  "key_takeaways": ["takeaway 1", "takeaway 2", "takeaway 3"],
  "timestamp": "when this analysis is relevant (e.g., Week 12, or date range)"
}

Video title: {title}
Channel: {channel}
Transcript:
{transcript}`;

export type AnalysisPayload = {
  video_title?: string;
  players: Array<{
    name: string;
    team?: string;
    category: string;
    reason?: string;
  }>;
  key_takeaways?: string[];
  timestamp?: string;
  _channel?: string;
  _video_id?: string;
  _processed_at?: string;
  _video_url?: string;
};

const CATEGORY_COLORS: Record<string, string> = {
  "MUST ADD": "#22c55e",
  STREAM: "#3b82f6",
  WATCH: "#a855f7",
  "BUY LOW": "#f59e0b",
  "SELL HIGH": "#ef4444",
  HOLD: "#6b7280",
  DROP: "#dc2626",
};

function mailTransport() {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.EMAIL_FROM;
  const pass = process.env.EMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export function mailConfigured(): boolean {
  return Boolean(
    process.env.EMAIL_FROM &&
      process.env.EMAIL_TO &&
      process.env.EMAIL_APP_PASSWORD
  );
}

export async function getTranscript(
  videoId: string,
  maxRetries = 2
): Promise<string | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const chunks = await YoutubeTranscript.fetchTranscript(videoId);
      return chunks.map((c) => c.text).join(" ");
    } catch {
      const waitMs = Math.min(5000 * (attempt + 1), 15000);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  return null;
}

function stripJsonFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    const lines = t.split("\n");
    lines.shift();
    t = lines.join("\n");
  }
  t = t.replace(/\n```[a-z]*\s*$/i, "").trim();
  if (t.endsWith("```")) {
    t = t.replace(/```\s*$/, "").trim();
  }
  return t;
}

export async function analyzeWithGemini(
  title: string,
  channel: string,
  transcript: string
): Promise<AnalysisPayload> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const prompt = ANALYSIS_PROMPT.replace("{title}", title)
    .replace("{channel}", channel)
    .replace("{transcript}", transcript.slice(0, 80_000));

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const cleaned = stripJsonFences(text);
  return JSON.parse(cleaned) as AnalysisPayload;
}

export function buildEmailHtml(
  analysis: AnalysisPayload,
  videoUrl: string,
  channelName: string
): string {
  const players = analysis.players ?? [];
  const takeaways = analysis.key_takeaways ?? [];
  const title = analysis.video_title ?? "New Video";
  const grouped: Record<string, typeof players> = {};
  for (const p of players) {
    const cat = p.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(p);
  }
  const order = [
    "MUST ADD",
    "STREAM",
    "BUY LOW",
    "WATCH",
    "SELL HIGH",
    "HOLD",
    "DROP",
  ];
  let rows = "";
  for (const cat of order) {
    if (!grouped[cat]) continue;
    for (const p of grouped[cat]) {
      const color = CATEGORY_COLORS[cat] ?? "#6b7280";
      rows += `
            <tr>
                <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600">${escapeHtml(p.name)}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280">${escapeHtml(p.team ?? "")}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">
                    <span style="background:${color};color:white;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700">${escapeHtml(cat)}</span>
                </td>
                <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px">${escapeHtml(p.reason ?? "")}</td>
            </tr>`;
    }
  }
  const takeawayHtml = takeaways
    .map((t) => `<li style='margin-bottom:4px'>${escapeHtml(t)}</li>`)
    .join("");
  const now = new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return `
    <html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;padding:20px">
    <div style="max-width:700px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
        <div style="background:#1e293b;padding:20px 24px">
            <h1 style="color:white;margin:0;font-size:18px">Fantasy Basketball Alert</h1>
            <p style="color:#94a3b8;margin:4px 0 0;font-size:13px">${escapeHtml(channelName)} &middot; ${now}</p>
        </div>
        <div style="padding:20px 24px">
            <h2 style="margin:0 0 4px;font-size:16px"><a href="${escapeHtml(videoUrl)}" style="color:#2563eb;text-decoration:none">${escapeHtml(title)}</a></h2>
            <h3 style="margin:16px 0 8px;font-size:14px;color:#1e293b">Key Takeaways</h3>
            <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px">${takeawayHtml}</ul>
            <h3 style="margin:20px 0 8px;font-size:14px;color:#1e293b">Player Recommendations</h3>
            <table style="width:100%;border-collapse:collapse;font-size:14px">
                <thead>
                    <tr style="background:#f8fafc">
                        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb">Player</th>
                        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb">Team</th>
                        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb">Action</th>
                        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb">Why</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <div style="background:#f8fafc;padding:12px 24px;font-size:11px;color:#9ca3af;text-align:center">
            Auto-generated by YT Fantasy Newsletter
        </div>
    </div>
    </body></html>
    `;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendEmail(subject: string, htmlBody: string) {
  const from = process.env.EMAIL_FROM;
  const to = process.env.EMAIL_TO;
  const transport = mailTransport();
  if (!from || !to || !transport) {
    throw new Error("Email is not configured (EMAIL_FROM, EMAIL_TO, EMAIL_APP_PASSWORD)");
  }
  await transport.sendMail({
    from,
    to,
    subject,
    html: htmlBody,
  });
}

export type VideoInput = {
  video_id: string;
  title: string;
  channel_name: string;
  url: string;
};

export async function processVideo(
  video: VideoInput,
  options: { dryRun?: boolean } = {}
): Promise<AnalysisPayload | null> {
  const { dryRun } = options;
  const vid = video.video_id;

  const transcript = await getTranscript(vid);
  if (!transcript) {
    return null;
  }

  const analysis = await analyzeWithGemini(
    video.title,
    video.channel_name,
    transcript
  );

  if (!dryRun) {
    const html = buildEmailHtml(analysis, video.url, video.channel_name);
    await sendEmail(`Fantasy Alert: ${video.title}`, html);

    const enriched: AnalysisPayload = {
      ...analysis,
      _channel: video.channel_name,
      _video_id: vid,
      _processed_at: new Date().toISOString(),
      _video_url: video.url,
    };

    await prisma.analysis.create({
      data: {
        videoId: vid,
        channelName: video.channel_name,
        videoUrl: video.url,
        payload: enriched as object,
      },
    });
  }

  return analysis;
}

const SCORE_MAP: Record<string, number> = {
  "MUST ADD": 5,
  STREAM: 3,
  "BUY LOW": 3,
  WATCH: 1,
  "SELL HIGH": -2,
  HOLD: 0,
  DROP: -4,
};

export function buildWeeklyRecapHtml(
  analyses: AnalysisPayload[]
): string {
  const playerScores: Record<
    string,
    {
      team: string;
      score: number;
      mentions: number;
      categories: string[];
    }
  > = {};

  for (const a of analyses) {
    for (const p of a.players ?? []) {
      const name = p.name;
      const cat = p.category;
      if (!playerScores[name]) {
        playerScores[name] = {
          team: p.team ?? "",
          score: 0,
          mentions: 0,
          categories: [],
        };
      }
      playerScores[name].score += SCORE_MAP[cat] ?? 0;
      playerScores[name].mentions += 1;
      playerScores[name].categories.push(cat);
    }
  }

  const ranked = Object.entries(playerScores).sort((a, b) => b[1].score - a[1].score);
  let rows = "";
  ranked.forEach(([name, data], rank) => {
    const scoreColor =
      data.score > 0 ? "#22c55e" : data.score < 0 ? "#ef4444" : "#6b7280";
    const cats = data.categories.join(", ");
    rows += `
        <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600">${rank + 1}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600">${escapeHtml(name)}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280">${escapeHtml(data.team)}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:${scoreColor};font-weight:700">${data.score >= 0 ? "+" : ""}${data.score}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:12px">${data.mentions}x &middot; ${escapeHtml(cats)}</td>
        </tr>`;
  });

  const nVideos = analyses.length;
  const channels = [
    ...new Set(analyses.map((a) => a._channel ?? "Unknown")),
  ].join(", ");

  return `
    <html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;padding:20px">
    <div style="max-width:700px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
        <div style="background:#7c3aed;padding:20px 24px">
            <h1 style="color:white;margin:0;font-size:18px">Weekly Fantasy Recap</h1>
            <p style="color:#c4b5fd;margin:4px 0 0;font-size:13px">${nVideos} videos analyzed &middot; ${escapeHtml(channels)}</p>
        </div>
        <div style="padding:20px 24px">
            <h3 style="margin:0 0 8px;font-size:14px;color:#1e293b">Consensus Rankings (score = sum of all mentions)</h3>
            <table style="width:100%;border-collapse:collapse;font-size:14px">
                <thead>
                    <tr style="background:#f8fafc">
                        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb">#</th>
                        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb">Player</th>
                        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb">Team</th>
                        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb">Score</th>
                        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb">Details</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <div style="background:#f8fafc;padding:12px 24px;font-size:11px;color:#9ca3af;text-align:center">
            Auto-generated Weekly Recap
        </div>
    </div>
    </body></html>
    `;
}

export async function sendWeeklyRecap(): Promise<{ count: number }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  const rows = await prisma.analysis.findMany({
    where: { processedAt: { gte: cutoff } },
    orderBy: { processedAt: "desc" },
  });

  const recent = rows.map((r) => r.payload as AnalysisPayload);
  if (recent.length === 0) {
    return { count: 0 };
  }

  const html = buildWeeklyRecapHtml(recent);
  const label = new Date().toLocaleString("en-US", { month: "short", day: "numeric" });
  await sendEmail(`Weekly Fantasy Recap - ${label}`, html);
  return { count: recent.length };
}

export function parseVideoIdFromUrl(videoUrl: string): string {
  if (videoUrl.includes("v=")) {
    return videoUrl.split("v=")[1]?.split("&")[0] ?? videoUrl;
  }
  if (videoUrl.includes("youtu.be/")) {
    return videoUrl.split("youtu.be/")[1]?.split("?")[0] ?? videoUrl;
  }
  return videoUrl.trim();
}

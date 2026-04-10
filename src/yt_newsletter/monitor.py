"""
YouTube Fantasy Basketball Newsletter Pipeline
Monitors channels via RSS, extracts transcripts, analyzes with Gemini, emails you.
"""

import os
import json
import time
import hashlib
import smtplib
import logging
import argparse
import feedparser
import google.generativeai as genai
from datetime import datetime, timezone, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from youtube_transcript_api import YouTubeTranscriptApi
from pathlib import Path

# ─── Configuration ───────────────────────────────────────────────────────────
# Repo root (…/yt-newsletter-pkg/) — config and state files live here, not inside the package.

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CONFIG_FILE = PROJECT_ROOT / "config.json"
STATE_FILE = PROJECT_ROOT / "state.json"
HISTORY_FILE = PROJECT_ROOT / "history.json"

DEFAULT_CONFIG = {
    "gemini_api_key": "",
    "gemini_model": "gemini-2.5-flash",
    "email_from": "",
    "email_to": "",
    "email_app_password": "",       # Gmail App Password (NOT your regular password)
    "smtp_server": "smtp.gmail.com",
    "smtp_port": 587,
    "poll_interval_seconds": 90,
    "channels": [
        # {
        #     "name": "Fantasy Basketball Channel",
        #     "channel_id": "UCxxxxxxx",
        #     "sport": "basketball"
        # }
    ]
}

ANALYSIS_PROMPT = """You are a fantasy basketball analyst. Analyze this YouTube video transcript and extract every NBA player mentioned with a recommendation.

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
{transcript}
"""

# ─── Logging ─────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(PROJECT_ROOT / "monitor.log")
    ]
)
log = logging.getLogger("yt-newsletter")

# ─── Config & State Management ──────────────────────────────────────────────

def load_config():
    if not CONFIG_FILE.exists():
        CONFIG_FILE.write_text(json.dumps(DEFAULT_CONFIG, indent=2))
        log.info(f"Created default config at {CONFIG_FILE}. Fill it in and restart.")
        raise SystemExit(1)
    return json.loads(CONFIG_FILE.read_text())

def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {"seen_videos": {}}

def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2))

def load_history():
    if HISTORY_FILE.exists():
        return json.loads(HISTORY_FILE.read_text())
    return {"analyses": []}

def save_history(history):
    HISTORY_FILE.write_text(json.dumps(history, indent=2))

# ─── YouTube RSS Polling ─────────────────────────────────────────────────────

def get_latest_videos(channel_id, channel_name):
    """Fetch latest videos from a channel's RSS feed."""
    url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    feed = feedparser.parse(url)
    
    videos = []
    for entry in feed.entries[:5]:  # only check last 5
        video_id = entry.yt_videoid
        videos.append({
            "video_id": video_id,
            "title": entry.title,
            "published": entry.published,
            "channel_name": channel_name,
            "channel_id": channel_id,
            "url": f"https://www.youtube.com/watch?v={video_id}"
        })
    return videos

# ─── Transcript Extraction ──────────────────────────────────────────────────

def get_transcript(video_id, max_retries=3):
    """Pull transcript with retries (captions may lag behind upload)."""
    for attempt in range(max_retries):
        try:
            ytt_api = YouTubeTranscriptApi()
            transcript = ytt_api.fetch(video_id)
            # Combine all text snippets
            full_text = " ".join(snippet.text for snippet in transcript.snippets)
            return full_text
        except Exception as e:
            wait = 30 * (attempt + 1)
            log.warning(f"Transcript not ready for {video_id}, retry in {wait}s: {e}")
            time.sleep(wait)
    return None

# ─── Gemini Analysis ────────────────────────────────────────────────────────

def analyze_with_gemini(config, title, channel, transcript):
    """Send transcript to Gemini, get structured player analysis."""
    genai.configure(api_key=config["gemini_api_key"])
    model = genai.GenerativeModel(config["gemini_model"])
    
    prompt = ANALYSIS_PROMPT.format(
        title=title,
        channel=channel,
        transcript=transcript[:80000]  # trim if massive
    )
    
    response = model.generate_content(prompt)
    text = response.text.strip()
    
    # Strip markdown fences if present
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
    if text.endswith("```"):
        text = text.rsplit("```", 1)[0]
    text = text.strip()
    
    return json.loads(text)

# ─── Email Formatting & Sending ─────────────────────────────────────────────

CATEGORY_COLORS = {
    "MUST ADD": "#22c55e",
    "STREAM": "#3b82f6",
    "WATCH": "#a855f7",
    "BUY LOW": "#f59e0b",
    "SELL HIGH": "#ef4444",
    "HOLD": "#6b7280",
    "DROP": "#dc2626",
}

def build_email_html(analysis, video_url, channel_name):
    """Build a clean HTML email from analysis."""
    players = analysis.get("players", [])
    takeaways = analysis.get("key_takeaways", [])
    title = analysis.get("video_title", "New Video")
    
    # Group players by category
    grouped = {}
    for p in players:
        cat = p["category"]
        grouped.setdefault(cat, []).append(p)
    
    # Priority order for display
    order = ["MUST ADD", "STREAM", "BUY LOW", "WATCH", "SELL HIGH", "HOLD", "DROP"]
    
    rows = ""
    for cat in order:
        if cat not in grouped:
            continue
        for p in grouped[cat]:
            color = CATEGORY_COLORS.get(cat, "#6b7280")
            rows += f"""
            <tr>
                <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600">{p['name']}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280">{p.get('team','')}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">
                    <span style="background:{color};color:white;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700">{cat}</span>
                </td>
                <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px">{p.get('reason','')}</td>
            </tr>"""
    
    takeaway_html = "".join(f"<li style='margin-bottom:4px'>{t}</li>" for t in takeaways)
    
    html = f"""
    <html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;padding:20px">
    <div style="max-width:700px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
        <div style="background:#1e293b;padding:20px 24px">
            <h1 style="color:white;margin:0;font-size:18px">Fantasy Basketball Alert</h1>
            <p style="color:#94a3b8;margin:4px 0 0;font-size:13px">{channel_name} &middot; {datetime.now().strftime('%b %d, %Y %I:%M %p')}</p>
        </div>
        <div style="padding:20px 24px">
            <h2 style="margin:0 0 4px;font-size:16px"><a href="{video_url}" style="color:#2563eb;text-decoration:none">{title}</a></h2>
            <h3 style="margin:16px 0 8px;font-size:14px;color:#1e293b">Key Takeaways</h3>
            <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px">{takeaway_html}</ul>
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
                <tbody>{rows}</tbody>
            </table>
        </div>
        <div style="background:#f8fafc;padding:12px 24px;font-size:11px;color:#9ca3af;text-align:center">
            Auto-generated by YT Fantasy Newsletter
        </div>
    </div>
    </body></html>
    """
    return html

def build_weekly_recap_html(analyses):
    """Aggregate a week of analyses into a scored recap."""
    # Score players across all analyses
    SCORE_MAP = {"MUST ADD": 5, "STREAM": 3, "BUY LOW": 3, "WATCH": 1, "SELL HIGH": -2, "HOLD": 0, "DROP": -4}
    
    player_scores = {}
    for a in analyses:
        for p in a.get("players", []):
            name = p["name"]
            cat = p["category"]
            if name not in player_scores:
                player_scores[name] = {"team": p.get("team", ""), "score": 0, "mentions": 0, "categories": []}
            player_scores[name]["score"] += SCORE_MAP.get(cat, 0)
            player_scores[name]["mentions"] += 1
            player_scores[name]["categories"].append(cat)
    
    # Sort by score descending
    ranked = sorted(player_scores.items(), key=lambda x: x[1]["score"], reverse=True)
    
    rows = ""
    for rank, (name, data) in enumerate(ranked, 1):
        score_color = "#22c55e" if data["score"] > 0 else "#ef4444" if data["score"] < 0 else "#6b7280"
        cats = ", ".join(data["categories"])
        rows += f"""
        <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600">{rank}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600">{name}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280">{data['team']}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:{score_color};font-weight:700">{data['score']:+d}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:12px">{data['mentions']}x &middot; {cats}</td>
        </tr>"""
    
    n_videos = len(analyses)
    channels = set(a.get("_channel", "Unknown") for a in analyses)
    
    html = f"""
    <html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;padding:20px">
    <div style="max-width:700px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
        <div style="background:#7c3aed;padding:20px 24px">
            <h1 style="color:white;margin:0;font-size:18px">Weekly Fantasy Recap</h1>
            <p style="color:#c4b5fd;margin:4px 0 0;font-size:13px">{n_videos} videos analyzed &middot; {', '.join(channels)}</p>
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
                <tbody>{rows}</tbody>
            </table>
        </div>
        <div style="background:#f8fafc;padding:12px 24px;font-size:11px;color:#9ca3af;text-align:center">
            Auto-generated Weekly Recap
        </div>
    </div>
    </body></html>
    """
    return html

def send_email(config, subject, html_body):
    """Send HTML email via Gmail SMTP."""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = config["email_from"]
    msg["To"] = config["email_to"]
    msg.attach(MIMEText(html_body, "html"))
    
    with smtplib.SMTP(config["smtp_server"], config["smtp_port"]) as server:
        server.starttls()
        server.login(config["email_from"], config["email_app_password"])
        server.sendmail(config["email_from"], config["email_to"], msg.as_string())
    log.info(f"Email sent: {subject}")

# ─── Core Pipeline ──────────────────────────────────────────────────────────

def process_video(config, video):
    """Full pipeline: transcript -> analysis -> email."""
    vid = video["video_id"]
    log.info(f"Processing: {video['title']} ({vid})")
    
    # 1. Get transcript
    transcript = get_transcript(vid)
    if not transcript:
        log.error(f"Could not get transcript for {vid}, skipping")
        return None
    
    log.info(f"Got transcript ({len(transcript)} chars)")
    
    # 2. Analyze with Gemini
    analysis = analyze_with_gemini(
        config,
        video["title"],
        video["channel_name"],
        transcript
    )
    log.info(f"Gemini extracted {len(analysis.get('players', []))} players")
    
    # 3. Build and send email
    html = build_email_html(analysis, video["url"], video["channel_name"])
    subject = f"Fantasy Alert: {video['title']}"
    send_email(config, subject, html)
    
    # 4. Save to history for weekly recap
    analysis["_channel"] = video["channel_name"]
    analysis["_video_id"] = vid
    analysis["_processed_at"] = datetime.now(timezone.utc).isoformat()
    analysis["_video_url"] = video["url"]
    
    history = load_history()
    history["analyses"].append(analysis)
    save_history(history)
    
    return analysis

def run_monitor(config):
    """Main polling loop."""
    state = load_state()
    interval = config.get("poll_interval_seconds", 90)
    
    log.info(f"Monitoring {len(config['channels'])} channels every {interval}s")
    
    while True:
        for ch in config["channels"]:
            try:
                videos = get_latest_videos(ch["channel_id"], ch["name"])
                for video in videos:
                    vid = video["video_id"]
                    if vid not in state["seen_videos"]:
                        log.info(f"New video detected: {video['title']}")
                        result = process_video(config, video)
                        state["seen_videos"][vid] = {
                            "title": video["title"],
                            "processed": datetime.now(timezone.utc).isoformat(),
                            "success": result is not None
                        }
                        save_state(state)
            except Exception as e:
                log.error(f"Error checking {ch['name']}: {e}")
        
        time.sleep(interval)

def send_weekly_recap(config):
    """Aggregate the last 7 days of analyses into one email."""
    history = load_history()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    
    recent = [a for a in history["analyses"] if a.get("_processed_at", "") >= cutoff]
    
    if not recent:
        log.info("No analyses in the last 7 days, skipping recap")
        return
    
    html = build_weekly_recap_html(recent)
    subject = f"Weekly Fantasy Recap - {datetime.now().strftime('%b %d')}"
    send_email(config, subject, html)
    log.info(f"Weekly recap sent with {len(recent)} analyses")

# ─── Test Mode ───────────────────────────────────────────────────────────────

def test_with_video(config, video_url):
    """Test the full pipeline with any existing YouTube video URL."""
    # Extract video ID from URL
    if "v=" in video_url:
        vid = video_url.split("v=")[1].split("&")[0]
    elif "youtu.be/" in video_url:
        vid = video_url.split("youtu.be/")[1].split("?")[0]
    else:
        vid = video_url
    
    video = {
        "video_id": vid,
        "title": f"Test Video ({vid})",
        "channel_name": "Test Channel",
        "url": f"https://www.youtube.com/watch?v={vid}"
    }
    
    # Try to get real title from RSS... or just use the ID
    log.info(f"Running test pipeline on video: {vid}")
    result = process_video(config, video)
    
    if result:
        print("\n=== ANALYSIS RESULT ===")
        print(json.dumps(result, indent=2))
    else:
        print("Pipeline failed. Check logs.")

# ─── CLI ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="YouTube Fantasy Basketball Newsletter")
    sub = parser.add_subparsers(dest="command")
    
    sub.add_parser("monitor", help="Start polling for new videos")
    sub.add_parser("recap", help="Send weekly recap email now")
    sub.add_parser("init", help="Create default config file")
    
    test_p = sub.add_parser("test", help="Test with an existing video URL")
    test_p.add_argument("url", help="YouTube video URL to test with")
    
    add_p = sub.add_parser("add-channel", help="Add a channel to monitor")
    add_p.add_argument("name", help="Channel display name")
    add_p.add_argument("channel_id", help="YouTube channel ID (UCxxxxxxx)")
    
    args = parser.parse_args()
    
    if args.command == "init":
        if CONFIG_FILE.exists():
            print(f"Config already exists at {CONFIG_FILE}")
        else:
            CONFIG_FILE.write_text(json.dumps(DEFAULT_CONFIG, indent=2))
            print(f"Created config at {CONFIG_FILE}")
            print("Fill in your API keys and email credentials, then run 'monitor'")
        return
    
    config = load_config()
    
    if args.command == "monitor":
        # Mark all current videos as seen on first run (don't spam old videos)
        state = load_state()
        if not state["seen_videos"]:
            log.info("First run: marking existing videos as seen...")
            for ch in config["channels"]:
                try:
                    videos = get_latest_videos(ch["channel_id"], ch["name"])
                    for v in videos:
                        state["seen_videos"][v["video_id"]] = {
                            "title": v["title"],
                            "processed": "skipped-first-run",
                            "success": False
                        }
                except Exception as e:
                    log.error(f"Error seeding {ch['name']}: {e}")
            save_state(state)
        run_monitor(config)
    
    elif args.command == "test":
        test_with_video(config, args.url)
    
    elif args.command == "recap":
        send_weekly_recap(config)
    
    elif args.command == "add-channel":
        config["channels"].append({
            "name": args.name,
            "channel_id": args.channel_id,
            "sport": "basketball"
        })
        CONFIG_FILE.write_text(json.dumps(config, indent=2))
        print(f"Added channel '{args.name}' ({args.channel_id})")
    
    else:
        parser.print_help()

if __name__ == "__main__":
    main()

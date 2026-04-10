# YouTube Fantasy Basketball Newsletter

Monitors YouTube channels, extracts transcripts, analyzes with Gemini, emails you a player recommendation table within minutes of upload.

**Layout:** Python package in `src/yt_newsletter/`; `config.json`, `state.json`, and `history.json` live at the repository root (next to `pyproject.toml`).

## Setup (5 minutes)

### 1. Install dependencies
```bash
cd yt-newsletter-pkg
pip install -e .
# or: pip install -r requirements.txt
```

### 2. Create config
```bash
yt-newsletter init
# or: python -m yt_newsletter init
# or from repo root without install: python monitor.py init
```
This creates `config.json`. Fill in:

- **gemini_api_key**: From https://aistudio.google.com/apikey
- **email_from**: Your Gmail address
- **email_to**: Where newsletters go (can be same as from)
- **email_app_password**: Gmail App Password (NOT your regular password)
  - Go to https://myaccount.google.com/apppasswords
  - Generate one for "Mail"
  - Paste the 16-char code

### 3. Add channels
```bash
yt-newsletter add-channel "Josh Lloyd" "UCxxxxxxxxx"
```

**How to find a channel ID:**
1. Go to the channel page on YouTube
2. View page source (Cmd+U)
3. Search for `channel_id` — you'll see `UCxxxxxxx`
4. Or use https://commentpicker.com/youtube-channel-id.php

### 4. Test with an existing video
```bash
yt-newsletter test "https://www.youtube.com/watch?v=VIDEO_ID"
```
Pick any fantasy basketball video that already has captions. This runs the full pipeline (transcript → Gemini → email) without waiting for a new upload.

### 5. Start monitoring
```bash
yt-newsletter monitor
```
Polls every 90 seconds. On first run, it marks all existing videos as "seen" so you don't get spammed.

### 6. Weekly recap
```bash
yt-newsletter recap
```
Aggregates all analyses from the past 7 days, scores players by consensus, and emails you a ranked table.

To automate the weekly recap, add a cron job:
```bash
crontab -e
# Send recap every Sunday at 9am
0 9 * * 0 cd /path/to/yt-newsletter-pkg && yt-newsletter recap
```

## Running in the background on Mac

```bash
# Simple approach: run in a detached terminal
nohup yt-newsletter monitor > /dev/null 2>&1 &

# Check it's running
ps aux | grep yt-newsletter

# Stop it
pkill -f "yt-newsletter monitor"
```

## Cost estimate
- **Gemini 2.5 Flash**: ~$0.01-0.03 per video transcript analysis
- **Gmail SMTP**: Free
- **YouTube RSS + Transcripts**: Free
- A channel posting daily = ~$0.50-1.00/month total

## Testing tips
- Use `yt-newsletter test <url>` with any existing video
- To simulate a "new upload" detection, delete a video ID from `state.json` and restart the monitor
- Check `monitor.log` for debug output

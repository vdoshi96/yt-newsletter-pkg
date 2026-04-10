# YT Newsletter Web Controller — Design

**Date:** 2026-04-10  
**Status:** Approved for implementation (user requested Next.js on Vercel with full controller UI).

## Goal

A password-protected **Next.js (App Router) + React** dashboard deployed on **Vercel** that replaces the local CLI for: managing monitored channels, running a **test / mock** pipeline on any YouTube URL, triggering **weekly recap**, and viewing recent history. Background **polling** for new uploads runs via **Vercel Cron** (or an external scheduler hitting the same secured endpoint).

## Approaches Considered

| Approach | Pros | Cons |
|----------|------|------|
| **A — Next.js API routes + Postgres (Neon)** | Single deploy, typed TS pipeline, durable state | Requires `DATABASE_URL` |
| **B — Next UI + Python worker elsewhere** | Reuse Python verbatim | Two systems, more ops |
| **C — Next + Vercel KV only** | Simpler | JSON size/history limits |

**Choice:** **A** — Prisma + PostgreSQL (Neon or Vercel Postgres), secrets only in environment variables.

## Architecture

- **UI:** `web/` Next.js 15 — login page, dashboard (channels CRUD, test runner with dry-run, recap button, history list).
- **Auth:** Single shared password via `CONTROLLER_PASSWORD`; session cookie signed with `jose` + `SESSION_SECRET`.
- **Cron:** `GET/POST /api/cron/poll` validates `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends this when configured). Same route can be triggered by external cron.
- **Pipeline (TypeScript):** RSS fetch → parse video IDs → compare to `SeenVideo` → transcript (`youtube-transcript`) → Gemini (`@google/generative-ai`) → optional email (`nodemailer`). Mirrors the Python `monitor.py` behavior.
- **Mock / dry run:** `POST /api/test` with `{ "videoUrl", "dryRun": true }` runs transcript + Gemini, returns JSON; skips email and DB history when `dryRun` is true.

## Data Model (Prisma)

- `Channel` — name, `channelId` (UC…), sport.
- `SeenVideo` — `videoId` PK, title, processedAt, success.
- `Analysis` — JSON payload + metadata for recap/history.

## Environment (Vercel)

- `DATABASE_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL` (optional), SMTP + email vars, `CONTROLLER_PASSWORD`, `SESSION_SECRET`, `CRON_SECRET`.

## Security Notes

- No API keys in the database; only env.
- Cron and mutating APIs require auth (session or cron secret).

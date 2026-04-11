# YT Newsletter — Web controller (Next.js)

Password-protected dashboard to manage channels, run transcript + Gemini tests (dry run or full), send weekly recap emails, and rely on **Vercel Cron** to poll YouTube RSS (same behavior as the Python CLI).

## Cost & burst protection (defaults)

- **Model:** `gemini-2.5-flash` unless you override `GEMINI_MODEL`.
- **`MAX_VIDEOS_PER_CRON`** (default **1**): each cron run processes at most this many **new** videos (avoids a flood of emails/Gemini calls if many uploads appear at once). Clamped 1–20.
- **`MAX_GEMINI_CALLS_PER_UTC_DAY`** (optional): soft daily cap on **saved** analyses (UTC day). Omit or `0` for unlimited.
- **`GEMINI_MAX_INPUT_CHARS`**: transcript sent to Gemini (default 80k, max 100k).

RSS only ever loads the **latest few videos per channel** (not full back catalog).

## What you set up (checklist)

1. **PostgreSQL** — [Neon](https://neon.tech), Vercel Postgres, Supabase, etc. Copy the connection string as `DATABASE_URL`.
2. **Vercel project** — Import this repo, set **Root Directory** to `web`.
3. **Environment variables** in Vercel (Production + Preview): copy from `.env.example` and fill in:
   - `DATABASE_URL`
   - `GEMINI_API_KEY` (Google AI Studio / Gemini API)
   - `EMAIL_FROM`, `EMAIL_TO`, `EMAIL_APP_PASSWORD` (Gmail app password recommended)
   - `SMTP_HOST` / `SMTP_PORT` if not using Gmail defaults
   - `CONTROLLER_PASSWORD` — password for the web UI
   - `SESSION_SECRET` — random string, **≥ 16 characters**
   - `CRON_SECRET` — random string; use the **same** value in Vercel → Project → Cron Jobs → **CRON_SECRET** (secures `/api/cron/poll`)
4. **Database schema** — After the first deploy (or locally with `DATABASE_URL` set):

   ```bash
   cd web
   npx prisma db push
   ```

   For migration-based workflows later: `npx prisma migrate dev` locally, then `prisma migrate deploy` in CI/Vercel.

5. **Cron** — `vercel.json` runs `/api/cron/poll` every 5 minutes. On some plans, cron schedules differ; you can also trigger the endpoint manually with:

   ```bash
   curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://YOUR_DOMAIN/api/cron/poll
   ```

## Local development

```bash
cd web
cp .env.example .env.local
# edit .env.local — include DATABASE_URL and secrets
npx prisma db push
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign in with `CONTROLLER_PASSWORD`.

## API (cookie session required except cron)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/login` | Body: `{ "password" }` |
| POST | `/api/auth/logout` | Clears session |
| GET/POST | `/api/channels` | List / add channel |
| DELETE | `/api/channels/[id]` | Remove channel |
| POST | `/api/test` | Body: `{ "videoUrl", "dryRun": true \| false }` |
| POST | `/api/recap` | Send weekly recap email |
| GET | `/api/history?limit=20` | Recent saved analyses |
| GET | `/api/status` | Which env groups are configured (no secret values) |
| GET/POST | `/api/cron/poll` | Header: `Authorization: Bearer $CRON_SECRET` |

The Python CLI in the repo root is unchanged; you can use either the CLI or this UI.

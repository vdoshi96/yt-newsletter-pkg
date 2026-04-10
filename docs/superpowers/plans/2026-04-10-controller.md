# YT Newsletter Web Controller — Implementation Plan

> **Goal:** Ship Next.js dashboard + APIs + Prisma + cron in `web/`, with setup docs for Vercel and Neon.

**Architecture:** Next.js Route Handlers call shared `lib/` pipeline code; Prisma stores channels, seen videos, analyses; cron invokes poll endpoint.

**Tech Stack:** Next.js 15, React 19, Tailwind 4, Prisma, PostgreSQL, `@google/generative-ai`, `nodemailer`, `youtube-transcript`, `jose`, `fast-xml-parser`.

---

### Task 1: Dependencies & Prisma

- [ ] Add npm deps; `prisma init` with PostgreSQL schema; `postinstall: prisma generate`.

### Task 2: Core libraries

- [ ] `lib/env.ts` — zod or manual validation of required env for server actions.
- [ ] `lib/session.ts` — JWT cookie for controller login.
- [ ] `lib/pipeline.ts` — prompt, Gemini, HTML email builders, `processVideo`, `sendWeeklyRecap`.
- [ ] `lib/youtube.ts` — RSS fetch + parse last N videos; transcript helper.

### Task 3: API routes

- [ ] `/api/auth/login`, `/api/auth/logout`
- [ ] `/api/channels` GET/POST, DELETE
- [ ] `/api/test` POST
- [ ] `/api/recap` POST
- [ ] `/api/history` GET
- [ ] `/api/status` GET (masked env presence)
- [ ] `/api/cron/poll` GET (cron secret)

### Task 4: UI

- [ ] `/login` — password form
- [ ] `/dashboard` — channels table, add form, test URL + dry-run, recap, history

### Task 5: Middleware & Vercel

- [ ] `middleware.ts` — protect `/dashboard` and `/api/*` except auth + cron
- [ ] `vercel.json` — cron schedule
- [ ] `.env.example` — document all vars
- [ ] Root `README` or `web/README.md` — deploy steps

### Task 6: Verify

- [ ] `npm run build` in `web/`

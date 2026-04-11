import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getLatestVideos } from "@/lib/rss";
import { processVideo } from "@/lib/pipeline";

export const maxDuration = 120;

/** Prevents one cron run from chewing through a huge backlog (emails + Gemini). */
function maxVideosPerCron(): number {
  const raw = process.env.MAX_VIDEOS_PER_CRON;
  const n = raw === undefined || raw === "" ? 1 : parseInt(raw, 10);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(n, 20));
}

/** Optional daily limit on saved analyses (UTC midnight–midnight). 0 = unlimited. */
async function analysesCountTodayUtc(): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return prisma.analysis.count({
    where: { processedAt: { gte: start } },
  });
}

function dailyAnalysisCap(): number {
  const raw = process.env.MAX_GEMINI_CALLS_PER_UTC_DAY;
  if (raw === undefined || raw === "") return 0;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const channels = await prisma.channel.findMany();
  if (channels.length === 0) {
    return NextResponse.json({ ok: true, message: "No channels configured", processed: 0 });
  }

  const capPerDay = dailyAnalysisCap();
  if (capPerDay > 0) {
    const usedToday = await analysesCountTodayUtc();
    if (usedToday >= capPerDay) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "daily_analysis_cap",
        usedToday,
        capPerDay,
        message:
          "Daily MAX_GEMINI_CALLS_PER_UTC_DAY reached; no new videos processed until UTC midnight",
      });
    }
  }

  const perRunLimit = maxVideosPerCron();
  let processed = 0;

  const seenCount = await prisma.seenVideo.count();
  if (seenCount === 0) {
    let seeded = 0;
    for (const ch of channels) {
      try {
        const videos = await getLatestVideos(ch.channelId, ch.name, 5);
        for (const v of videos) {
          await prisma.seenVideo.upsert({
            where: { videoId: v.video_id },
            create: {
              videoId: v.video_id,
              title: v.title,
              processedAt: new Date(),
              success: false,
            },
            update: {
              title: v.title,
              processedAt: new Date(),
              success: false,
            },
          });
          seeded += 1;
        }
      } catch {
        /* channel rss failed */
      }
    }
    return NextResponse.json({
      ok: true,
      seeded: true,
      seededVideoCount: seeded,
      message: "First run: marked recent uploads as seen (no emails)",
    });
  }

  for (const ch of channels) {
    if (processed >= perRunLimit) break;
    if (capPerDay > 0) {
      const usedToday = await analysesCountTodayUtc();
      if (usedToday >= capPerDay) {
        return NextResponse.json({
          ok: true,
          processed,
          capped: true,
          reason: "daily_analysis_cap_mid_run",
          message:
            "Stopped early: daily analysis cap reached partway through this cron run",
        });
      }
    }

    let videos;
    try {
      videos = await getLatestVideos(ch.channelId, ch.name, 5);
    } catch {
      continue;
    }
    for (const video of videos) {
      if (processed >= perRunLimit) break;
      if (capPerDay > 0) {
        const usedToday = await analysesCountTodayUtc();
        if (usedToday >= capPerDay) {
          return NextResponse.json({
            ok: true,
            processed,
            capped: true,
            reason: "daily_analysis_cap_mid_run",
          });
        }
      }

      const exists = await prisma.seenVideo.findUnique({
        where: { videoId: video.video_id },
      });
      if (exists) continue;

      let result: Awaited<ReturnType<typeof processVideo>> = null;
      try {
        result = await processVideo(
          {
            video_id: video.video_id,
            title: video.title,
            channel_name: video.channel_name,
            url: video.url,
          },
          { dryRun: false }
        );
      } catch {
        result = null;
      }

      await prisma.seenVideo.upsert({
        where: { videoId: video.video_id },
        create: {
          videoId: video.video_id,
          title: video.title,
          processedAt: new Date(),
          success: result !== null,
        },
        update: {
          title: video.title,
          processedAt: new Date(),
          success: result !== null,
        },
      });
      processed += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    processed,
    perRunLimit,
    capped: processed >= perRunLimit,
  });
}

export async function POST(request: Request) {
  return GET(request);
}

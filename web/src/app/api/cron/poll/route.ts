import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getLatestVideos } from "@/lib/rss";
import { processVideo } from "@/lib/pipeline";

export const maxDuration = 120;

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

  let processed = 0;
  for (const ch of channels) {
    let videos;
    try {
      videos = await getLatestVideos(ch.channelId, ch.name, 5);
    } catch {
      continue;
    }
    for (const video of videos) {
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

  return NextResponse.json({ ok: true, processed });
}

export async function POST(request: Request) {
  return GET(request);
}
